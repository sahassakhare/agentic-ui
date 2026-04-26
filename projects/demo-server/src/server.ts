import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { agUiRouteHandler, EchoAgent, type AgentResolver, type ServerAgent } from '@maverick/agentic-ui-server';
import { GeminiAgent } from './gemini-agent.js';

const PORT = Number(process.env['PORT'] ?? 4111);

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
    origin: (origin) => origin ?? '*',
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Accept'],
  }),
);

app.get('/health', (c) =>
  c.json({
    ok: true,
    agents: [...agents.keys()],
    geminiConfigured: Boolean(geminiAgent),
  }),
);

app.post('/agents/:id/run', async (c) => handler(c.req.raw));

serve({ fetch: app.fetch, port: PORT }, (info) => {
  const base = `http://localhost:${info.port}`;
  console.log(`[demo-server] listening on ${base}`);
  console.log(`[demo-server]   /health           ${base}/health`);
  console.log(`[demo-server]   echo agent (no LLM)   POST ${base}/agents/echo/run`);
  if (geminiAgent) {
    console.log(`[demo-server]   gemini agent          POST ${base}/agents/gemini/run`);
  } else {
    console.log(`[demo-server]   gemini agent NOT configured (set GOOGLE_GENERATIVE_AI_API_KEY in .env to enable).`);
  }
});
