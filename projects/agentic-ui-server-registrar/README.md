# @infra-tools/agentic-ui-server-registrar

[![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-server-registrar.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-server-registrar)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

Server-side helper for [`@infra-tools/agentic-ui`](https://www.npmjs.com/package/@infra-tools/agentic-ui) agent deployments. Auto-registers your agent server with the **Maverick catalog** at boot, sends periodic heartbeats so operators see "is the coordinator alive" in the ops console, and gracefully marks itself inactive on `SIGTERM`.

Slice AGT / [ADR-039](https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0039-agent-auto-registration.md). Mirrors the runtime tier's `provideCatalogCapabilityRegistrar` pattern ([ADR-032](https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0032-catalog-capability-registrar.md)) on the server side.

## Install

```bash
npm install @infra-tools/agentic-ui-server-registrar
```

## Wire it up

```ts
// In your agent server's main.ts:
import { registerAgentWithCatalog } from '@infra-tools/agentic-ui-server-registrar';

const reg = await registerAgentWithCatalog({
  catalogUrl: process.env.CATALOG_URL!,
  tenantId:   process.env.TENANT_ID!,
  getToken:   () => process.env.CATALOG_TOKEN ?? null,
  agent: {
    name: 'gemini-coordinator',
    kind: 'ag-ui',
    manifestUrl: process.env.PUBLIC_URL!,
    capabilities: server.toolNames(),
  },
  heartbeatIntervalMs: 30_000,
});

// Graceful shutdown — flips status to 'inactive' so operators don't
// see a stale 'active' row.
process.on('SIGTERM', () => reg.shutdown());
```

## Semantics

- **Idempotent registration.** `POST /agents` returns `409` on duplicate `(tenant, name)` — the helper treats `409` as success.
- **Best-effort heartbeats.** The catalog flips status to `degraded` after 2× missed heartbeats. A background sweeper marks `inactive` after a grace window.
- **Graceful shutdown.** `reg.shutdown()` cancels the heartbeat timer and posts a final `inactive` status update.
- **No LLM, no `@infra-tools/agentic-ui` dep.** This is a pure protocol shim — works with any agent server that wants to surface in the catalog.

## Compatibility

| Tool | Version |
|------|---------|
| Node.js | ≥ 20.19 |
| TypeScript | 5.9+ |
| Web Fetch API | required (use a polyfill on Node < 18) |

## License

[Apache 2.0](./LICENSE)
