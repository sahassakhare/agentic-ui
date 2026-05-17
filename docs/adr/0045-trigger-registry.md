# ADR-045 — `TriggerRegistry` for scheduled / webhook / queue-fired tool calls

**Status:** Proposed · **Date:** 2026-05-13 · **Decider:** sahas
**Supersedes:** none · **Related:** ADR-002 (Layered registry system), ADR-008 (Registry scope policy), ADR-010 (Platform principles — no Temporal in runtime), [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md) (P2 + Workflow A), ADR-014 (Governance hooks), ADR-039 (Agent auto-registration on server)

## Context

Every tool call in the library today is **user-initiated** — the user types into the chat, clicks a row action, opens a palette, picks a bulk toolbar button, or an MCP host calls in. There is no surface for the agent to act *at* the user rather than *for* them.

The [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md) introduces several patterns that need scheduled / event-driven tool invocations:

- **Pattern 8 (Pillar 1)** — Proactive notifications. *"3 custodians missed acknowledgment SLA"* — a cron-fired tool call queries the catalog and posts to the host's Inbox.
- **Workflow A** — Legal-hold lifecycle. SLA-based reminder drafting for unacknowledged holds; trigger fires at 09:00 UTC daily, agent drafts personalised reminders, attorney approves via HITL.
- **DashboardDef.schedule** (ADR-044, forthcoming) — Dashboards whose tiles refresh on a cron, not just on page load.

None of these are tractable without a registry of triggers that fires tools the same way the orchestrator fires them — with the same audit chain, persona scope, and `origin` tag.

The constraint: [ADR-010 D4](./0010-platform-principles-and-license.md) prohibits Temporal / NATS / distributed-queue infrastructure in the runtime. The library must keep its in-process default story; durable / distributed triggers are an opt-in server-side package, not a runtime tier concern.

## Decision

Six decisions. Together they add a `TriggerRegistry` to the existing 15 registries, define the `TriggerDef` shape, ship an in-process browser-side runner, and keep the door open for a server-side durable runner without coupling the runtime to it.

### D1 — `TriggerRegistry` is a new `RegistryBase<TriggerDef>` in the Extended tier

It joins `ActionRegistry`, `IntentRegistry`, `FormRegistry`, `DataSourceRegistry`, `ApprovalRegistry`, `OperationRegistry` in the "Extended" tier ([ADR-002](./0002-layered-registry-system.md)). All standard machinery flows through — `register / list / signal / removeBySource / setScopePolicy` — uniform with the other 15 registries.

The Extended tier brings the count from 15 to 16. Adopters who don't import `TriggerRegistry` pay nothing — providedIn: 'root' factories ship as tree-shakeable singletons.

### D2 — `TriggerDef` carries kind + spec + target + identity attribution

```ts
interface TriggerDef extends RegistryEntry {
  readonly description: string;
  readonly kind: TriggerKind;
  readonly spec: TriggerSpec;          // discriminated by kind
  readonly target: TriggerTarget;      // tool / action / notification
  readonly runAs?: string;             // persona identity for audit attribution
  readonly enabled?: boolean;          // false → registered but won't fire (toggleable via ops console)
}

type TriggerKind = 'cron' | 'webhook' | 'queue';

type TriggerSpec =
  | { readonly kind: 'cron';    readonly expression: string; readonly timezone?: string }
  | { readonly kind: 'webhook'; readonly path: string;        readonly secret?: string }
  | { readonly kind: 'queue';   readonly topic: string };

type TriggerTarget =
  | { readonly kind: 'tool';         readonly tool: string;   readonly args?: unknown }
  | { readonly kind: 'action';       readonly action: string; readonly payload?: unknown }
  | { readonly kind: 'notification'; readonly compose: (firing: TriggerFiringContext) => NotificationDraft };
```

