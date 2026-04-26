import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { agUiRouteHandler, EchoAgent, type AgentResolver, type ServerAgent } from '@maverick/agentic-ui-server';
import { GeminiAgent } from './gemini-agent.js';
import { bearerAuth } from './auth.js';
import { log } from './logger.js';

const PORT = Number(process.env['PORT'] ?? 4111);

// CORS allowlist. Comma-separated origins or '*' for permissive (dev only).
const CORS_ORIGINS = (process.env['CORS_ORIGINS'] ?? '*').split(',').map((s) => s.trim()).filter(Boolean);

// Always-on echo agent (no LLM, useful for testing the SSE pipeline).
const echoAgent = new EchoAgent('echo', { tickMs: 60, prefix: 'You said: ' });

// LLM-backed agent — only registered if a Google API key is configured.
const apiKey = process.env['GOOGLE_GENERATIVE_AI_API_KEY'] ?? process.env['GEMINI_API_KEY'];
const geminiAgent: ServerAgent | undefined = apiKey
  ? new GeminiAgent('gemini', {
      apiKey,
      model: process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash',
      systemInstruction:
        'You are a helpful flight booking assistant. When the user asks to book or search flights, ' +
        "call the appropriate tool. After receiving tool results, respond with a brief natural-language summary.",
    })
  : undefined;

const agents = new Map<string, ServerAgent>();
agents.set('echo', echoAgent);
if (geminiAgent) agents.set('gemini', geminiAgent);

const resolver: AgentResolver = {
  resolve: (id) => agents.get(id),
};

const handler = agUiRouteHandler({ resolver });
const app = new Hono();

app.use(
  '*',
  cors({
    origin: (origin) => {
      // Permissive '*' explicitly opted-in via CORS_ORIGINS=* (dev mode).
      if (CORS_ORIGINS.includes('*')) return origin ?? '*';
      // Strict allowlist: only echo back the origin if it matches.
      return origin && CORS_ORIGINS.includes(origin) ? origin : '';
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Accept', 'Authorization'],
  }),
);

app.use('*', bearerAuth());

// Per-request structured access log + simple timing.
app.use('*', async (c, next) => {
  const start = performance.now();
  await next();
  log.info('request', {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Math.round(performance.now() - start),
  });
});

app.get('/health', (c) =>
  c.json({
    ok: true,
    agents: [...agents.keys()],
    geminiConfigured: Boolean(geminiAgent),
    corsMode: CORS_ORIGINS.includes('*') ? 'permissive' : 'allowlist',
    authEnabled: Boolean(process.env['AGENT_AUTH_TOKENS']?.trim()),
  }),
);

app.post('/agents/:id/run', async (c) => handler(c.req.raw));

// Wrap server startup so we can keep a reference for graceful shutdown.
const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  log.info('listening', {
    port: info.port,
    agents: [...agents.keys()],
    corsOrigins: CORS_ORIGINS,
    authEnabled: Boolean(process.env['AGENT_AUTH_TOKENS']?.trim()),
  });
});

// Graceful shutdown — drain in-flight requests, then exit.
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutdown initiated', { signal });
  server.close(() => {
    log.info('shutdown complete', {});
    process.exit(0);
  });
  // Hard cap — if drain takes too long, force exit.
  setTimeout(() => {
    log.warn('forced exit (drain timeout)', {});
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  log.error('uncaughtException', { err: err instanceof Error ? err.message : String(err) });
});
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', { reason: reason instanceof Error ? reason.message : String(reason) });
});
