# Developer Guide — `@infra-tools/agentic-ui`

> **Audience**: developers building their own agentic UI on top of this library.
> **Companion docs**: [USER_GUIDE.md](./USER_GUIDE.md) walks the included demos; the [cookbook](./cookbook/) is topic-shaped. This guide is the **sequenced journey** — what to do first, then next, then next, with clear stop points if you don't need a given feature.
> **Time to "Hello, agent"**: ~15 minutes (steps 1–6). Everything beyond step 6 is opt-in.

---

## Mental model (read this first)

Three primitives carry the whole library:

1. **Tools** — typed handlers the LLM can call (`bookFlight`, `searchDocuments`, …). You write them; the LLM picks which one to invoke based on the user's prompt and the tool's Zod-typed argument schema.
2. **Widgets** — Angular components the LLM can render by name (`flightCard`, `documentPreview`, …). You author them as normal standalone components and register them with a name + props schema.
3. **Backends** — wire adapters that stream events from your agent server. You pick one (AG-UI by default); your application code stays unchanged.

All three live in **registries** — DI-backed signal-driven catalogs the chat shell reads from at runtime. Adding a tool or widget is a registry entry; removing one is a `removeBySource(...)` call.

The chat shell (`<mvk-chat-shell>`) is the visible primitive. Behind it sits:

```
user prompt → chat shell → backend.run() → agent server → LLM
                  ↑                                          ↓
                  ←——— widget mounted ←—— tool result ←——— tool call event
                                          (your handler ran here)
```

You don't write that loop. You write tools, widgets, and (if needed) an agent server. The rest is wired by `provideAgenticUi(...)` + a backend provider.

---

## Step-by-step

The 19 steps below are ordered by dependency, not by every-app-needs-this. Steps 1–6 are the minimum to ship something useful. Steps 7+ are opt-in features, each with an explicit "skip if…" clause.

| Step | Goal | Skip if… |
|---|---|---|
| 1 | Install + bootstrap | — (required) |
| 2 | Wire `<mvk-chat-shell>` | — (required) |
| 3 | Wire a backend | — (required) |
| 4 | Define your first tool | …you only need a text chatbot |
| 5 | Define your first widget | …you only need text replies |
| 6 | Run an agent server | …you already have one |
| 7 | Plug in a real LLM | …you're prototyping with the Echo agent |
| 8 | Add forms (F1) | …agent doesn't need to collect structured input |
| 9 | Add approvals (F4 — HITL) | …no tool needs human sign-off |
| 10 | Add long-running operations (F5) | …all tools finish in seconds |
| 11 | Add multi-modal input (F6) | …text-only is fine |
| 12 | Federate capabilities from MFE remotes | …you're a single team / monolith |
| 13 | Add persona scope filtering | …all users see all tools |
| 14 | Wire telemetry (OpenTelemetry) | …console logs are enough |
| 15 | Wire the catalog platform | …you don't need cross-app capability discovery |
| 16 | Expose tools via MCP | …you don't need Claude Desktop / Cursor / Zed integration |
| 17 | Expose the agent in Teams / M365 Copilot | …Teams + Copilot aren't your distribution surfaces |
| 18 | Production deployment | — (required at ship time) |
| 19 | Observability + cost guardrails | — (required at scale) |

---

## Step 1 — Install + bootstrap

**Goal**: a fresh Angular 21 app with `@infra-tools/agentic-ui` registered as a provider.

```bash
ng new my-agentic-app --standalone --skip-tests
cd my-agentic-app
ng add @infra-tools/agentic-ui --backend=ag-ui
```

`ng add` patches `app.config.ts` with `provideAgenticUi()` + `provideAgUiBackend(...)`, scaffolds `src/app/agentic/{tools,widgets}.ts`, and adds the required peer dependencies (`@angular/common`, `@angular/core`, `rxjs`, `zod`).

Equivalent manual setup if you skip `ng add`:

```ts
// src/app/app.config.ts
import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideAgenticUi, provideAgUiBackend } from '@infra-tools/agentic-ui';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideAgenticUi({ tools: [], widgets: [] }),
    provideAgUiBackend({ url: 'http://localhost:4111/agents/echo/run' }),
  ],
};
```

