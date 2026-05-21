# @infra-tools/agentic-ui-webmcp

WebMCP adapter for `@infra-tools/agentic-ui` — exposes the host app's `ToolRegistry` to an in-browser agent via the [WebMCP (`navigator.modelContext`) proposal](https://github.com/webmachinelearning/webmcp).

The mirror image of [`@infra-tools/agentic-ui-mcp`](../agentic-ui-mcp/) (a Node MCP server): same `ToolRegistry` source, different (browser) transport. Phase 2 of the [MCP-UI + WebMCP plan](../../docs/plans/mcp-ui-webmcp-support-plan.md). Security model in [ADR-050](../../docs/adr/0050-webmcp-tool-exposure.md).

> **`navigator.modelContext` is a draft proposal.** This adapter feature-detects it and degrades to a no-op (with one telemetry signal) when the browser doesn't implement it. No errors, no crashes — your app runs unchanged.

## Install

```bash
npm install @infra-tools/agentic-ui-webmcp
```

## Quick start

```ts
import { provideWebMcp } from '@infra-tools/agentic-ui-webmcp';
import { inject } from '@angular/core';
import { AGENTIC_ACTIVE_PERSONA, provideAgenticUi } from '@infra-tools/agentic-ui';

export const appConfig = {
  providers: [
    provideAgenticUi({ tools, widgets }),
    provideWebMcp({
      // Read your active persona so approval policies gate correctly.
      persona: () => inject(AGENTIC_ACTIVE_PERSONA)(),
    }),
  ],
};
```

That's it. Every tool **visible through the current scope policy** is mirrored into `navigator.modelContext`. The mirror is reactive — register a tool, federate a remote, or change the scope policy, and the WebMCP tool list re-syncs on the next change.

## What it does

1. **Reactive registration** — subscribes to `ToolRegistry.signal()`; registers each scope-visible tool with `navigator.modelContext.registerTool({ name, description, inputSchema, execute })`. Re-syncs (register new, unregister vanished) whenever the visible set changes.
2. **Schema fidelity** — each tool's Zod schema is converted to JSON Schema (`zodToWebMcpSchema`) so the in-browser agent sees the full argument shape, not just the name.
3. **Scope enforcement** — only tools the active persona can see are exposed (`ToolRegistry.list/get` apply the scope policy on read). A tool hidden from the persona is never registered, and inbound calls re-check.
4. **Approval gating** — a tool with an `agenticApproval` policy whose `required(args, ctx)` returns true is **not auto-executed**; the call queues an `Approval` and returns a pending result, mirroring the chat-shell HITL intercept.
5. **Telemetry** — emits `agentic.tool_call.start/end` (with `webmcp.origin`), `agentic.webmcp.call_blocked`, `agentic.webmcp.call_queued_for_approval`, and `agentic.webmcp.unavailable`.

## Security model (ADR-050)

| Concern | Behaviour |
|---|---|
| Tool visibility | Scope-policy gated. Hidden tools never registered; inbound calls re-check. |
| Privileged actions | Approval-policy gated — queued, not auto-executed. |
| Arg integrity | Validated against the tool's Zod schema before the handler runs. |
| Defense in depth | Like all client-side gating, server-side enforcement is still required for HITL-critical tools (standard [ADR-008](../../docs/adr/0008-registry-scope-policy.md) note). |

## API

- `provideWebMcp(options?)` — wires the adapter. `options`: `persona` (getter), `source` (telemetry tag), `modelContext` (override for tests).
- `WebMcpService` — the DI service; `start()` returns a disposer.
- `zodToWebMcpSchema(schema)` — Zod → WebMCP JSON Schema.
- `getModelContext(nav?)` — feature-detect helper.

## License

[Apache 2.0](../../LICENSE)
