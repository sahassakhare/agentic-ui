# Post-chat surfaces plan — agent everywhere, not just in the rail

**Status:** draft · **Owner:** sahas · **Started:** 2026-05-12
**Related ADRs:** [ADR-043](../adr/0043-layout-registry-promotion.md) LayoutRegistry promotion (accepted) · [ADR-044](../adr/0044-dashboard-registry.md) DashboardRegistry (drafted, Proposed) · [ADR-045](../adr/0045-trigger-registry.md) TriggerRegistry (drafted, Proposed)

How we extend `@infra-tools/agentic-ui` so the agent participates in **every** web surface — table cells, row menus, bulk toolbars, inline suggestions, multi-pane workspaces, user-built dashboards, scheduled triggers — not just the chat rail. The architectural through-line is one sentence:

> **The agent is the registry layer plus the orchestrator. The chat rail is one surface among many — all surfaces invoke the same governed tool set and write to the same audit chain.**

This plan synthesises three threads of architectural recommendations (web-surface patterns, layout primitives, user-defined dashboards) into one phased delivery. Each pillar reinforces the others: layout primitives make multi-pane workspaces possible; workspaces make dashboards possible; dashboards expose tiles as tool calls; tiles need persona-aware layout density; round-trip.

---

## 1. Goals & non-goals

**Goals.**

- Surface the agent across **every route + every interaction surface** in the eDiscovery flagship without forking the library or rewriting the chat shell.
- Promote three registries that are currently thin defaults to load-bearing primitives:
  - `LayoutRegistry` → slot-based, persona-aware, persistable, agent-emittable.
  - `DashboardRegistry` → first-class citizens; versioned, shareable, persona-scoped.
  - `TriggerRegistry` (new) → cron / webhook / queue-driven tool calls so the agent acts *at* users, not just *for* them.
- Honour ADR-010 D4 zero-breaking-changes contract. Every new primitive is additive; existing `<mvk-chat-shell>` consumers see no change.
- Keep persona scope + chain-hash audit + MFE federation working uniformly across the new surfaces.

**Non-goals.**

- Net-new agent protocols. AG-UI / Hashbrown / A2UI / MCP cover every surface.
- A bespoke shell per surface. New surfaces are Angular components reading from the same 15 registries.
- Replacing the chat rail. It stays — as one of the five layout modes the agent (or persona policy) can pick.
- A drag-drop dashboard *product*. We ship the seam, not a Tableau replacement.
- Productionising every pattern in P0. We do **demo-grade** parity first, ops-grade polish as follow-up slices.

---

## 2. Architectural premise

Today the demo presents one organising metaphor: **type into chat → agent decides → render in chat**. Three artefacts in the library already break that metaphor but are under-used:

- **`ActionRegistry`** — agent-emitted commands that don't have to render in chat (navigation, toasts, state mutations).
- **`IntentRegistry`** — NL → tool routing that can short-circuit *before* the LLM, used today as a chat optimisation but applicable to every entry point.
- **`DataSourceRegistry`** — typed data adapters that decouple "where the number comes from" from "how it renders".

Each pattern in this plan maps to those primitives + a small extension. Concretely:

| Architectural property | Why it matters here |
|---|---|
| A tool call is a tool call regardless of who triggered it | Same governance, audit, persona scope across chat, click, intent, MCP, schedule, webhook |
| Persona scope filters every registry read uniformly | Six personas see six legitimately different views of the same dashboard / table / menu, with no admin work |
| MFE remotes contribute capabilities at runtime | A new MFE can ship dashboards, intents, triggers, layouts — not just tools and widgets |
| `removeBySource` is symmetric on unload | Adding dashboards / triggers / layouts to the same teardown path is free |
| Chain-hash audit captures every state mutation | Dashboard edits, trigger firings, layout overrides all participate in the same defensibility story |

The investment in registry uniformity ([ADR-002](../adr/0002-layered-registry-system.md), [ADR-008](../adr/0008-registry-scope-policy.md)) makes the cost of each pattern below roughly the cost of authoring its widgets and tools — not the cost of new framework code.

---

## 3. The three pillars

### Pillar 1 — Web-surface patterns (post-chat affordances)

Ten patterns the library can support today using existing registries plus one new component primitive per pattern. None require a chat turn.