**Cross-reference**: [cookbook/quickstart.md](./cookbook/quickstart.md), [cookbook/integrate-into-existing-angular-app.md](./cookbook/integrate-into-existing-angular-app.md) for adopting into an established Angular app.

---

## Step 2 — Wire `<mvk-chat-shell>`

**Goal**: a working chat UI on a route.

```ts
// src/app/app.ts
import { Component } from '@angular/core';
import { ChatShellComponent } from '@infra-tools/agentic-ui';

@Component({
  selector: 'app-root',
  imports: [ChatShellComponent],
  template: `
    <main>
      <mvk-chat-shell />
    </main>
  `,
})
export class App {}
```

`ng serve` should show a working composer. You can type but the backend isn't pointed at a live server yet — step 3 handles that.

---

## Step 3 — Wire a backend

**Goal**: pick the protocol that connects your chat shell to an agent server.

`provideAgUiBackend({ url })` is the default and the most-tested adapter. Hashbrown (`provideHashbrownBackend`) and A2UI (`provideA2uiBackend`) are also production-grade client adapters but you need to write the server for those — see the [Backend support matrix](../README.md#backend-support-matrix) and [ADR-048](./adr/0048-backend-adapter-parity-contract.md).

If your agent server isn't running yet, point at the Echo agent that step 6 will boot:

```ts
provideAgUiBackend({ url: 'http://localhost:4111/agents/echo/run' })
```

To swap backends at runtime (e.g. let an admin pick the protocol):

```ts
import { BackendRegistry, provideAgUiBackend, provideHashbrownBackend } from '@infra-tools/agentic-ui';

// app.config.ts
providers: [
  provideAgenticUi({...}),
  provideAgUiBackend({ url: '...' }),
  provideHashbrownBackend({ url: '...' }),
]

// somewhere in your app
constructor(private backends: BackendRegistry) {}
useHashbrown() { this.backends.setActive('hashbrown'); }
```

**Cross-reference**: [cookbook/swap-backend.md](./cookbook/swap-backend.md).

---

## Step 4 — Define your first tool

**Goal**: give the LLM something to do.

```bash
ng g @infra-tools/agentic-ui:tool bookFlight
```

Generates:

```ts
// src/app/agentic/tools/book-flight.tool.ts
import { agenticTool } from '@infra-tools/agentic-ui';
import { z } from 'zod';

export const bookFlightTool = agenticTool({
  name: 'bookFlight',
  description: 'Book a flight between two airports on a given date.',
  schema: z.object({
    from: z.string().describe('IATA airport code, e.g. LAX'),
    to: z.string().describe('IATA airport code, e.g. JFK'),
    date: z.string().describe('ISO 8601 date, e.g. 2026-05-15'),
  }),
  executeIn: 'host',
  handler: async (args) => {
    // Your real backend call goes here. For now, mock it.
    return {
      bookingId: `BK-${Date.now()}`,
      from: args.from, to: args.to, date: args.date, price: 342,
    };
  },
});
```

Register it:

```ts
// src/app/app.config.ts
import { bookFlightTool } from './agentic/tools/book-flight.tool';

provideAgenticUi({ tools: [bookFlightTool], widgets: [] }),
```

The LLM now sees the tool's name + description + JSON-Schema-derived argument shape. Tools live in `ToolRegistry`; you can also call `toolRegistry.register(bookFlightTool)` imperatively for dynamic registration.

**What this gives you**: an LLM-callable handler. The result lands on the chat transcript as a tool-result line + (optionally) a rendered widget — step 5.

**Cross-reference**: [README.md → Use case 2](../README.md#use-cases), [cookbook/extended-registries-feature-tour.md](./cookbook/extended-registries-feature-tour.md).

---

## Step 5 — Define your first widget

**Goal**: let the LLM render a typed Angular component as part of its reply.

```bash
ng g @infra-tools/agentic-ui:widget FlightCard
```

Generates a standalone component + an `agenticWidget({...})` factory registered with the `ComponentRegistry`. The agent renders it by emitting `{ components: [{ name: 'flightCard', props: {...} }] }` from a tool result.

Wire the widget into your tool's return value:

```ts
handler: async (args) => {
  const booking = await bookFlight(args);
  return {
    ...booking,
    components: [
      { name: 'flightCard', props: {
        from: booking.from, to: booking.to, date: booking.date,
        price: booking.price, status: 'confirmed',
      }},
    ],
  };
},
```

The chat shell sees the `components` field, looks up `flightCard` in `ComponentRegistry`, validates the props against its Zod schema, and mounts it via `*ngComponentOutlet`. **Missing names** show an "unknown widget" stub instead of crashing — fail-soft by design.

**What this gives you**: generative UI. The LLM picks the visual representation; you write the component once and register it.

**Cross-reference**: [cookbook/widgets-with-live-data.md](./cookbook/widgets-with-live-data.md) (F2), [cookbook/composable-intake-form.md](./cookbook/composable-intake-form.md) (F1).

---

## Step 6 — Run an agent server

**Goal**: an HTTP endpoint that returns AG-UI events.

```bash
ng g @infra-tools/agentic-ui:agent-server my-agent-server
cd projects/my-agent-server
npm install && npm run dev
```

Boots a Hono server on `:4111` with the `EchoAgent` mounted at `POST /agents/echo/run`. The echo agent doesn't call an LLM — it just streams the user's message back word-by-word. Useful for proving the wiring works without burning LLM quota.

Reload your app and type something. You should see your message streamed back. **That's the round trip working** — chat shell → backend → server → events → transcript.

Files generated:

- `projects/my-agent-server/src/server.ts` — the Hono server + AG-UI route handler
- `projects/my-agent-server/src/echo-agent.ts` — implements `ServerAgent` interface
- `projects/my-agent-server/package.json` — dev/build scripts

**What this gives you**: end-to-end plumbing without an LLM in the loop.

---

## Step 7 — Plug in a real LLM

**Goal**: an agent that actually understands prompts.

The lib is LLM-agnostic. Three common paths:

**Gemini** (cheapest free tier — used by the demos):

```ts
// projects/my-agent-server/src/gemini-agent.ts
// Adapt examples/demo-ediscovery-server/src/gemini-agent.ts.
```

See [examples/demo-ediscovery-server/src/gemini-agent.ts](../examples/demo-ediscovery-server/src/gemini-agent.ts) for a complete reference. Key shape:

```ts
import type { ServerAgent } from '@infra-tools/agentic-ui-server';

export class GeminiAgent implements ServerAgent {
  async *run(input) {
    yield { type: 'run-started', threadId: input.threadId, runId: input.runId };
    // Translate input.messages + input.tools to the Gemini API,
    // stream the response, translate Gemini's tool-call events back
    // into the canonical AgenticEvent shape (text-delta /
    // tool-call-start / tool-call-args / tool-call-end / etc.).
    yield { type: 'run-finished', runId: input.runId };
  }
}
```

**OpenAI / Anthropic / Bedrock**: same pattern; translate the SDK's streaming response into `AgenticEvent`s.

**Mastra / LangGraph / Vercel AI SDK**: thin adapters; pass `input.tools` through the SDK's tool format, translate events on the way out.

Add the agent to your server's route map:

```ts
// projects/my-agent-server/src/server.ts
import { Hono } from 'hono';
import { agUiRouteHandler } from '@infra-tools/agentic-ui-server';
import { GeminiAgent } from './gemini-agent';

const app = new Hono();
app.post('/agents/gemini/run', agUiRouteHandler({ agent: new GeminiAgent() }));
```

Update your client to point at it:

```ts
provideAgUiBackend({ url: 'http://localhost:4111/agents/gemini/run' })
```

**Cross-reference**: [examples/demo-server/src/](../examples/demo-server/src/) for a reference server with six agents under one process; [cookbook/multi-agent-orchestration.md](./cookbook/multi-agent-orchestration.md) for the sticky-routing pattern across specialists.

---

## Step 8 — Add forms (Capability F1)

**Skip if**: you only need free-text prompts; no structured intake.

The agent can render a typed form, validate input client-side, and call back into a tool when the user submits. Two flavors:

- **Predefined catalog**: you author the form schema; the LLM picks which one to mount.
- **Agent-generated**: the LLM emits the entire form schema at runtime; the renderer validates it.

```ts
import { agenticForm } from '@infra-tools/agentic-ui';
import { z } from 'zod';

export const custodianIntakeForm = agenticForm({
  name: 'custodianIntake',
  description: 'Collect a new custodian's details.',
  schema: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    department: z.enum(['Engineering', 'Legal', 'Finance', 'Operations']),
  }),
  onSubmit: async (values) => {
    // Call your real intake handler.
    return { ok: true, id: `CUST-${Date.now()}` };
  },
});
```

Register in providers: `provideAgenticUi({ tools: [...], widgets: [...], forms: [custodianIntakeForm] })`.

**Cross-reference**: [cookbook/composable-intake-form.md](./cookbook/composable-intake-form.md).

---

## Step 9 — Add approvals (F4 — Human-in-the-loop)

**Skip if**: no tool needs senior-reviewer sign-off.

Drape an `agenticApproval` policy on any tool. The chat-shell intercepts the LLM's call, queues an approval, and renders an inline card; the senior reviewer approves or rejects from there or from the `/approvals` route. Every transition appends to the audit chain.

```ts
import { agenticApproval } from '@infra-tools/agentic-ui';

export const releaseHoldApproval = agenticApproval({
  toolName: 'releaseHold',
  required: (args, ctx) => ctx.persona === 'paralegal',  // paralegals need approval; counsel doesn't
  signoffMessage: (args) => `Release ${args.holdId}? This is irreversible.`,
});

// Register: provideAgenticUi({ tools: [...], approvals: [releaseHoldApproval] })
```

**Cross-reference**: [cookbook/approval-flow.md](./cookbook/approval-flow.md), [cookbook/multi-pod-approvals.md](./cookbook/multi-pod-approvals.md) for cross-replica handoff.

---

## Step 10 — Add long-running operations (F5)

**Skip if**: every tool finishes in <5s.

Tools marked `longRunning: true` return immediately with an `opId`; progress streams live; lifecycle (started → progress → finished | failed) participates in the audit chain.

```ts
export const runTarClassifierTool = agenticTool({
  name: 'runTarClassifier',
  longRunning: true,
  description: 'Classify untagged docs against a topic',
  schema: z.object({ topic: z.string() }),
  handler: async (args, ctx) => {
    const opId = ctx.startOperation({ description: `Classifying for "${args.topic}"` });
    for (let i = 0; i <= 100; i += 10) {
      await sleep(500);
      ctx.reportProgress(opId, { pct: i, phase: `batch ${i / 10}` });
    }
    return ctx.completeOperation(opId, { docs: 1247 });
  },
});
```

**Cross-reference**: [cookbook/long-running-operations.md](./cookbook/long-running-operations.md).

---

## Step 11 — Add multi-modal input (F6)

**Skip if**: text-only prompts cover your use cases.

Drag-drop / paperclip / paste image on the chat composer. Backends that advertise `BackendCapabilities.multiModal: true` consume the parts directly; backends that don't degrade to a text fallback (`[image: alt]` / `[file: name]` markers).

No code in your app — just enable on the backend and the composer surfaces the affordances. Server-side: implement `BackendCapabilities.multiModal: true` and accept the `MessageContent[]` content shape.

**Cross-reference**: [cookbook/multi-modal-input.md](./cookbook/multi-modal-input.md).

---

## Step 12 — Federate capabilities from MFE remotes

**Skip if**: you ship a single Angular app.

Multiple teams contribute tools + widgets without recompiling the host. Each remote ships a `CapabilityModule`:

```ts
// remote: bookings/src/Capability.ts
import { defineCapabilityModule } from '@infra-tools/agentic-ui';
import { bookFlightTool } from './tools/book-flight.tool';
import { flightCardWidget } from './widgets/flight-card.widget';

export const capability = defineCapabilityModule({
  source: 'remote:bookings',
  version: '1.0.0',
  tools: [bookFlightTool],
  widgets: [flightCardWidget],
});
```

The host loads at runtime via Native Federation:

```ts
import { loadRemoteCapabilities } from '@infra-tools/agentic-ui';

await loadRemoteCapabilities({
  remote: { remoteName: 'bookings', version: '1.0.0', remoteEntry: '...' },
  loader: async (spec) => loadRemoteModule({ remoteName: spec.remoteName, exposedModule: './Capability' }),
});
```

Now the host's chat shell sees the bookings remote's tools + widgets. Unloading runs `removeBySource('remote:bookings')` across every registry — symmetric teardown.

**Cross-reference**: [cookbook/federate-an-mfe.md](./cookbook/federate-an-mfe.md), [cookbook/federation-at-scale.md](./cookbook/federation-at-scale.md) (per-turn tool filtering, prefetch).

---

## Step 13 — Add persona scope filtering

**Skip if**: every user sees every tool.

Filter the visible tool surface per-user-role so the LLM literally cannot see tools the active persona isn't entitled to invoke. Three layers:

```ts
import { ToolRegistry, AGENTIC_ACTIVE_PERSONA } from '@infra-tools/agentic-ui';

// 1. App: provide the active persona as a signal-token.
providers: [{ provide: AGENTIC_ACTIVE_PERSONA, useFactory: () => signal('paralegal') }],

// 2. Lib: wire the scope policy onto the registry.
constructor(tools: ToolRegistry, activePersona: Signal<string>) {
  tools.setScopePolicy((entry) => {
    const allowed = entry.scopes?.includes(activePersona()) ?? true;
    return allowed;
  });
}

// 3. Server: never trust the client. Re-validate persona claims on each tool call.
```

**Cross-reference**: [ADR-008](./adr/0008-registry-scope-policy.md), [cookbook/context-aware-agent.md](./cookbook/context-aware-agent.md).

---

## Step 14 — Wire telemetry (OpenTelemetry)

**Skip if**: console logs are enough; not yet at production scale.

Two flavors of `provideAgenticTelemetry`:

```ts
// Dev — zero-deps console sink:
import { provideAgenticTelemetryConsole } from '@infra-tools/agentic-ui';
providers: [provideAgenticTelemetryConsole()]

// Production — your existing OTel SDK:
import { provideAgenticTelemetry } from '@infra-tools/agentic-ui';
import { trace, metrics } from '@opentelemetry/api';

providers: [
  provideAgenticTelemetry({
    kind: 'otel',
    providers: {
      tracer: trace.getTracer('agentic-ui', '1.2.2'),
      meter: metrics.getMeter('agentic-ui', '1.2.2'),
    },
  }),
]
```

Emits `agentic.run.start` / `agentic.run.end` / `agentic.tool_call.start` / `agentic.tool_call.end` / `agentic.widget.render` / `agentic.federation.load.*` / `agentic.registry.*` / `agentic.platform.*` / `agentic.trigger.*` / `agentic.run.malformed_event` automatically. W3C `traceparent` propagates across SSE.

**Cross-reference**: [cookbook/observability.md](./cookbook/observability.md).

---

## Step 15 — Wire the catalog platform

**Skip if**: you don't need cross-app capability discovery, central audit, or the ops console.

The catalog server (`@infra-tools/agentic-catalog-server`) provides: IAM persona resolution, MFE registry, capability auto-registration, catalog-driven authorization (deny-lists), and usage metering. Wire all five with one provider:

```ts
import { provideAgenticPlatform } from '@infra-tools/agentic-ui';

providers: [
  provideAgenticPlatform({
    catalogUrl: 'https://catalog.example.com',
    tenantId: 'acme',
    getToken: () => oidc.getAccessToken(),
    personaResolver: { defaultPersona: 'paralegal' },
    mfeRegistry: { refreshIntervalMs: 30_000 },
    capabilityRegistrar: {},   // POST tools+widgets at boot
    capabilityAuthorizer: {},  // catalog deny-lists hide entries
    usageMetering: {},         // every tool call → /usage
  }),
],
```

Each switch is independently opt-in; omit any field to disable that integration. Apps without `provideAgenticPlatform` see zero behavior change.

**Cross-reference**: [ADRs 031–034](./adr/), [audit/2026-05-10-platform-audit.md](./audit/2026-05-10-platform-audit.md).

---

## Step 16 — Expose tools via MCP

**Skip if**: you don't need Claude Desktop / Cursor / Continue / Zed to invoke your tools.

Wrap your tool set in an MCP server (stdio or HTTP) so any MCP-aware host can call them — outside the browser, outside Angular.

```ts
import { createMcpServer } from '@infra-tools/agentic-ui-mcp';
import { bookFlightTool, checkBookingTool } from './tools';

const server = createMcpServer({
  name: 'my-app',
  version: '1.0.0',
  tools: [bookFlightTool, checkBookingTool],
  beforeCall: async (toolName, args) => {
    // Authenticate the calling user, audit-log, etc.
  },
});

await server.connect({ kind: 'stdio' });  // or { kind: 'http', port: 5000 }
```

Wire into Claude Desktop:

```jsonc
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "my-app": {
      "command": "node",
      "args": ["/abs/path/to/your/built/mcp-server.js"],
      "env": { "USER_ID": "alice" }
    }
  }
}
```

**Cross-reference**: [cookbook/mcp-server.md](./cookbook/mcp-server.md), [cookbook/paralegal-mcp-review.md](./cookbook/paralegal-mcp-review.md).

---

## Step 17 — Expose the agent in Teams / M365 Copilot / GitHub Copilot

**Skip if**: Teams + Copilot aren't your distribution surfaces.

Four adapter packages, one per surface:

| Package | Surface | Auth |
|---|---|---|
| [`provideTeamsContext`](./cookbook/teams-tab-embed.md) (in-lib) | Teams Tab embed (Angular app hosted in a tab) | Teams SSO |
| `@infra-tools/agentic-ui-teams-bot` | Teams chat (channel / DM / group) | Bot Connector JWT + AAD |
| `@infra-tools/agentic-ui-m365-agents` | Teams + **M365 Copilot** (Word / Outlook / Copilot web) + Direct Line | Bot Connector + AAD v1/v2 + sovereign clouds |
| `@infra-tools/agentic-ui-copilot-skill` | GitHub Copilot Chat (`@maverick-ediscovery`) | ECDSA P-256 signed-request |
| `@infra-tools/agentic-ui-copilot-studio-connector` | M365 Copilot (Power Platform actions) | AAD v2.0 JWT |

Each adapter exposes a Connect-style middleware: receive activity → verify → parse → run your `Handler` → emit events. Your tool catalog and audit chain don't fork.

**Cross-reference**: [README → adapter decision tree](../README.md#bring-the-agent-to-other-surfaces--four-adapter-packages), [ADR-041](./adr/0041-teams-copilot-external-surfaces.md), [ADR-042](./adr/0042-copilot-studio-connector.md).

---

## Step 18 — Production deployment

**Required at ship time.**

Three concerns the lib doesn't decide for you:

**Thread state persistence.** Default `ThreadStateStore` is in-memory; one-instance only. For multi-pod deployments swap in Redis or Postgres via `@infra-tools/agentic-ui-server-stores`:

```ts
import { redisThreadStateStore } from '@infra-tools/agentic-ui-server-stores';
agUiRouteHandler({ agent, threadStore: redisThreadStateStore({ url: process.env.REDIS_URL! }) })
```

**Rate limiting.** Hono ships no built-in middleware; add `hono-rate-limiter` or your own.

**Secrets.** `.env.example` files in `examples/*` document the required vars (`GOOGLE_GENERATIVE_AI_API_KEY`, `OIDC_ISSUER`, etc.). Never commit real tokens; the repo's `.githooks/pre-commit` blocks the six most-common signatures.

**Deployment artifacts shipped with the repo:**

- [`platform/helm/agentic-platform/`](../platform/helm/agentic-platform/) — production-grade Helm chart (OIDC + multi-AZ Postgres + Ingress + TLS)
- [`platform/docker-compose.yml`](../platform/docker-compose.yml) — local Postgres + catalog + ops-console
- [`platform/render.yaml`](../platform/render.yaml) — Render-deployable demo (the `ediscovery-shell.onrender.com` reference)

**Cross-reference**: [cookbook/production-deployment.md](./cookbook/production-deployment.md).

---

## Step 19 — Observability + cost guardrails

**Required at scale.**

The telemetry seam (step 14) carries the signals; **wire them into your existing stack**:

- `agentic.tool_call.start/end` → tool latency dashboard
- `agentic.run.malformed_event` → backend-health alarm
- `agentic.registry.host_version_mismatch` → federation-version drift alarm
- `agentic.platform.capability_authorizer.refresh_failed` → catalog-availability alarm

**Cost guardrails** the lib doesn't ship:

- Per-tenant tool-call quota → wrap `ToolRegistry.get` with a check before dispatch
- Token budget per turn → enforce in your agent server before each LLM call
- Approval gate on expensive tools (step 9) → `required: (args, ctx) => args.estimatedCost > 100`

The library exposes the seams; your ops team decides the limits.

---

## Common pitfalls + fixes

| Symptom | Cause | Fix |
|---|---|---|
| Chat composer renders but messages don't send | Backend URL wrong or server not running | Verify `:4111/agents/echo/run` returns events |
| LLM ignores your tool | Description too vague | Front-load the description: "Use this when…" + an example |
| Widget renders as "unknown widget" stub | Name mismatch between `agenticWidget({ name })` and the agent's `components[].name` | Both must match exactly; case-sensitive |
| Federation singleton mismatch (registries empty in host) | Host + remote bundle their own copies of `@infra-tools/agentic-ui` | Confirm `shareAll: { singleton: true, strictVersion: true }` in your federation config |
| `MalformedEvent` telemetry firing | Backend yielded an event that doesn't match `agenticEventSchema` | Run `runConformance(backend)` to identify the offending event |
| Tool args wrong type | LLM returned malformed args; Zod rejected | Tool call records `tool_error` in the transcript; pre-validation hints will land in a future slice — for now, make the schema more constrained / add `.describe()` text |

---

## How to verify the round trip

Three checks any new app should pass before shipping:

1. **Echo test** — point at the `EchoAgent`; type any message; see it streamed back. Proves chat shell + backend + server + event routing.
2. **Tool test** — point at your real LLM; ask it to call your first tool. Inspect the transcript for `tool-call-start` / `tool-call-args` / `tool-call-end` lines + the handler's return value. Proves Zod-typed dispatch.
3. **Widget test** — return a `components: [{name, props}]` from a tool. See the widget mount under the tool result. Proves the `ComponentRegistry` is wired.

If all three pass, every later step (forms, approvals, federation, telemetry, MCP, Teams) is additive — drop them in without disturbing the foundation.

---

## When to deviate from this sequence

- **Multi-agent first** (specialists routed by an orchestrator): skip step 7, go directly to [cookbook/multi-agent-orchestration.md](./cookbook/multi-agent-orchestration.md). The orchestrator is its own `ServerAgent` that classifies prompts and forwards to specialist routes.
- **Federation first** (your team builds the host; other teams contribute tools): skip steps 4–5 (your tools live in the remotes); go to step 12. The host's `provideAgenticUi({ tools: [], widgets: [] })` stays empty.
- **MCP-only** (no browser; expose tools to Claude Desktop): skip 1–3, 5–7; step 4 + step 16 only. Your tools become a stdio-or-HTTP MCP server.

The library is **declarative at every layer**; reordering the sequence doesn't break it. The sequence above is just the path with the fewest surprises.

---

## Where this guide ends

You should have:
- A running app with chat + at least one tool + at least one widget
- A clear next step from the opt-in table (federation, forms, approvals, telemetry, …)
- A pointer to the right cookbook entry for each next step
- A production-deployment plan (step 18) and an ops plan (step 19)

For the **library's full capability inventory** (all 18 registries, every published seam), see [README.md → Library capability inventory](../README.md#library-capability-inventory).

For the **reference architecture diagrams**, see [README.md → Architecture](../README.md#architecture).

For the **enterprise eDiscovery flagship** that exercises every load-bearing seam, see [examples/demo-ediscovery-shell/](../examples/demo-ediscovery-shell/) and the [USER_GUIDE.md](./USER_GUIDE.md).
