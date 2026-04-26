import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { agUiRouteHandler, EchoAgent, type AgentResolver, type ServerAgent } from '@maverick/agentic-ui-server';
import { GeminiAgent } from './gemini-agent.js';
import { OrchestratorAgent } from './orchestrator-agent.js';
import { bearerAuth } from './auth.js';
import { log } from './logger.js';

const PORT = Number(process.env['PORT'] ?? 4111);

// CORS allowlist. Comma-separated origins or '*' for permissive (dev only).
const CORS_ORIGINS = (process.env['CORS_ORIGINS'] ?? '*').split(',').map((s) => s.trim()).filter(Boolean);

// Always-on echo agent (no LLM, useful for testing the SSE pipeline).
const echoAgent = new EchoAgent('echo', { tickMs: 60, prefix: 'You said: ' });

// LLM-backed agents — only registered if a Google API key is configured.
const apiKey = process.env['GOOGLE_GENERATIVE_AI_API_KEY'] ?? process.env['GEMINI_API_KEY'];
const model = process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash';

const agents = new Map<string, ServerAgent>();
agents.set('echo', echoAgent);

if (apiKey) {
  // Original single-domain agent — kept for backwards compatibility with
  // demo-monolith and demo-shell (both pointed at /agents/gemini/run).
  const geminiAgent = new GeminiAgent('gemini', {
    apiKey,
    model,
    systemInstruction:
      'You are a helpful flight booking assistant. When the user asks to book or search flights, ' +
      "call the appropriate tool. After receiving tool results, respond with a brief natural-language summary.",
  });
  agents.set('gemini', geminiAgent);

  // Specialist sub-agents for the multi-agent orchestration example. Each has
  // its own focused system prompt; client-side tool/widget registration on
  // the host app determines what each can actually do.
  const bookingsAgent = new GeminiAgent('bookings', {
    apiKey,
    model,
    systemInstruction:
      'You are a flight booking specialist. Help users search, book, change, and cancel flights. ' +
      'Call tools when available; render flight cards via the generative-UI components. ' +
      'Stay focused on travel; if asked about loyalty points or support tickets, say so briefly and stop.',
  });
  const loyaltyAgent = new GeminiAgent('loyalty', {
    apiKey,
    model,
    systemInstruction:
      'You are a loyalty program specialist. Help users check points balances, tier status, and redeem rewards. ' +
      'Call tools when available; render points cards via the generative-UI components. ' +
      'Stay focused on loyalty; if asked about flight booking or support, say so briefly and stop.',
  });
  const supportAgent = new GeminiAgent('support', {
    apiKey,
    model,
    systemInstruction:
      'You are a customer support specialist. Help users open tickets, check ticket status, and resolve common ' +
      'account issues. Call tools when available; render ticket cards via the generative-UI components. ' +
      'Stay focused on support; if asked about flights or loyalty, say so briefly and stop.',
  });

  agents.set('bookings', bookingsAgent);
  agents.set('loyalty', loyaltyAgent);
  agents.set('support', supportAgent);

  // Orchestrator: classifies user intent, then forwards the chosen specialist's
  // event stream verbatim (so client-side tools, widgets, and text deltas all
  // work transparently). See orchestrator-agent.ts for the routing logic.
  const orchestrator = new OrchestratorAgent('orchestrator', {
    apiKey,
    model,
    subAgents: [
      {
        id: 'bookings',
        agent: bookingsAgent,
        description: 'flight search, booking, cancellation, schedule changes',
        examples: ['Book a flight from LAX to JFK on March 5', 'Cancel my booking BK-XXX', 'What flights are there to Tokyo tomorrow?'],
      },
      {
        id: 'loyalty',
        agent: loyaltyAgent,
        description: 'points balance, tier status, reward redemption',
        examples: ['How many points do I have?', 'Redeem 25,000 points for a flight', 'Am I still gold tier?'],
      },
      {
        id: 'support',
        agent: supportAgent,
        description: 'support tickets, account problems, complaints',
        examples: ['Open a ticket for my refund', 'Status of ticket TICK-123', 'My account is locked'],
      },
    ],
  });
  agents.set('orchestrator', orchestrator);
}

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
    geminiConfigured: Boolean(apiKey),
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
