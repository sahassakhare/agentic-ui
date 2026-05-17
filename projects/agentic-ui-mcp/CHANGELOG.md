# Changelog

All notable changes to `@infra-tools/agentic-ui-mcp` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — MCP UI support

- **`html` render-hint field is now active** as the highest-precedence channel in `formatToolResult`. When present, the adapter emits an MCP `resource` content block with `mimeType: text/html;profile=mcp-app` — the format Claude Desktop and Cursor announce via their `io.modelcontextprotocol/ui` capability. Hosts that recognise it iframe-render the HTML in a sandbox; hosts that don't fall back to the resource's text representation.
- **`MCP_UI_HTML_MIME` constant** exported for consumers building their own formatter wrappers.
- **`McpContentBlock` union extended** to include the `resource` block variant in addition to the existing `text` block.
- **Demo update** (`examples/demo-mcp-server`): `bookFlight` now returns a styled HTML flight card via the `html` field, with the existing `components` + `markdown` fields preserved as fallbacks for the chat shell and markdown-only hosts.
- **Cookbook section** on MCP UI rendering, sandboxing constraints, and the precedence table.

### Notes

- The `html` field was previously declared as "reserved" on `ToolResultRenderHints` for forward compatibility — that note is removed; consumers can include it today and MCP UI hosts will render it.
- The `iframe_url` field remains reserved (live-widget URL pattern) — not yet activated.
- All additions backward-compatible: tools that don't include `html` behave exactly as before. Existing tests pass; 24 total now (up from 19).

## [0.1.0] — first release

### Added

- **`createMcpServer({ name, version, tools, beforeCall?, afterCall? })`** — wraps any list of `@infra-tools/agentic-ui` `ToolDef`s as a Model Context Protocol server. Hosts that consume MCP servers (Claude Desktop, Cursor, Continue, Zed, Windsurf, the upcoming Copilot MCP support) can mount the server and invoke its tools.
- **Three transports** on the returned `McpServerHandle`:
  - `startStdio()` — default for desktop MCP hosts; reads stdin / writes stdout.
  - `startHttp({ port, cors? })` — Server-Sent Events for remote MCP hosts. CORS allowlist optional but recommended for production.
  - `handleRequest(req)` — embeddable single-request handler for integration with existing HTTP servers (Hono / Express / Fastify).
- **`beforeCall` / `afterCall` hooks** — the seam for auth, audit logging, rate limiting, and telemetry. `beforeCall` throwing rejects the request with an MCP error; `afterCall` exceptions are caught and logged but don't change the response.
- **`zodToMcpSchema(schema, toolName)`** — exported helper that converts a tool's Zod schema to MCP-compatible JSON Schema. Reuses `zod-to-json-schema` (already a transitive dep through the core lib) and post-processes for the MCP dialect (strips `$schema`, asserts `type: 'object'`, etc.).
- **`syntheticToolContext({ serverName, callId, signal? })`** — exported helper that synthesises a `ToolContext` for handlers invoked through MCP. `threadId` is set to `mcp:<serverName>` so cross-call telemetry can be aggregated.
- **`formatToolResult(result)`** — exported helper that maps a tool handler's return value to MCP `content` blocks via the multi-shape return convention: `markdown` field → `text/markdown`; `image_url` field → markdown image embed; otherwise → JSON-stringified domain data with render-hint fields stripped.
- **`McpContentBlock`, `McpInputSchema`, `CreateMcpServerOptions`, `McpServerHandle`, `BeforeCallHook`, `AfterCallHook`, `McpCallContext`** — full public type surface.

### Architecture decisions

- [ADR-006](../../docs/adr/0006-mcp-server-side-adapter.md) — MCP server-side adapter design + production-grade scope + reserved fields for ADR-007 (MCP UI integration).

### Compatibility

- Node 20.19+
- TypeScript 5.9+
- `@modelcontextprotocol/sdk` ^1.0.0 (pinned — bump deliberately)
- `@infra-tools/agentic-ui` ^1.0.0 (peer)
- `zod` ^3.23.0 (peer)

### Production-grade scope

The published API is stable, tested (19 unit tests across 3 files), and works against today's MCP hosts. **Operational hardening for a 100-team multi-tenant deployment is consumer-side / opt-in**, matching the rest of the v1 library. Specifically:

- Stdio is single-tenant by design (one MCP host per process).
- HTTP transport's CORS + bearer-token gate is sample code, not a complete identity layer — wrap with reverse-proxy auth or implement OAuth in `beforeCall`.
- No baked-in OTel span emission — the `beforeCall` / `afterCall` hooks are the seam.
- MCP spec version coverage: `^1.0`. Cross-version negotiation belongs in v0.2.

The cookbook entry calls these out up front so adopters know what's theirs to own.

### Known limitations

- The `embeddable` transport calls a private SDK method (`Server._handleRequest`); when the SDK formalises a public embeddable API we'll switch. For now, pin to a tested SDK version.
- `image_url` render-hint is embedded as markdown image syntax (`![](url)`) rather than an MCP `image` resource block — markdown is portable across all hosts; the resource type requires a base64 blob or in-line text which isn't a fit for arbitrary URLs.
- Reserved render-hint fields (`html`, `iframe_url`) are declared in the core lib's `ToolResultRenderHints` interface but not yet processed — see ADR-007 (MCP UI integration) for the activation plan.