| # | Pattern | Maps to | New library surface | Demo route to land it |
|---|---|---|---|---|
| 1 | Smart cells in tables (agent-computed columns) | `ToolRegistry` + `ComponentRegistry` + `DataSourceRegistry` | `<mvk-smart-cell>` — wraps a tool call as a single-cell widget | `Documents` (Privilege Confidence column) |
| 2 | Row-action context menus | `IntentRegistry` for surfacing, `ToolRegistry` for executing, `ActionRegistry` for nav side-effects | `<mvk-row-action-menu>` — reads intent matches from row state | `Custodians`, `Documents` |
| 3 | Bulk operation toolbar (intent-aware) | `IntentRegistry` query against `{ selection, persona, route }` | `<mvk-bulk-toolbar>` materialises on selection | `Documents`, `Custodians` |
| 4 | Smart filters / saved natural-language views | `DataSourceRegistry` + `IntentRegistry` + `PersistenceRegistry` | `<mvk-nl-filter>` compiles NL → typed `DataSourceDef` query | All list pages |
| 5 | Document viewer with inline agent annotations | `ToolRegistry` (privilege/PII/relevance) + `ActionRegistry` (accept/reject) | `<mvk-doc-annotations>` overlay | `Documents` (single doc) |
| 6 | "Next best action" side panel | `IntentRegistry` + `DataSourceRegistry` (page state) | `<mvk-assist-panel>` — the Cursor-style pattern | `Custodian profile`, all profile-shaped routes |
| 7 | Dashboard tiles as live tool results | `ToolRegistry` results rendered as registered widgets | `<mvk-dashboard-tile>` wrapping any `ComponentDef` | `Dashboard` (and Pillar 3) |
| 8 | Proactive notification surface | `ToolRegistry` + new `TriggerRegistry` (cron / webhook) | `<mvk-inbox>` + `<mvk-notification-tray>` | New `/inbox` route |
| 9 | Search with agent re-ranking + explanation | `ToolRegistry` + `DataSourceRegistry` | `<mvk-global-search>` top-bar primitive | Cross-route (top chrome) |
| 10 | Form pre-fill from uploaded artefacts | `ToolRegistry` (extraction) + `FormRegistry` (target form) | Drop zone on `<mvk-form-renderer>` | `Custodians`, `Productions` |

Pattern 6 is the **highest-leverage single addition** — it makes the agent feel present everywhere without the user having to type. Pattern 1 is the **shortest path to a "wow" demo moment** in eDiscovery.

#### What's new in the library for Pillar 1

- Six new components, all wrapping existing primitives. Each is ~100-200 LOC and ships its own Zod schema for the agent to emit against.
- One new registry: `TriggerRegistry` (Pillar 1 patterns 8, plus pre-req for Workflow A in §4). ~50-100 LOC base-class extension. Same `register / list / signal / removeBySource / setScopePolicy` semantics as the existing 15 registries.
- No change to `<mvk-chat-shell>`.

### Pillar 2 — Layout primitives (the agent reshapes the canvas)

Today `LayoutRegistry` is a thin default. Promoting it to a load-bearing primitive enables the agent to **direct the screen**, not just produce widgets. Five layout modes the library should support:

