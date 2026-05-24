/**
 * Demo MCP server. Exposes the bookings/loyalty/support tools — the
 * SAME `ToolDef[]` the Angular `demo-monolith` chat shell registers —
 * as a Model Context Protocol server.
 *
 * Mounts via stdio for Claude Desktop / Cursor / Zed:
 *
 * ```jsonc
 * // ~/Library/Application Support/Claude/claude_desktop_config.json
 * {
 *   "mcpServers": {
 *     "maverick-demo": {
 *       "command": "/abs/path/to/node",
 *       "args": ["/abs/path/to/agentic-ui/examples/demo-mcp-server/dist/index.js"]
 *     }
 *   }
 * }
 * ```
 *
 * After restarting Claude Desktop, type "Book a flight from LAX to JFK
 * on May 5" and the bookFlight handler runs against the demo's mock
 * data, rendered as MCP-UI HTML (or a markdown table on hosts without
 * UI support).
 *
 * @remarks
 * **Single tool source (no drift).** The tools come from
 * `@infra-tools/demo-shared-tools` — a zero-Angular-import package that
 * both this server and the Angular `demo-monolith` import. Previously
 * this file hand-redeclared `bookFlightTool` because importing the
 * `@infra-tools/agentic-ui` barrel drags Angular's compiler into Node;
 * the shared package solves that structurally (its `ToolDef` literals use
 * a type-only import of `ToolDef`, erased at compile, so it stays
 * Node-safe). See docs/plans/unified-agentic-protocol-interface-plan.md.
 */
import { createMcpServer } from '@infra-tools/agentic-ui-mcp';
import { sharedTools } from '@infra-tools/demo-shared-tools';

