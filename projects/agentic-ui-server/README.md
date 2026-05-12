# @infra-tools/agentic-ui-server

[![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-server.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-server)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

Server-side helpers for [`@infra-tools/agentic-ui`](https://www.npmjs.com/package/@infra-tools/agentic-ui) — a generic `ServerAgent` interface, an **AG-UI SSE route handler**, and an in-memory `ThreadStateStore` for development.

Framework-agnostic: works with Hono, Express, Fastify, Bun, Deno — anywhere you can call `(req: Request) => Promise<Response>`.

> Looking for **production** thread state? See [`@infra-tools/agentic-ui-server-stores`](https://github.com/sahassakhare/agentic-ui/tree/main/projects/agentic-ui-server-stores) for the Redis + Postgres adapters.

## Install

```bash
npm install @infra-tools/agentic-ui-server
```

## Minimum-viable Hono server

```ts
import { Hono } from 'hono';
import { agUiRouteHandler, EchoAgent } from '@infra-tools/agentic-ui-server';

const handler = agUiRouteHandler({
  agents: {
    echo: new EchoAgent(),
    // gemini: new GeminiAgent({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY! }),
  },
});

const app = new Hono();
app.post('/agents/:id/run', (c) => handler(c.req.raw));

export default { port: 4111, fetch: app.fetch };
```

`POST /agents/echo/run` is now an AG-UI compatible SSE endpoint your `<mvk-chat-shell>` can talk to via `provideAgUiBackend({ url: 'http://localhost:4111/agents/echo/run' })`.

## What's exported

| Surface | Purpose |
|---------|---------|
| `agUiRouteHandler({ agents })` | Build a `(Request) => Promise<Response>` that resolves the path's `agent-id` to a registered `ServerAgent` and streams AG-UI events back as SSE |
| `ServerAgent` (interface) | The contract your agents implement — `run(input)` returns an `AsyncIterable<AgenticEvent>` |
| `AgentResolver` (interface) | Bring-your-own routing if the static `agents: { id: agent }` map isn't enough (e.g. database-backed agent registries) |
| `EchoAgent` | Reference `ServerAgent` that echoes the user's prompt back token-by-token. Useful for end-to-end smoke tests without an LLM key |
| `InMemoryThreadStore` / `ThreadStore` | Per-thread message-history store (in-memory; swap to Redis/Postgres for multi-pod) |
| `InMemoryThreadStateStore` / `ThreadStateStore<TState>` | Typed per-thread state store (orchestrator routing decisions, conversation phase, etc.) |

## Writing a `ServerAgent`

```ts
import type { ServerAgent, AgUiRunInput } from '@infra-tools/agentic-ui-server';

export class MyAgent implements ServerAgent {
  async *run(input: AgUiRunInput) {
    const userText = input.messages.at(-1)?.content as string ?? '';

    yield { type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId };
    yield { type: 'TEXT_MESSAGE_START', messageId: '1', role: 'assistant' };
    yield { type: 'TEXT_MESSAGE_CONTENT', messageId: '1', delta: `you said: ${userText}` };
    yield { type: 'TEXT_MESSAGE_END', messageId: '1' };
    yield { type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId };
  }
}
```

Register it and it's reachable from any `<mvk-chat-shell>`.

## Demos that use this package

| Demo | What it shows | Source |
|---|---|---|
| `demo-server` | Six `ServerAgent` implementations (`echo`, `gemini`, three specialists, an orchestrator) under one Hono process on `:4111` | [`examples/demo-server/`](https://github.com/sahassakhare/agentic-ui/tree/main/examples/demo-server) |
| `demo-ediscovery-server` | OrchestratorAgent routing to 4 specialists with per-thread sticky routing via `ThreadStateStore` | [`examples/demo-ediscovery-server/`](https://github.com/sahassakhare/agentic-ui/tree/main/examples/demo-ediscovery-server) |

## Production thread state (Redis / Postgres)

`InMemoryThreadStateStore` is for development — it loses everything on pod restart and doesn't share across pods. For production deploys, install [`@infra-tools/agentic-ui-server-stores`](https://github.com/sahassakhare/agentic-ui/tree/main/projects/agentic-ui-server-stores) and use `RedisThreadStateStore` or `PostgresThreadStateStore` as drop-in replacements.

## Full docs

- [User Guide](https://github.com/sahassakhare/agentic-ui/blob/main/docs/USER_GUIDE.md) — end-to-end walkthrough including the server tier
- [Production deployment cookbook](https://github.com/sahassakhare/agentic-ui/blob/main/docs/cookbook/production-deployment.md) — what changes between localhost and a multi-pod K8s deploy
- [ADR-012 — Thread state store adapters](https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0012-thread-state-store-adapters.md)
- [ADR-035 — Runtime SSE stream](https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0035-runtime-sse-stream.md)

## Compatibility

| Tool | Version |
|------|---------|
| Node.js | ≥ 20.19 |
| TypeScript | 5.9+ |
| Web Fetch API | required (use `node-fetch` polyfill on Node < 18) |

## License

[Apache 2.0](./LICENSE)