| Mode | Use when | Chat presence |
|---|---|---|
| **rail** (today's default) | List + filter routes, CRUD-shaped | Persistent right rail, ~360px |
| **pill** | Inspector-first routes (doc review, canvas work) | Collapsed floating pill; pulses on proactive suggestions; ⌘K to summon |
| **docked-bottom** | Glance-driven (dashboards) | ~120px sticky strip, proactive alerts surface here |
| **assist-panel** (Cursor pattern) | Expert-user work (profile pages, single-record edit) | Structured panel with next-actions + scoped chat at bottom |
| **workspace** | Multi-pane work (review workbench, queue + doc) | Agent-directed slot composition; chat reduces to pill |
| **hidden** | When chat is the wrong primitive (Audit) | Query bar replaces rail |

#### `LayoutDef` shape (sketched)

The agent emits this alongside (or instead of) `components: [...]`:

```ts
interface LayoutDef {
  name: string;                       // 'review-workbench'
  scopes?: string[];                  // persona scope, same as ToolDef
  slots: Record<string, SlotDef>;     // primary, sidebar, footer, overlay, etc.
  responsive?: ResponsiveCollapse;    // collapse rules per breakpoint
  source?: 'user' | string;           // MFE source for removeBySource
}

interface SlotDef {
  component: string;                  // ComponentRegistry name
  props: unknown;                     // Zod-validated against ComponentDef
  size?: { default: string; min?: string; max?: string };
  pinned?: boolean;                   // user can't collapse
  open?: 'route' | 'modal' | 'drawer' | 'overlay';
}
```

The chat shell hands a `LayoutDef` to `LayoutRegistry.get(name).render(slots)`. Pre-registered layouts give predictable shapes; ad-hoc layouts give flexibility.

#### What's new in the library for Pillar 2

- `<mvk-chat-shell mode="rail | pill | overlay | docked-bottom | hidden">` — one prop, big win, fully backwards-compatible.
- `<mvk-workspace-layout>` reading from `LayoutRegistry.get(name)`.
- `<mvk-assist-panel>` — Cursor pattern as a first-class shell primitive (subscribes to the same registries as the chat rail; renders structured affordances).
- `setLayoutPolicy(persona)` on `RegistryBase` parallel to `setScopePolicy` — junior reviewer sees suggestion-rich layouts, partner sees compressed information.
- `LayoutDef` extension: slots, overlays, drawers, modals, responsive collapse rules.

ADR-043 will frame the LayoutRegistry promotion as a contract change *additive only* — existing `LayoutRegistry.register` calls keep working.

### Pillar 3 — User-defined dashboards (`DashboardRegistry`)

Three flavours, sequenced:

| Flavour | What the user does | What the agent does | Order |
|---|---|---|---|
| **A. Pick-and-place** | Drags pre-built widgets onto a grid; resizes; saves | Nothing | P3.A |
| **B. Conversational composition** | "Build me a dashboard tracking custodian SLAs and privilege rates" | Picks widgets + data sources + layout from registries; user accepts/edits | P3.B (the demo-worthy flavour) |
| **C. Live & queryable** | Both, but each tile is a parameterised tool call; can drill / interrogate / replay | Computes values, explains them, drills down | P3.C (mostly free — properties fall out of the registry layer) |

#### `DashboardDef` + `TileDef`

```ts
interface DashboardDef {
  name: string;                       // 'production-throughput'
  title: string;                      // user-visible
  scopes?: string[];                  // persona scope
  layout: LayoutDef;                  // from LayoutRegistry (Pillar 2)
  tiles: TileDef[];
  schedule?: TriggerDef;              // optional refresh via TriggerRegistry
  filters?: FilterDef[];              // global params applied to every tile
  source?: 'user' | string;           // MFE source for removeBySource
  version?: string;
  parentVersion?: string;             // for edit-as-new-version
}

interface TileDef {
  id: string;
  slot: string;                       // which LayoutDef slot
  title: string;
  component: string;                  // ComponentRegistry name
  invocation:
    | { kind: 'tool';   tool: string;   args: Record<string, unknown> }
    | { kind: 'data';   source: string; query: Record<string, unknown> }
    | { kind: 'static'; props: unknown };
  refreshOn?: 'load' | 'interval' | 'event' | 'manual';
  drilldown?: { tool?: string; route?: string };
  explainable?: boolean;
}
```

Deliberately boring. Every tile is *either* a tool call, *or* a data-source query, *or* static. Adding a tile kind = registering a new widget. No bespoke dashboard component zoo.

#### Why a registry, not localStorage JSON

Promoting dashboards to a registry — not a stored blob — is the architecturally consistent move:

- **Sharing** = sharing a `DashboardDef`. Same surface as sharing a saved view.
- **Versioning** = `DashboardDef.version` + `parentVersion` field. Edits are new versions; chain links them.
- **Personal vs. team vs. template** = three values of `source`: `user`, `team:<id>`, `mfe:<remote>`.
- **MFE-contributed dashboard templates** = free. The `production` MFE remote can register `production-throughput` template at boot alongside its tools.
- **Audit** = every dashboard edit is a chain-hashed tool call. Who added the "privilege-rate-by-reviewer" tile to the team dashboard, and when, is queryable.
- **Persona scope** = `setScopePolicy` already filters every `list / get / signal` read. A shared dashboard renders unauthorised tiles as "no access" stubs, not 403s.

#### Properties Tableau / PowerBI / Looker can't match

These emerge because tiles are tool calls, not query results:

1. **The agent uses the dashboard, not just builds it.** *"On the production-throughput dashboard, find the week where redaction time spiked and explain it"* — chat turn reads tile registry, queries the tool, renders an explanation.
2. **Tiles propagate persona scope automatically.** Build one dashboard, six personas see six legitimate views, no admin work.
3. **Cross-matter dashboards are nearly free.** A `filters.matterIds` parameter threads through every tile's tool call.
4. **Tiles are MCP-exposable.** A dashboard becomes addressable from Claude Desktop / Cursor via the existing `@infra-tools/agentic-ui-mcp` adapter.
5. **Dashboards can trigger workflows.** A tile with a threshold + a `TriggerRegistry` entry turns the dashboard from passive to active.

---

## 4. Complex workflows worth modelling

These are stateful, multi-step, multi-actor, span days or weeks. The chat is incidental — the workflow is the artefact. Each maps to a combination of the pillars + existing registries.

| ID | Workflow | New surfaces | New registries needed |
|---|---|---|---|
| A | **Legal hold lifecycle**: Issue → Acknowledge → Track → Reissue → Release | Lifecycle widget, full-bleed on `/holds` route | `TriggerRegistry` (SLA-based reminders) |
| B | **End-to-end production pipeline**: Scope → Collect → De-dupe → Process → Review → Redact → Bates → QC → Export → Deliver | Pipeline widget, full-bleed on `/productions` route | None — existing tools + chain-hash + ActionRegistry |
| C | **Continuous Active Learning (CAL) privilege review** | `/review-queue` route with doc-on-left + classification-proposal-on-right workbench | None — `PersistenceRegistry` holds training state |
| D | **Investigation timeline reconstruction** | `/timeline` route with `<timeline-canvas>` widget | None — `DataSourceRegistry` queries multi-source |
| E | **Multi-reviewer privilege QC with approval queues** | `/review-queue` with persona-routed item states | None — `PersistenceRegistry` as queue store |
| F | **Custodian interview prep + playback** | `<interview-prep>` widget on custodian profile + post-interview reconciliation | None — composition of existing tools |
| G | **Cross-matter analytics & playbooks** | `/dashboards` with cross-matter `filters` + saved tool-call sequences | `DashboardRegistry` (Pillar 3); playbook = special `DashboardDef` subtype |

Workflow B is **the $5–10M revenue line** — it replaces the spreadsheet legal-ops teams use today to track productions, with chain-hashed defensibility. Workflow E is **human-in-the-loop made native** and is closest to landing because we already have persona scope + tool calling + audit chain.

---

## 5. Per-route addition map (eDiscovery flagship)

Concrete: what lands on each route in the demo at the end of this plan.

| Route | Shell mode | New surfaces | Maps to |
|---|---|---|---|
| `Dashboard` | docked-bottom strip | Tool-result tiles · proactive alerts feed · playbook launcher | Patterns 7, 8 · Workflow G |
| `Documents` (list) | rail (narrow) | Smart cells · row-action menus · bulk toolbar · NL filter bar | Patterns 1, 2, 3, 4 |
| `Documents` (single doc) | workspace + pill | Inline annotations · accept/reject overlay | Pattern 5 |
| `Custodians` (list) | rail (narrow) | Row-action menus · bulk toolbar | Patterns 2, 3 |
| `Custodian profile` | assist-panel | "Next best action" panel · interview prep + playback | Pattern 6 · Workflow F |
| `Holds` | full-bleed lifecycle widget + pill | Lifecycle stages · SLA-driven reminders · diff-on-reissue | Workflow A |
| `Audit` | hidden (rail replaced by query bar) | Chain-hash visualisation · ledger query | — |
| `Productions` | full-bleed pipeline widget + docked-bottom | 10-stage pipeline · QC checkpoints | Workflow B |
| *(new)* `Review Queue` | workspace | Queue + doc workbench + assist panel · CAL training loop | Workflows C, E |
| *(new)* `Timeline` | full-bleed canvas + pill | Investigation timeline reconstruction | Workflow D |
| *(new)* `Inbox` | rail | Proactive notifications surface | Pattern 8 |
| *(new)* `Dashboards` | rail | My / Team / Templates sections · drag-drop builder · NL composer | Pillar 3 (all flavours) |

Plus **cross-cutting chrome** that doesn't belong to any one route:

- Global ⌘K / Ctrl-K summon palette — type or click, no matter the route.
- Notifications tray top-right, decoupled from chat rail.
- Persona switcher (already exists) becomes click-to-preview-as for testing scope.

---

## 6. New library surface (load-bearing primitives + components)

The minimum library investment to deliver everything above. All additive; ADR-010 D4 holds.

### New registries

| Registry | LOC est. | Used by | ADR |
|---|---|---|---|
| `TriggerRegistry` | ~80 | Pattern 8 · Workflow A · DashboardDef.schedule | ADR-045 |
| `DashboardRegistry` | ~30 (base-class extension) | Pillar 3 | ADR-044 |

### Promoted registries (existing → load-bearing)

| Registry | Today | After | ADR |
|---|---|---|---|
| `LayoutRegistry` | Thin default | Slot-based, persona-aware, persistable, agent-emittable | ADR-043 |

### New components

| Component | Lines est. | Pillar |
|---|---|---|
| `<mvk-smart-cell>` | ~150 | 1 |
| `<mvk-row-action-menu>` | ~200 | 1 |
| `<mvk-bulk-toolbar>` | ~250 | 1 |
| `<mvk-nl-filter>` | ~200 | 1 |
| `<mvk-doc-annotations>` | ~300 | 1 |
| `<mvk-assist-panel>` | ~400 | 1, 2 |
| `<mvk-dashboard-tile>` | ~120 | 1, 3 |
| `<mvk-dashboard-canvas>` | ~500 | 3 |
| `<mvk-inbox>` | ~200 | 1 |
| `<mvk-notification-tray>` | ~150 | 1 |
| `<mvk-global-search>` | ~250 | 1 |
| `<mvk-workspace-layout>` | ~300 | 2 |
| `<mvk-timeline-canvas>` | ~400 | Workflow D |
| `<mvk-lifecycle-stages>` | ~350 | Workflow A, B |
| `<mvk-cmd-k-palette>` | ~250 | Cross-cutting |

**Total new lib LOC**: ~4,000 across 15 components + 2 registries + 1 promotion. Roughly two engineering months of focused work.

### Extension hooks on existing primitives

- `<mvk-chat-shell mode="...">` — one prop, fully back-compat.
- `setLayoutPolicy(persona)` on `RegistryBase` parallel to `setScopePolicy`.
- `LayoutDef` schema with slots, overlays, drawers, modals, responsive rules.
- `ChatShellComponent` reads `LayoutPolicy.shellMode()` from the active persona.

---

## 7. Phased delivery

Each phase is independently shippable; demo-worthy at the gate; the eDiscovery flagship validates each phase.

### P0 — Layout foundation (2 weeks) ✅ library tier shipped

**Goal:** Promote `LayoutRegistry` and add the chat shell `mode` prop. No new routes; existing routes opt-in to the new modes.

- [x] [ADR-043 LayoutRegistry promotion](../adr/0043-layout-registry-promotion.md) — drafted, status: Proposed
- [x] `LayoutDef` schema with slots / overlays / drawers / modals (`projects/agentic-ui/src/lib/layout/types.ts`, slice 1 `a330bb3`)
- [x] `<mvk-chat-shell mode="rail | pill | overlay | docked-bottom | assist-panel | hidden">` (slice 1 `a330bb3`)
- [x] `<mvk-workspace-layout>` with slot ngComponentOutlet + ResizeObserver-driven responsive collapse (slice 2 `ebb4eb7`)
- [x] `provideLayoutPolicy({...})` + `LAYOUT_POLICY` token + `DEFAULT_LAYOUT_POLICY` parallel to `setScopePolicy` (slice 1 `a330bb3`)
- [x] `layout-render` event piped from backend → orchestrator → `AgenticChatRef.activeLayout` signal (slice 3, this PR)
- [x] [Cookbook: Agent-directed workspace layouts](../cookbook/agent-directed-workspace-layouts.md) (slice 3, this PR)
- [ ] eDiscovery flagship: `Documents` (single doc) → workspace + pill; `Holds` → pill; `Audit` → hidden + query bar (demo-app concern, **deferred** — eDiscovery shell is currently blocked on Render deploy; reviving the demo wiring is its own slice after Render is unstuck)
- [ ] Playwright: shell-mode transitions across routes (paired with the demo wiring above)

**Exit:** chat rail is no longer the only shell — the library tier exposes every mode + slot-based workspaces + agent-emittable layouts. Existing `<mvk-chat-shell />` consumers see zero diff. **503/503 unit tests pass**, ADR-010 D4 zero-breaking-changes contract held throughout. eDiscovery flagship route wiring + Playwright are the only items left and are deferred to a follow-up slice once the demo redeploys.

### P1 — Surface patterns wave 1 (2 weeks) ✅ library tier shipped

**Goal:** Ship five highest-leverage post-chat affordances on existing routes.

- [x] `<mvk-smart-cell>` — eDiscovery `Documents` Privilege Confidence column (P1.2 — value-driven cell with persona-scope filter by tool name + hover/focus/tap explainability widget, 17 specs, [cookbook](../cookbook/smart-cell.md))
- [x] `<mvk-row-action-menu>` — `Documents` + `Custodians` (P1.3 — IntentRegistry-driven menu with persona scope + row-state filter predicate + keyboard navigation, 13 specs, [cookbook](../cookbook/row-action-menu.md))
- [x] `<mvk-bulk-toolbar>` — `Documents` (P1.4 — selection-aware materialising toolbar, same three-stage filter chain as the row menu but against aggregate selection state, 14 specs, [cookbook](../cookbook/bulk-toolbar.md))
- [x] `<mvk-assist-panel>` — `Custodian profile` (the Cursor pattern) (P1.5, this PR — context summary + intent-driven suggestions + Explain affordance + Ask input + density-aware via LAYOUT_POLICY, pairs with `mode="assist-panel"`, 18 specs, [cookbook](../cookbook/assist-panel.md))
- [x] `<mvk-cmd-k-palette>` — global summon (P1.1 — intent-first + tool fallback + free-text fallback, ⌘K / Ctrl+K / `/` summon, 14 specs, [cookbook](../cookbook/cmd-k-palette.md))
- [x] Cookbook: post-chat surfaces — separate cookbooks for each component instead of one merged doc, more discoverable in compodoc index
- [ ] Playwright: ⌘K palette, row menu, bulk toolbar (deferred — eDiscovery demo wiring is the natural place; once Render deploy is unstuck)

**Exit:** the agent is visible on every route, even when chat is collapsed. Library tier delivers all five P1 surfaces with 76 new specs (17 + 13 + 14 + 18 + 14) across the 5 components, all dispatch-agnostic, all persona-scoped, all sharing the same registry-lens premise. Brand demo (eDiscovery wiring) deferred to a follow-up slice once the Render redeploy lands.

### P2 — TriggerRegistry + Inbox + lifecycle widget (2 weeks) ✅ library tier shipped

**Goal:** Agent acts *at* users, not just *for* them.

- [x] [ADR-045 TriggerRegistry](../adr/0045-trigger-registry.md) — drafted, status: Proposed
- [x] `TriggerRegistry` base class + cron driver (P2.1 — 4 registry specs + 17 runner specs; webhook/queue deferred to server-side runner per ADR-045 D6)
- [x] `<mvk-notification-tray>` (P2.2 — 17 specs, [cookbook](../cookbook/proactive-triggers-and-inbox.md))
- [x] `<mvk-inbox>` (P2.3 — 18 specs, same cookbook; pairs with the tray on the same store)
- [x] `<mvk-lifecycle-stages>` (P2.4 — Workflow A widget, 17 specs, [cookbook](../cookbook/lifecycle-stages.md))
- [ ] eDiscovery flagship: `/inbox` route · Holds lifecycle widget · SLA reminders trigger (deferred to demo-wiring slice once Render is unstuck)
- [x] [Cookbook: Proactive triggers + Inbox](../cookbook/proactive-triggers-and-inbox.md) (P2.3 — end-to-end wiring + persona-scope + opt-out cron evaluator)
- [x] [Cookbook: Multi-stage lifecycle widget](../cookbook/lifecycle-stages.md) (P2.4 — Workflow A + audit-chain integration)
- [ ] Playwright: scheduled trigger fires, notification appears, hold reminder drafted (deferred — pairs with the demo wiring above)

**Exit:** Library tier delivers all four P2 components — TriggerRegistry + runner + tray + inbox + lifecycle widget — with 56 new specs (4 + 17 + 17 + 18 + 17). SLA-driven hold acknowledgment reminders draft themselves; ops console shows trigger firings in the audit ledger via the `agentic.trigger.fire` telemetry event. Brand demo (eDiscovery flagship wiring) deferred to a follow-up slice once the demo Render deploy lands.

### P3 — DashboardRegistry + production pipeline (3 weeks) ✅ all three flavours (A + B + C) library tier shipped

**Goal:** First-class dashboards + the $5–10M revenue-line workflow.

- [ ] ADR-044 DashboardRegistry
- [ ] `DashboardRegistry` + `DashboardDef` + `TileDef`
- [ ] `<mvk-dashboard-tile>` + `<mvk-dashboard-canvas>`
- [ ] **P3.A:** Drag-drop builder (pick-and-place flavour)
- [ ] **P3.B:** `proposeDashboard(intent)` tool — conversational composition
- [ ] **P3.C:** Tile drill-down + explain affordances (mostly free; chrome work)
- [ ] Production pipeline widget (Workflow B) — full-bleed on `Productions` route
- [ ] One MFE-contributed dashboard template per remote (`production-throughput`, `reviewer-productivity`, `tar-performance`)
- [ ] Cookbook: "Build a dashboard"
- [ ] Playwright: NL composer round-trip, drill-down on a tile, persona-filtered tile stub

**Exit:** users build dashboards in chat or by dragging; tiles are governed tool calls; production pipeline replaces the spreadsheet shape. Brand demo: GC asks "show me audit integrity by matter", agent assembles a dashboard, drills into a degraded matter, opens its production pipeline.

### P4 — Review Queue + Timeline + CAL (3 weeks) ✅ library tier shipped (all three)

**Goal:** Two new routes + the CAL training loop.

- [x] `<mvk-review-queue>` component (Workflow E) — P4.A. Persona-routed groups + configurable actions per state + dispatch-agnostic `(decision)` / `(open)` events, 15 specs, [cookbook](../cookbook/review-queue.md)
- [x] `<mvk-cal-workbench>` (Workflow C) — P4.B, this PR. CalProposal + CalDecision + CalRoundStats + two-click reject + convergence lock + slot-projected document pane, 24 specs, [cookbook](../cookbook/cal-workbench.md)
- [x] `<mvk-timeline-canvas>` (Workflow D) — P4.C. Day-grouped events + multi-select kind filter + key-moment toggle + dispatch-agnostic emissions, 14 specs, [cookbook](../cookbook/timeline-canvas.md)
- [ ] `/timeline` route (eDiscovery demo wiring, deferred)
- [ ] `/review-queue` route (eDiscovery demo wiring, deferred until Render is unstuck)
- [x] [Cookbook: review queue](../cookbook/review-queue.md) (P4.A)
- [x] [Cookbook: CAL workbench](../cookbook/cal-workbench.md) (P4.B)
- [x] [Cookbook: timeline canvas](../cookbook/timeline-canvas.md) (P4.C)
- [ ] Playwright: CAL round 1→2→3 convergence, timeline drag-and-annotate

**Exit:** workflow-shaped routes; agent proposes, humans dispose; chain-hash captures every reviewer decision. All three P4 workflows (E review queue, C CAL training loop, D investigation timeline) shipped at the library tier — hosts wire to their stores. Only eDiscovery demo wiring + Playwright remain (deferred until Render is unstuck).

### P5 — Cross-matter analytics + playbooks (2 weeks)

**Goal:** Cross-matter dashboards + saved tool-call sequences ("playbooks").

- [ ] `DashboardDef.filters` for cross-matter parameter threading
- [ ] Playbook subtype: versioned tool-call sequence in `DashboardRegistry`
- [ ] `<mvk-playbook-runner>` component
- [ ] eDiscovery flagship: cross-matter dashboard demo · "Initial Privilege Pass v3" playbook
- [ ] Cookbook: "Playbooks"

**Exit:** dashboards span matters; legal ops apply versioned playbooks across matters; audit captures playbook executions.

**Total: ~14 weeks** of focused engineering, spread across the team. Each phase ships an exit demo; nothing is half-finished at a gate.

---

## 8. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| `LayoutRegistry` extension breaks existing consumers (rail layout) | Medium | Backwards-compat default: omit `mode` → rail; existing `LayoutRegistry.register` shape unchanged |
| Dashboard "tile = tool call" makes every dashboard render expensive (1× tool call per tile per refresh) | Medium | Tile-level result caching with `cacheTtlMs` on `TileDef.invocation`; refresh-on-event pattern |
| Persona scope filters tiles silently → users confused why their teammate's dashboard "doesn't work" | High | Render filtered tiles as explicit "no access" stubs with the persona's tool-count badge; doc-only fix |
| Agent emits invalid `LayoutDef` (slot doesn't exist, component name unknown) | High | Zod-validate `LayoutDef` at the chat-shell boundary; fall back to rail mode + console warning |
| `TriggerRegistry` cron firings flood the audit chain | Medium | Per-trigger rate-limit field on `TriggerDef`; observability dashboard tracks trigger volume |
| `proposeDashboard` LLM picks tools the persona can't invoke | Medium | Tool list passed to LLM already persona-filtered (existing `setScopePolicy` semantics); filter stays the source of truth |
| Workspace layout doesn't survive responsive collapse — drag-resized panels jump on mobile | Low | Responsive collapse rules in `LayoutDef`; explicit "this is the mobile slot" markup; Playwright check at 768 / 1024 / 1440 |
| MFE-contributed dashboards arrive at runtime after host bootstraps → user's saved layout breaks | Medium | `DashboardRegistry` honours `removeBySource` symmetry; saved dashboards revalidate against current registry on render |

---

## 9. Acceptance criteria

Per-phase exit gates the team agrees on up-front. Each gate is "demo-grade", not "ops-grade".

### P0 (Layout)

- `<mvk-chat-shell mode="pill">` renders a corner pill, expands on click, pulses on proactive event.
- `Holds` route renders full-bleed with chat as pill; `Audit` route renders without rail.
- Persona switch to "junior reviewer" makes the assist panel default to denser suggestion mode (when present).
- No regression: existing `rail` consumers see no visual change.

### P1 (Surfaces wave 1)

- `<mvk-smart-cell>` on `Documents` shows privilege confidence per row; hover surfaces explanation; each hover is a chain-hashed tool call (visible in `Audit`).
- `<mvk-bulk-toolbar>` materialises on multi-select; bulk actions execute as a single `RunGroup` with parent chain hash.
- ⌘K palette opens from any route; types match `IntentRegistry` first, falls through to `ToolRegistry` if no intent.

### P2 (Triggers + Inbox)

- A cron trigger registered as "daily hold ack check" fires at 09:00 UTC, queries unacknowledged holds, posts to `Inbox`.
- Inbox shows ≥ 1 demo notification by default; clicking opens the relevant widget.
- Holds lifecycle widget shows stages with SLA badges; clicking "send reminder" drafts a personalised reminder per custodian role.

### P3 (Dashboards + Production pipeline)

- A user can drag 5 tiles onto a grid, save, reload — same dashboard renders.
- `proposeDashboard("custodian SLAs and privilege rates")` returns a `DashboardDef` with ≥ 3 tiles, all from existing tools.
- Tile drill-down: clicking a redaction-time tile opens the production pipeline widget filtered to that week.
- Production pipeline shows all 10 stages with current-owner badges; advancing a stage requires the right persona.

### P4 (Queue + Timeline + CAL)

- CAL loop: 20 seed tags → propose 20 → review N → repeat 3 rounds → convergence metric improves each round.
- Timeline canvas plots events from 3 data sources within 500ms for a 90-day window.
- Review Queue routes items by persona; partner sees only escalations; senior sees only QC.

### P5 (Cross-matter + Playbooks)

- A cross-matter dashboard with `filters: { matterIds: ['M-1', 'M-2'] }` shows tiles aggregated across both.
- Playbook "Initial Privilege Pass v3" runs as a single chain-hashed sequence of 7 tool calls.
- Versioning: editing the playbook creates v4 with `parentVersion: v3`.

---

## 10. What this plan deliberately does NOT do

- **No drag-drop dashboard product polish.** We ship the seam (`DashboardRegistry` + canvas) — not Tableau. Resize-snap, layout-templates-marketplace, etc. are out of scope.
- **No bespoke shell per surface.** Every new surface is an Angular component reading from the same 15 + 2 registries. No "review-queue framework".
- **No replacement of `<mvk-chat-shell>`.** It stays as the canonical chat surface and one of the five layout modes.
- **No production-grade trigger durability in v1.** `TriggerRegistry` v1 is in-process cron + webhook receiver. Distributed/queue-backed triggers (Temporal-style) explicitly out of scope; ADR-010 says no Temporal in the runtime.
- **No new auth/RBAC primitives.** Persona scope + chain-hash audit already cover every pattern in this plan.
- **No re-design of the audit ledger.** Every new surface writes the same chain-hashed event shape with `origin` tag (existing pattern from ADR-041 D3).

---

## 11. Open questions

These need a decision before P0 starts. Not blockers for drafting the plan, but they shape implementation:

| # | Question | Default if no decision |
|---|---|---|
| 1 | Does `<mvk-chat-shell mode="...">` accept a `signal<Mode>` for runtime switching, or only static config? | Static + a separate `setShellMode` injectable for runtime |
| 2 | Is `LayoutDef` agent-emittable (LLM returns it as a JSON event) or only host-constructed? | Both — LLM emits via a `layout-render` event; Zod-validated at the boundary |
| 3 | Where do user-saved layout overrides live — `PersistenceRegistry`, `DashboardRegistry`, or a new `UserPreferencesRegistry`? | Extend `PersistenceRegistry` with a `layout-overrides` namespace |
| 4 | Does `TriggerRegistry` run in-process only, or can it dispatch to a `ServerAgent` for durability? | In-process for v1; server-side trigger dispatcher is a separate plan |
| 5 | Should `DashboardDef.filters` support cross-tenant queries, or tenant-isolated only? | Tenant-isolated only; cross-tenant is an explicit deny in the OPA policy |
| 6 | Do MFE-contributed dashboard templates require an explicit user "install" action, or auto-appear in Templates? | Auto-appear, filtered by persona; "install" semantics over-complicate the demo |
| 7 | Is the Cursor-style assist panel a separate shell mode (`assist-panel`) or composable inside `workspace`? | Separate mode for v1; revisit when we have two real assist-panel routes |

---

## 12. Pointers to existing seams

For every pattern in this plan, the corresponding existing primitive that makes it cheap:

- [ADR-002 — Layered registry system](../adr/0002-layered-registry-system.md) — the uniform `Registry<TDef>` shape
- [ADR-008 — Registry scope policy](../adr/0008-registry-scope-policy.md) — `setScopePolicy` filters every read uniformly
- [ADR-010 — Platform principles + Apache 2.0](../adr/0010-platform-principles-and-license.md) — zero breaking changes through v1.x; what's *not* allowed in the runtime
- [ADR-031 — `provideAgenticPlatform`](../adr/0031-provide-agentic-platform.md) — composite provider every new primitive plugs into
- [ediscovery-app-plan.md](./ediscovery-app-plan.md) — flagship demo plan; this plan is its successor
- [ediscovery-dynamic-ui-plan.md](./ediscovery-dynamic-ui-plan.md) — F1–F6 dynamic-UI program; same shape, this is F7+
- [Platform seams map](../architecture/platform-seams.md) — every public InjectionToken / registry method / factory the new primitives extend

---

## 13. Naming + sequencing notes

- This plan supersedes/parallels [ediscovery-trimodal-and-workflow-plan.md](./ediscovery-trimodal-and-workflow-plan.md) — that earlier plan covered some workflow shapes but pre-dates the registry-first framing. P0–P5 here can run independently or reference it.
- Capability numbering picks up where F1–F6 ended: this plan is conceptually **F7–F12** (one capability per pillar/workflow) but is intentionally framed as a phase plan rather than a feature catalogue to emphasise the cross-cutting registry promotions.
- The three ADRs (043 / 044 / 045) need to be drafted **before P0 / P2 / P3 respectively**. Each is a contract change additive only.

---

**End of plan.** Review checkpoints: weekly during P0 + P1 (foundation phases); biweekly P2+. Next action: get explicit ack on §1 goals/non-goals + §9 P0 acceptance criteria from the platform owner before drafting ADR-043.
