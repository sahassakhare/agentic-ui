import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  agUiRouteHandler,
  createSpecialist,
  EchoAgent,
  registerSpecialists,
  type AgentResolver,
  type ServerAgent,
} from '@maverick/agentic-ui-server';
import { listMatters } from '@maverick/demo-ediscovery-shared';
import { GeminiAgent } from './gemini-agent.js';
import { OrchestratorAgent } from './orchestrator-agent.js';
import { bearerAuth } from './auth.js';
import { log } from './logger.js';

const PORT = Number(process.env['PORT'] ?? 4311);
const CORS_ORIGINS = (process.env['CORS_ORIGINS'] ?? '*').split(',').map((s) => s.trim()).filter(Boolean);

const apiKey = process.env['GOOGLE_GENERATIVE_AI_API_KEY'] ?? process.env['GEMINI_API_KEY'];
const model = process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash';

const agents = new Map<string, ServerAgent>();

// No-LLM fallback so the server boots cleanly without an API key — useful
// during initial setup. Replaced by the LLM-backed coordinator when keys
// are present.
agents.set('echo', new EchoAgent('echo'));

if (apiKey) {
  // Shared rules every specialist obeys. Same pattern as demo-server.
  const sharedRules =
    ' Important rules:\n' +
    ' 1. Call each tool AT MOST ONCE per user request. After a successful tool result, summarize and stop.\n' +
    ' 2. Do NOT output any HTML, XML, or custom tags such as <custodianCard>. Cards render automatically from the tool result; just confirm in plain text.\n' +
    ' 3. Keep replies short — one or two sentences.\n' +
    " 4. If the user asks about something outside your domain, briefly say it isn't your area and stop.\n" +
    ' 5. Treat every action as audited — destructive actions (release hold, finalize production) need a clear reason from the user before you call the tool.';

  const specialists = registerSpecialists(agents, [
    createSpecialist({
      id: 'collection',
      factory: (id) => new GeminiAgent(id, {
        apiKey, model,
        systemInstruction:
          'You are an eDiscovery collection specialist. Help users add custodians, place legal holds, ' +
          'release holds, and track collection status. Use the available tools rather than guessing. ' +
          'Always include a short justification when issuing or releasing a hold (compliance trail).' +
          sharedRules,
      }),
      description: 'custodian onboarding, legal-hold issuance and tracking, collection status',
      examples: [
        'Add Sarah Chen from Engineering as a custodian on this matter',
        'Place a legal hold on Sarah covering Project Phoenix',
        'Release the hold on Marcus, our deal closed',
        "List all custodians who haven't acknowledged their hold notice",
      ],
    }),
    // Phase 2 will add review-specialist; Phase 3 production-specialist; Phase 4 search-specialist.
  ]);

  // Multi-agent orchestrator with per-matter sticky-routing state. The
  // default in-memory ThreadStateStore matches the demo's single-pod scale;
  // production-deployment cookbook shows the Redis adapter.
  const coordinator = new OrchestratorAgent('coordinator', {
    apiKey,
    model,
    subAgents: specialists,
    fallbackMessage:
      "I'm not sure which specialist to involve. Try asking about: custodians, legal holds, " +
      'or collection status. (Phase 2+ will add review, production, and search.)',
  });
  agents.set('coordinator', coordinator);
  log.info('coordinator wired', { specialists: specialists.map((s) => s.id) });
} else {
  // No API key — coordinator is the echo placeholder so the chat shell still works.
  agents.set('coordinator', new EchoAgent('coordinator', { tickMs: 60, prefix: '[coordinator placeholder — set GOOGLE_GENERATIVE_AI_API_KEY] ' }));
  log.warn('GOOGLE_GENERATIVE_AI_API_KEY not set — coordinator is an echo placeholder');
}

const resolver: AgentResolver = { resolve: (id) => agents.get(id) };
const handler = agUiRouteHandler({ resolver });

const app = new Hono();

app.use('*', cors({
  origin: (origin) => {
    if (CORS_ORIGINS.includes('*')) return origin ?? '*';
    return origin && CORS_ORIGINS.includes(origin) ? origin : '';
  },
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Accept', 'Authorization'],
}));

app.use('*', bearerAuth());

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
    matters: listMatters().map((m) => ({ id: m.id, name: m.name, status: m.status })),
    coordinator: apiKey ? 'gemini-orchestrator' : 'echo-placeholder',
    corsMode: CORS_ORIGINS.includes('*') ? 'permissive' : 'allowlist',
    authEnabled: Boolean(process.env['AGENT_AUTH_TOKENS']?.trim()),
  }),
);

app.post('/agents/:id/run', async (c) => handler(c.req.raw));

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  log.info('listening', {
    port: info.port,
    agents: [...agents.keys()],
    matters: listMatters().length,
  });
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutdown initiated', { signal });
  server.close(() => {
    log.info('shutdown complete');
    process.exit(0);
  });
  setTimeout(() => {
    log.warn('forced exit (drain timeout)');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  log.error('uncaughtException', { err: err instanceof Error ? err.message : String(err) });
});
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', { reason: reason instanceof Error ? reason.message : String(reason) });
});