Three concerns separated: **kind** (when it fires), **spec** (the firing pattern), **target** (what gets invoked). The third option — `notification` — feeds the Inbox / `<mvk-notification-tray>` from the post-chat-surfaces plan without round-tripping through a tool call.

### D3 — Browser-side runner via `provideTriggerRunner({ kinds: ['cron'] })`

Default behaviour for adopters: in-process `setInterval`-based runner. Tick once per second (configurable), evaluate each cron expression against now, fire matched targets through the orchestrator's existing tool-call pipeline.

```ts
// app.config.ts
provideTriggerRunner({
  kinds: ['cron'],                    // omit 'webhook' / 'queue' until ready
  tickIntervalMs: 1_000,
  paused: () => document.hidden,      // pause when tab hidden — battery / quota
});
```

Why not a `Web Worker`? Webhook + queue triggers need access to the same `BackendRegistry` + `ApprovalRegistry` + `AuditChain` the rest of the runtime tier holds. Cross-realm posting back into the main thread is more friction than it saves; we accept the cost of running cron-eval on the main thread. The tick interval is bounded by `setInterval`, not the event loop; misses during heavy frames are explicitly OK for a v1 trigger story.

**Persistence across reload** is **out of scope for D3.** Browser-side cron triggers are *advisory* and *transient*; the source of truth for SLA-bearing schedules is the server-side runner (D6). Apps that need durable / cross-session triggers wire the server-side path; apps that only need "tick this dashboard every 30s while the page is open" use the browser-side default.

### D4 — Each trigger fire is a chain-hashed tool call with `origin: 'trigger'`

Same `origin` field added in ADR-041 D3 (`'chat'` / `'mcp'` / `'teams-bot'` / `'copilot-skill'` / `'copilot-studio'`). New origin: `'trigger'`. Audit chain captures:

- `triggerId` — which `TriggerDef` fired (so you can query *"why did this run?"*)
- `firedAt` — wall-clock timestamp at fire moment
- `firedBy: 'system' | <runAs persona>` — for accountability
- The downstream tool call's normal chain-hash entry includes the trigger id in its parent reference so a single audit query reconstructs the trigger → call → result → notification flow.

This is **additive** to the audit field — existing audit consumers see no diff for events that didn't come from a trigger.

### D5 — Persona attribution via `TriggerDef.runAs`

Tools normally run with the active persona's scope policy. Triggers have no active user. Two options for the missing persona context:

- **D5.a** (chosen): triggers carry an explicit `runAs?: string` that resolves to a registered persona in the IAM resolver ([ADR-016](./0016-iam-role-mapping.md)). The persona's `setScopePolicy` applies; the audit `firedBy` field carries the persona identity.
- **D5.b** (rejected): a special `'system'` persona with bypass-all-scope semantics. Rejected because it punctures the persona-scope invariant and creates an explicit superuser surface — exactly what ADR-008's filter-on-read design exists to prevent.

A trigger without `runAs` falls back to a least-privilege `'trigger:default'` persona that hosts must explicitly map to capabilities. By default it has zero tool access; nothing happens until the host provides a mapping. Loud safety default.

### D6 — Server-side runner is a separate package (`@infra-tools/agentic-ui-server-triggers`)

A future package extends `@infra-tools/agentic-ui-server` with a durable scheduler (Postgres-backed lock + `SELECT FOR UPDATE SKIP LOCKED` worker pool, BullMQ for queue/webhook). Stays outside the runtime per [ADR-010 D4](./0010-platform-principles-and-license.md) — adopters who only need browser-side ticks pay nothing.

The two runners share the **same `TriggerDef` shape and the same `TriggerRegistry`** so a host can register a `TriggerDef` once and let either runner pick it up. Discovery from the catalog ([ADR-032](./0032-catalog-capability-registrar.md)) extends to triggers — they show up in the ops console next to tools, widgets, and MFEs, with `lifecycle: 'disabled'` toggles working uniformly.

