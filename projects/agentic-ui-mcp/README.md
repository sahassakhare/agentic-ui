# @infra-tools/agentic-ui-mcp

[![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-mcp.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

Expose [`@infra-tools/agentic-ui`](https://www.npmjs.com/package/@infra-tools/agentic-ui) `ToolDef`s as a **Model Context Protocol (MCP)** server. The same tools your `<mvk-chat-shell>` invokes become callable from **Claude Desktop**, **Cursor**, **Zed**, **Continue**, **Windsurf**, and any other MCP-compatible host — without rewriting the handlers.

See [ADR-006](https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0006-mcp-server-side-adapter.md) for the design rationale.

## Install

```bash
npm install @infra-tools/agentic-ui-mcp
```

Peer dep: `@infra-tools/agentic-ui` (you'll already have it if you're publishing tools you wrote for the chat shell). `zod` is the validation library `ToolDef`s use.

## Wrap your tools as an MCP server

```ts
// my-mcp-server.ts (run with `tsx`/`node`)
import { createMcpServer } from '@infra-tools/agentic-ui-mcp';
import { myTools } from './tools.js';   // your existing ToolDef[]

const server = createMcpServer({
  name: 'my-server',
  version: '0.1.0',
  tools: myTools,
});

await server.start();   // stdio transport by default
```

```jsonc
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["/absolute/path/to/my-mcp-server.js"]
    }
  }
}
```

Restart Claude Desktop. Your tools are now in the tool picker.

## What's exported

| Surface | Purpose |
|---------|---------|
| `createMcpServer(opts)` | Builds an MCP `Server` that exposes the given `ToolDef[]` as MCP tools. Returns a handle with `start()` / `stop()` |
| `BeforeCallHook` / `AfterCallHook` | Per-tool middleware seams — log every invocation, redact PII, fail closed on policy violations |
| `formatToolResult(result)` | Maps an `agentic-ui` tool result (text + render hints + components) into MCP `ContentBlock[]`. Honours the `text/html;profile=mcp-app` MIME for inline-rendered HTML |
| `zodToMcpSchema(schema, name)` | Translates a Zod input schema into the JSON-Schema fragment MCP requires |
| `syntheticToolContext({...})` | Builds a `ToolContext` shaped to satisfy your existing handler when invoked from MCP (no `Component`, no `Backend` — those are browser concerns) |
| `MCP_UI_HTML_MIME` | The `text/html;profile=mcp-app` constant for tools that return HTML render hints |

## Common patterns

### Per-user audit attribution

```ts
const server = createMcpServer({
  name: 'ediscovery',
  version: '0.1.0',
  tools,
  beforeCall: async (ctx) => {
    ctx.principal = await resolvePrincipal({
      userId: process.env.MCP_USER_ID,            // set per-user in env
      mcpClient: ctx.clientInfo?.name ?? 'unknown',
    });
  },
  afterCall: async (ctx, result) => {
    auditChain.append({
      tool: ctx.toolName,
      principal: ctx.principal,
      args: ctx.args,
      result,
      origin: 'mcp',
      ts: new Date().toISOString(),
    });
  },
});
```

### Inline-rendering HTML in MCP hosts that support it

When a tool returns `{ ...result, renderHints: { html: '<...>' } }`, `formatToolResult` emits a content block with MIME `text/html;profile=mcp-app`. Cursor and Continue render this inline; Claude Desktop falls back to the plain-text representation.

## Demos

- [`examples/demo-ediscovery-mcp`](https://github.com/sahassakhare/agentic-ui/tree/main/examples/demo-ediscovery-mcp) — five eDiscovery tools exposed via `@infra-tools/agentic-ui-mcp` for analyst workstations. Phase 6 of the [eDiscovery plan](https://github.com/sahassakhare/agentic-ui/blob/main/docs/plans/ediscovery-app-plan.md).
- [`examples/demo-mcp-server`](https://github.com/sahassakhare/agentic-ui/tree/main/examples/demo-mcp-server) — minimal generic MCP server scaffold.

## Full docs

- [Cookbook: Expose your tools as an MCP server](https://github.com/sahassakhare/agentic-ui/blob/main/docs/cookbook/mcp-server.md) — install → wire `claude_desktop_config.json` → transport choices → before/after-call patterns → production checklist
- [Cookbook: Paralegal privilege review in Claude Desktop](https://github.com/sahassakhare/agentic-ui/blob/main/docs/cookbook/paralegal-mcp-review.md) — end-to-end walkthrough with the eDiscovery flagship
- [ADR-006 — MCP server-side adapter](https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0006-mcp-server-side-adapter.md)

## Compatibility

| Tool | Version |
|------|---------|
| Node.js | ≥ 20.19 |
| TypeScript | 5.9+ |
| MCP SDK | `^1.0.0` (transitive via `@modelcontextprotocol/sdk`) |

## License

[Apache 2.0](./LICENSE)