// ── MCP App (SEP-1865) — interactive flight card ──────────────────────────
//
// A self-contained, predeclared UI template. MCP-Apps hosts (Claude Desktop,
// VS Code Copilot, …) fetch it via resources/read, render it in a sandboxed
// iframe, and push the bookFlight result to it as a `ui/notifications/tool-result`
// JSON-RPC message over postMessage. The template renders from that data —
// it ships no booking values itself (presentation/data are separated per SEP).
const FLIGHT_CARD_URI = 'ui://maverick/flight-card';
const FLIGHT_CARD_APP = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { margin:0; font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; color:#0f172a; background:transparent; }
  .card { padding:1rem 1.2rem; border:1px solid #d1d5db; border-radius:0.6rem; background:#fff; border-left:4px solid #2563eb; max-width:480px; }
  .head { display:flex; gap:0.6rem; align-items:center; margin-bottom:0.5rem; }
  .badge { font-size:0.7em; padding:2px 6px; border-radius:4px; background:#dbeafe; color:#1e3a8a; text-transform:uppercase; letter-spacing:0.04em; font-weight:600; }
  .route { font-weight:600; font-size:1.05rem; }
  .status { margin-left:auto; font-size:0.75em; padding:2px 8px; border-radius:999px; background:#d1fae5; color:#065f46; }
  .date { margin:0.4rem 0 0.2rem; color:#4b5563; }
  .ref { margin:0; color:#6b7280; font-size:0.85em; }
  code { background:#f1f5f9; padding:1px 5px; border-radius:3px; }
  .loading { color:#6b7280; padding:0.5rem; }
  .dbg { font-size:0.8rem; color:#374151; }
  .dbg pre { background:#f8fafc; border:1px solid #e5e7eb; border-radius:6px; padding:0.5rem; overflow:auto; max-height:260px; font-size:0.72rem; }
</style></head>
<body>
  <div id="root" class="loading">Preparing your flight…</div>
  <script>
  (function(){
    var rendered = false;
    var log = [];
    function send(m){ try { parent.postMessage(m, '*'); } catch (e) {} }
    function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
    function render(d){
      if (rendered || !d || !d.from) return;
      rendered = true;
      document.getElementById('root').outerHTML =
        '<article class="card"><div class="head">' +
          '<span class="badge">flight</span>' +
          '<span class="route">' + esc(d.from) + ' → ' + esc(d.to) + '</span>' +
          '<span class="status">' + esc(d.status || 'confirmed') + '</span>' +
        '</div>' +
        '<p class="date">' + esc(d.date) + '</p>' +
        '<p class="ref">Booking: <code>' + esc(d.bookingId) + '</code></p></article>';
    }
    // Pull the booking object out of whatever shape the host delivers.
    function pick(o, depth){
      if (!o || typeof o !== 'object' || depth > 4) return null;
      if (o.from && o.to) return o;
      return pick(o.structuredContent, depth + 1) ||
             pick(o.toolResult && o.toolResult.structuredContent, depth + 1) ||
             pick(o.result && o.result.structuredContent, depth + 1) ||
             pick(o.params, depth + 1) ||
             pick(o.data, depth + 1) ||
             pick(o.output, depth + 1) || null;
    }
    // SEP-1865 handshake.
    send({ jsonrpc: '2.0', id: 1, method: 'ui/initialize',
           params: { appInfo: { name: 'maverick-flight-card', version: '1.0.0' }, appCapabilities: {} } });
    // Channel 1 — postMessage (SEP / MCP-UI).
    addEventListener('message', function (e) {
      log.push(e.data);
      var d = pick(e.data, 0);
      if (d) render(d);
    });
    // Channel 2 — OpenAI Apps SDK style globals, if the host uses them.
    function tryGlobals(){
      try { if (window.openai && window.openai.toolOutput) render(window.openai.toolOutput); } catch (e) {}
    }
    addEventListener('openai:set_globals', tryGlobals);
    // Poll briefly for globals; if still nothing, dump what we saw so the
    // host's actual data contract can be wired precisely.
    var n = 0, iv = setInterval(function(){
      tryGlobals();
      if (rendered || ++n > 15) {
        clearInterval(iv);
        if (!rendered) {
          var info = {
            receivedMessages: log,
            hasWindowOpenai: typeof window.openai,
            interestingGlobals: Object.keys(window).filter(function(k){ return /mcp|openai|host|anthropic|claude|tool/i.test(k); })
          };
          var el = document.getElementById('root');
          if (el) el.innerHTML = '<div class="dbg"><strong>Flight card mounted, but no booking data arrived.</strong>' +
            '<p>Share this with the developer to wire the data channel:</p><pre>' + esc(JSON.stringify(info, null, 2)) + '</pre></div>';
        }
      }
    }, 150);
  })();
  </script>
</body></html>`;

// ── Wire the MCP server ───────────────────────────────────────────────────

const handle = createMcpServer({
  name: 'maverick-demo',
  version: '0.1.0',
  tools: sharedTools,
  // MCP Apps (SEP-1865): predeclare the flight-card template and link it to
  // bookFlight so MCP-Apps hosts render it as an interactive card. Hosts that
  // don't support MCP Apps still get the markdown text fallback.
  uiResources: [{ uri: FLIGHT_CARD_URI, html: FLIGHT_CARD_APP, name: 'Flight card' }],
  toolUi: { bookFlight: { resourceUri: FLIGHT_CARD_URI } },
  // Optional: log every call to stderr (stdout is reserved for MCP messages).
  // Visible in Claude Desktop's logs at
  //   ~/Library/Logs/Claude/mcp-server-maverick-demo.log
  beforeCall: ({ name, callId }) => {
    console.error(`[mcp] ${callId} → ${name}`);
  },
  afterCall: ({ name, callId, durationMs, ok }) => {
    console.error(`[mcp] ${callId} ← ${name} (${durationMs}ms, ${ok ? 'ok' : 'failed'})`);
  },
});

await handle.startStdio();
console.error('[mcp] maverick-demo MCP server connected over stdio');