This ADR ships D1–D5 in the runtime tier; D6 lands as a separate package + a future ADR (likely 0046).

## Consequences

### Positive

- **Agent acts at the user.** Pattern 8 (proactive notifications) and Workflow A (legal-hold lifecycle SLAs) become tractable without bespoke timers in app code.
- **Audit chain stays a single source of truth.** Trigger fires write the same chain-hashed entry shape as user-initiated calls, with `origin: 'trigger'` for filtering.
- **Persona scope holds.** No bypass-all persona; triggers run with explicit `runAs` identity. The same `setScopePolicy` invariant ADR-008 enforces.
- **MFE remotes can contribute triggers.** A `production` MFE remote can register a daily "stale production review" cron alongside its tools and widgets. `removeBySource` symmetry holds — unload the remote, the trigger stops firing.
- **Browser-side default is zero-config.** Apps wire `provideTriggerRunner({...})` once; cron triggers tick in the page lifecycle. No infrastructure to stand up for the demo.
- **Server-side path is a clean upgrade.** Same `TriggerDef` shape; only the runner changes. Apps that outgrow browser-tick durability swap to `@infra-tools/agentic-ui-server-triggers` without rewriting the trigger definitions.
- **Zero breaking changes.** Existing 15 registries see no diff; `TriggerRegistry` is a pure addition. Apps without a `provideTriggerRunner` registered see triggers in the registry but never fire — useful for the catalog-listing path. ADR-010 D4 held.

### Negative

- **Browser-tick triggers are unreliable.** Hidden tabs, sleep, throttling, refresh-loss. The `paused` predicate mitigates one of those; the others are inherent. Documented as v1 limitation; mitigated by the server-side runner from D6.
- **Cron expression evaluation adds a dep.** Need a small cron library (`cron-parser` or hand-rolled subset — every minute / hour / day is enough for v1, full POSIX cron is overkill). ~5KB to FESM. Tracked in the 200KB FESM size guard's budget.
- **Trigger registry count creeps up.** Apps with many cron schedules end up with many `TriggerDef` entries. Mitigated by the same `removeBySource` + `lifecycle: 'disabled'` toggles already used for tools; ops console treats them uniformly.
- **`runAs` requires an IAM persona resolver.** Apps without a persona resolver get the locked-down `'trigger:default'` fallback. Documented loud-failure: triggers register but never invoke tools until the host provides a persona mapping. Better than a quiet superuser.

### Neutral / out of scope

