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
    createSpecialist({
      id: 'review',
      factory: (id) => new GeminiAgent(id, {
        apiKey, model,
        systemInstruction:
          'You are an eDiscovery review specialist. Help users search the document set, tag ' +
          'documents (responsive, non-responsive, privileged, hot, redact, review-needed), ' +
          'mark documents privileged with an explicit reason (attorney-client, work-product, ' +
          'common-interest), and append entries to the privilege log. ' +
          'Workflow: when the user mentions a person or topic rather than a document id, ' +
          'call `searchDocuments` first, then act on the returned ids — never guess document ids. ' +
          'Privilege calls are sensitive: confirm the reason matches the document content.' +
          sharedRules,
      }),
      description: 'document search, tagging, privilege review, privilege-log entries',
      examples: [
        'Find all emails between Sarah Chen and the CFO about Project Phoenix',
        'Tag DOC-7891234 as responsive',
        'Mark DOC-7891236 as attorney-client privileged',
        'Search for any documents mentioning the Q4 restatement',
        'Add a privilege-log entry summarising today\'s privilege review',
      ],
    }),
    createSpecialist({
      id: 'production',
      factory: (id) => new GeminiAgent(id, {
        apiKey, model,
        systemInstruction:
          'You are an eDiscovery production specialist. Build production sets ' +
          'opposing counsel will receive. The standard chain is:\n' +
          '  1) `createProductionSet` — name, format (native/tiff/pdf/load-file), ' +
          'Bates pattern, scope filters\n' +
          '  2) optional `redactDocument` — apply redactions per page + bbox + reason ' +
          '(pii / privilege / confidential)\n' +
          '  3) `assignBatesNumbers` — stamps sequential ids per the pattern\n' +
          '  4) `exportProductionSet` — finalises (and optionally delivers) the set\n\n' +
          'Bates patterns use Python format syntax — `ACME-{seq:07d}` is seven digits ' +
          'zero-padded. Reject anything that does not match `<PREFIX>-{seq:Nd}`. ' +
          'NEVER call `exportProductionSet` with `deliver: true` without an explicit ' +
          'user reason — delivery is irreversible.' +
          sharedRules,
      }),
      description: 'production-set creation, Bates assignment, redaction, export delivery',
      examples: [
        'Create production PROD-002 with all responsive non-privileged docs from January, TIFF format, Bates ACME-{seq:07d}',
        'Assign Bates numbers to PROD-A1B2 starting at 1',
        'Redact the SSN on page 1 of DOC-7891238 — pii, bbox [120,400,180,18]',
        'Finalise PROD-A1B2 and deliver — reason "settlement scheduled for Friday"',
        'What productions are pending review on this matter?',
      ],
    }),
    createSpecialist({
      id: 'search',
      factory: (id) => new GeminiAgent(id, {
        apiKey, model,
        systemInstruction:
          'You are an eDiscovery search specialist. Help users find documents ' +
          'across the matter using:\n' +
          '  • `semanticSearch` — natural-language ranking by similarity\n' +
          '  • `filterByDateRange` — narrow to an authoring window (returns a histogram)\n' +
          '  • `filterByCustodians` — resolve names/departments to CUST-ids before ranking\n' +
          '  • `runTARClassifier` — score un-tagged docs for responsive/privileged/hot\n\n' +
          'Workflow: when the user mentions people, call `filterByCustodians` first ' +
          'to resolve to ids — never guess CUST-ids. When the user gives a time ' +
          'window, call `filterByDateRange` first to scope the matter. When the user ' +
          'asks for "documents about X", `semanticSearch` is the entry point.' +
          sharedRules,
      }),
      description: 'document search, custodian/date filters, TAR classification',
      examples: [
        'Find documents semantically similar to Project Phoenix budget overrun',
        'Show all documents authored in Q1 2025',
        'Resolve Sarah Chen and Marcus Webb to custodian ids',
        'Run TAR classification on the un-tagged set for topic Project Phoenix',
        'Search Engineering custodians for documents about the data plane redesign',
      ],
    }),
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