- **Distributed-queue triggers.** BullMQ / Temporal / NATS-driven triggers are explicitly outside the runtime tier per ADR-010 D4. They land in the server-side package (D6).
- **Trigger-to-trigger chaining.** Triggers fire tools/actions; tools/actions can register new triggers if needed. No direct trigger-fires-trigger primitive — that turns into a workflow engine, which is the wrong shape for this primitive.
- **Trigger UI** (the catalog ops console's trigger list, the eDiscovery `/inbox` page) — defined in the post-chat-surfaces plan and lands in P2 as separate slices.

## Alternatives considered

### A. Skip the registry — let apps register `setInterval` themselves

**Rejected.** Loses the persona scope, the audit-chain integration, the MFE `removeBySource` symmetry, the ops-console listing, and the catalog discovery. Each of those would be reinvented per-app at higher cost than this ADR's ~150 LOC of base-class extension.

### B. Bake triggers into `ToolDef` directly (`ToolDef.schedule?`)

**Rejected.** Mixes the tool's call signature with its firing schedule — two concerns. Forecloses on the `notification` target kind (no underlying tool to schedule). Conflates "what the agent can do" with "when something happens" — the post-chat-surfaces premise is exactly that these should stay separable.

### C. Use `OperationRegistry` (Capability F5) as the trigger primitive

**Rejected.** Operations describe in-flight long-running work tied to a specific tool call. Triggers describe fire schedules tied to no call yet. Reusing the same registry would muddle "started" vs "scheduled" semantics.

### D. A single `'system'` persona with bypass scope

**Rejected per D5.b.** Punctures the persona-scope invariant. The least-privilege `'trigger:default'` fallback gives the same convenience for "I just need a daily refresh" cases without creating a superuser.

### E. Server-side-only from the start

**Rejected.** The demo story needs zero-infra triggers (just registered in the browser). Requiring Postgres + a worker pool to demo a 30-second dashboard refresh is the wrong default. The server-side runner is the *production* path, not the *only* path.

## Implementation notes

Sequenced for P2 of the post-chat-surfaces plan (~2 weeks):

1. **`TriggerDef` types** in `projects/agentic-ui/src/lib/types/registry-defs.ts`. Mirror the discriminated-union pattern used by `IntentTarget`. ~80 LOC + Zod schemas.
2. **`TriggerRegistry` class** in `projects/agentic-ui/src/lib/registries/trigger-registry.ts`. ~30 LOC of base-class extension; standard pattern.
3. **`provideTriggerRunner({...})` factory** in `projects/agentic-ui/src/lib/platform/provide-trigger-runner.ts`. ~150 LOC — `setInterval` tick, cron-expression evaluator, dispatch through the existing tool-call pipeline. Pulls in `cron-parser` (small, well-maintained) as an optional peer dep.
4. **`TRIGGER_RUNNER` injection token** + service. Lazy fires; no work happens unless `provideTriggerRunner` is wired.
5. **Audit-chain extension.** New `origin: 'trigger'` value + `triggerId` field on fire-initiated tool calls. Touch `AGENTIC_TELEMETRY_SINK`'s event shape — additive.
6. **`'trigger:default'` persona convention.** Documented in [platform-seams.md](../architecture/platform-seams.md); no code change beyond the docs.
7. **Cookbook entry.** "Proactive triggers — cron + Inbox" — wires a daily cron to a notification target, renders in `<mvk-notification-tray>` from P2.
8. **Specs.** Unit tests for the registry, the cron evaluator, the runner's tick loop, persona resolution via `runAs`, and the audit-chain emission.

P2 exit criteria are §9 of the [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md#p2-triggers--inbox).

## Open questions

Carried forward from plan §11 + introduced here. Decide before implementation:

1. **Cron expression dialect.** Standard POSIX cron (`0 9 * * *`) or a simpler subset (`@daily`, `@hourly`, `every 30 minutes`)? **Tentative:** ship POSIX via `cron-parser`; recognise `@daily` etc. as sugar (the library already handles those). Costs ~5KB FESM.
2. **Default `runAs` mapping.** `'trigger:default'` with zero tool access by default is loud-safe, but every demo will need to map it. Should `provideTriggerRunner` accept a `defaultRunAs` shortcut to skip the per-trigger explicit attribution? **Tentative:** yes, accept it; default is still the locked-down persona.
3. **Browser-tick pause semantics.** Do hidden-tab triggers *fire-when-visible-again* (replay the missed window) or *skip silently*? **Tentative:** skip silently; replay is a server-side runner concern.
4. **Webhook triggers from the browser.** Hosting a webhook endpoint requires a server. Browser webhook triggers would have to ride a long-poll / SSE channel from the server, which is more complex than the v1 budget. **Tentative:** webhook kind defined in `TriggerDef` but the *browser-side runner* in D3 only handles `'cron'`; webhook + queue land with the server-side package (D6).
5. **`lifecycle: 'disabled'`** on a `TriggerDef`. Should it stop firing immediately, or finish in-flight invocations? **Tentative:** stop firing on next tick; in-flight calls complete naturally. Same semantics as MFE unload.

## Status

Proposed; awaiting ack on §1 plan goals + the open questions above. Once accepted, this ADR moves to `Status: Accepted (implementing)`. P2 implementation tracked in the post-chat-surfaces plan.
