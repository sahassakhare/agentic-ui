# ADR-043 — LayoutRegistry promotion to load-bearing primitive

**Status:** Proposed · **Date:** 2026-05-12 · **Decider:** sahas
**Supersedes:** none · **Related:** ADR-002 (Layered registry system), ADR-008 (Registry scope policy), ADR-010 (Platform principles — zero breaking changes), ADR-031 (`provideAgenticPlatform`), [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md) (P0)

## Context

`LayoutRegistry` is one of the four **Seam** registries today ([ADR-002](./0002-layered-registry-system.md)). It ships as a thin default — a single registered layout that wraps `<mvk-chat-shell>` in a three-pane shell (left nav · routed pages · collapsible chat rail). Consumers can register additional layouts, but the existing surface only exposes a single-component renderer hook; there is no notion of slots, overlays, persona-aware layout policy, or agent-emittable layout decisions.

The [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md) needs the agent to **direct the screen**, not just produce widgets — emit a `LayoutDef` that opens a doc preview in one slot, a tag panel in another, with the chat rail collapsed to a pill. It also needs **per-persona shell modes** so a junior reviewer sees a suggestion-rich layout and a partner sees a compressed one without forking templates. And it needs **dashboards** (ADR-044) and **review queues** to render as multi-pane workspaces inside the same Angular host.

Today's `LayoutRegistry` can't carry any of that. It needs to be promoted from "thin default" to a load-bearing primitive — slot-based, persona-aware, persistable, and agent-emittable.

The constraint: [ADR-010 D4](./0010-platform-principles-and-license.md) holds. Every change in this ADR is **additive only**. Existing `LayoutRegistry.register({ name, render })` consumers see no breaking change; the chat shell's current rail mode remains the default.

## Decision

Six decisions, taken together they promote `LayoutRegistry` to a first-class agent-emittable primitive while preserving the existing thin-default surface.

### D1 — `LayoutDef` extends to slot-based composition

The current `LayoutDef` shape is `{ name, render }` — a single render function that returns one Angular component. Extend it (additively) to support **named slots**, **overlays / drawers / modals**, and **responsive collapse rules**:

```ts
interface LayoutDef {
  // Existing surface — preserved.
  name: string;
  render?: (input: LayoutInput) => Component;   // back-compat path

  // New surface — opt-in. If present, takes precedence over render().
  scopes?: string[];                            // persona scope, same field as ToolDef
  slots?: Record<string, SlotDef>;              // primary, sidebar, footer, overlay, …
  responsive?: ResponsiveCollapseRule[];
  source?: 'user' | string;                     // MFE source for removeBySource

  // Existing fields from ADR-014 governance metadata — unchanged.
  requiredHostVersion?: string;
  tags?: string[];
  owner?: string;
  lifecycle?: 'active' | 'deprecated' | 'disabled';
}

interface SlotDef {
  component: string;                            // ComponentRegistry name
  props?: unknown;                              // Zod-validated against the component's schema
  size?: { default: string; min?: string; max?: string };  // e.g. '60%', '320px'
  pinned?: boolean;                             // user can't collapse
  open?: 'inline' | 'modal' | 'drawer' | 'overlay';
}

interface ResponsiveCollapseRule {
  belowPx: number;                              // breakpoint
  collapse: string[];                           // slot names that disappear
  drawer: string[];                             // slot names that become a drawer
}
```

`render()` and `slots` are mutually exclusive at the consumer level — if both are present, `slots` wins. Existing `LayoutRegistry.register({ name, render })` callers continue working with no change because they never set `slots`.

A new component `<mvk-workspace-layout [layoutName]="...">` reads the slot definition and composes via `*ngComponentOutlet` inside CDK splitters. Adding a new slot kind = registering a new widget in `ComponentRegistry`. No bespoke layout-component zoo.

### D2 — `<mvk-chat-shell>` adds a `mode` prop, defaulting to `"rail"`

The chat shell exposes its presentation as a prop:

```ts
type ChatShellMode = 'rail' | 'pill' | 'overlay' | 'docked-bottom' | 'assist-panel' | 'hidden';

@Component({ selector: 'mvk-chat-shell', ... })
export class ChatShellComponent {
  readonly mode = input<ChatShellMode>('rail');
  // ...
}
```

Five modes, default `rail`. Existing consumers (`<mvk-chat-shell />`) see no change. Per-route mode lookup happens via the new `LayoutPolicy` (D4) — apps that want runtime switching read it and bind to `[mode]`.

The five modes correspond to layout intensities catalogued in the [post-chat-surfaces plan §3 Pillar 2](../plans/post-chat-surfaces-plan.md#pillar-2--layout-primitives-the-agent-reshapes-the-canvas):

| Mode | Use when | Real estate cost |
|---|---|---|
| `rail` (default) | List + filter + CRUD-shaped routes | ~360px persistent right rail |
| `pill` | Inspector-first routes (doc review, canvas) | ~80px floating pill in corner; expands on click |
| `overlay` | Transient over current view | Full-screen overlay, dismissible |
| `docked-bottom` | Glance-driven dashboards | ~120px sticky strip |
| `assist-panel` | Expert work (profile pages) | ~35% structured panel (Cursor pattern) |
| `hidden` | Audit / query-bar routes | 0 — chat is the wrong primitive here |

`assist-panel` differs from `rail` in shape: it renders **structured affordances** (next-actions list, explain-on-cursor, scoped query box) above a small chat at the bottom — not the full conversation transcript.

### D3 — `LayoutDef` becomes agent-emittable via an AG-UI event

The agent can emit a new event kind on its event stream:

```ts
type LayoutRenderEvent = {
  type: 'LAYOUT_RENDER';
  layout: LayoutDef | string;     // string = registry lookup; object = ad-hoc
  data?: Record<string, unknown>; // shared params for slot props
};
```

The chat shell honours `LAYOUT_RENDER` events the way it honours `components: [...]` today: Zod-validates the payload, looks up referenced components in `ComponentRegistry` (filtered by persona), then mounts via `<mvk-workspace-layout>`. Invalid payloads fall back to rail mode + a `console.warn` (consistent with existing behaviour on bad `components`).

Pre-registered layouts give predictable shapes. Ad-hoc layouts give flexibility. Both flow through the same validation + mount path.

### D4 — `setLayoutPolicy(persona)` on `RegistryBase`, parallel to `setScopePolicy`

Today persona scope filters *which tools are visible* via `setScopePolicy`. Extend `RegistryBase` with a parallel `setLayoutPolicy` that returns per-persona **shell-mode + layout-density** preferences:

```ts
interface LayoutPolicy {
  shellMode(route: string): ChatShellMode;
  density(): 'comfortable' | 'compact' | 'dense';
  workspaceLayout?(route: string): string | null;   // override default layout per route
}

// Usage in app.config.ts
provideLayoutPolicy({
  paralegal:  { density: 'comfortable', shellMode: r => r.startsWith('/holds') ? 'pill' : 'rail' },
  partner:    { density: 'compact',     shellMode: r => 'rail' },
  reviewer:   { density: 'dense',       shellMode: r => '/documents/' === r.slice(0,11) ? 'pill' : 'rail' },
});
```

`LayoutPolicy` is an `InjectionToken` resolved per-active-persona, identical mechanism to the existing IAM persona resolver from [ADR-016](./0016-iam-role-mapping.md). The chat shell reads it via `inject(LAYOUT_POLICY).shellMode(router.url)` and binds the result to its `[mode]` input.

This is ~30 LOC of base-class extension + one new InjectionToken. Apps that don't provide a `LayoutPolicy` get default behaviour (rail mode, comfortable density).

### D5 — User overrides land in `PersistenceRegistry` under a `layout-overrides` namespace

When a user drags a divider, pins a widget, or collapses a slot, the override persists. Three properties:

- **Scope:** per-persona, per-route, per-matter (matter is optional in non-eDiscovery contexts).
- **Precedence:** user override > LayoutPolicy density > LayoutDef default.
- **Storage:** `PersistenceRegistry.get('layout-overrides').set(key, override)`. No new registry — reuses the existing seam from [ADR-002](./0002-layered-registry-system.md).

The agent proposes; the user disposes; the system remembers. When the agent emits a `LayoutDef` for the same route + persona again, the chat shell consults `layout-overrides` and applies user adjustments before rendering.

### D6 — Responsive collapse rules live in `LayoutDef`, not in CSS

Below 1024px (or whatever breakpoint), the three-pane shell breaks. Today the chat shell handles this with media queries and ad-hoc collapse. With slot-based layouts, the chat shell can't know in advance which slot is "the important one" for a given `LayoutDef` — that depends on the workflow.

Encode collapse rules in the `LayoutDef`:

```ts
{
  name: 'review-workbench',
  slots: {
    primary:  { component: 'documentPreview', size: { default: '60%' } },
    sidebar:  { component: 'tagPanel',        size: { default: '25%' } },
    footer:   { component: 'privilegeLog',    size: { default: '15%' } },
  },
  responsive: [
    { belowPx: 1024, collapse: ['footer'], drawer: ['sidebar'] },
    { belowPx: 768,  collapse: ['sidebar', 'footer'], drawer: [] },
  ],
}
```

The chat shell + workspace-layout component consult these rules at render time and degrade explicitly. Mobile and tablet aren't a separate app — they're a collapsed projection of the same `LayoutDef`. Same audit chain, same persona scope, same registry reads.

## Consequences

### Positive

- **Agent can direct the screen.** Multi-pane workspaces become a `LAYOUT_RENDER` event, not a chat shell hack. This unblocks Pillar 2 + 3 of the post-chat-surfaces plan and enables Workflows B (production pipeline), C (CAL loop), D (timeline reconstruction), E (review queue).
- **Persona-aware layouts.** Junior reviewer and partner see different *shapes* of the same route, not just different *content*. No template fork.
- **Layout overrides persist.** Drag a divider → it stays dragged across sessions, scoped per-persona-per-route.
- **MFE-contributed layouts.** A `production` MFE remote can register `production-pipeline` as a `LayoutDef` alongside its tools and widgets. `removeBySource` symmetry holds — unload the remote, the layout disappears.
- **Responsive degradation is declarative.** Mobile collapse rules live next to the `LayoutDef`, not in CSS scattered across the codebase.
- **Zero breaking changes.** Existing `LayoutRegistry.register({ name, render })` callers keep working. Existing `<mvk-chat-shell />` consumers see no diff. ADR-010 D4 holds.

### Negative

- **`LayoutDef` validation surface grows.** Zod schemas for slot specs + responsive rules + override merges add ~200 LOC of schema + tests. Mitigation: schemas live next to the existing `ComponentDef` / `ToolDef` Zod patterns; same shape.
- **Layout overrides + agent-emitted layouts can conflict.** Agent says "open this slot at 60%"; user previously dragged it to 30%. Decision per D5: **user override wins**. Documented in the `<mvk-workspace-layout>` cookbook.
- **`assist-panel` mode is a new shell shape, not just a CSS variation.** ~400 LOC component (per plan §6) — non-trivial. Mitigation: treat as P1 deliverable per the plan, not part of P0 minimum. The other four modes (rail/pill/overlay/docked-bottom/hidden) ship in P0.
- **Per-persona layout policy adds an InjectionToken count.** [Platform seams map](../architecture/platform-seams.md) bumps from 13 tokens to 14. Mitigation: dedicated section in the seams doc, modeled on the existing `TEAMS_CONTEXT` write-up from [ADR-041](./0041-teams-copilot-external-surfaces.md) D4.

### Neutral / out-of-scope

- **No new top-level Angular module.** All additions go into the existing `@infra-tools/agentic-ui` primary entry per [ADR-005](./0005-single-primary-entry.md).
- **Layout sharing across users.** Sharing a layout (e.g. "send me your review-workbench setup") is **deferred** to ADR-044 (DashboardRegistry) — dashboards are the natural sharing primitive for multi-slot compositions, and saved layouts live inside `DashboardDef.layout`.
- **Layout templates marketplace.** Out of scope. MFE-contributed layouts are the supported distribution path; no separate marketplace registry.
- **Animation specs.** Pill-to-rail transition timing, drawer slide-in easing, etc. are deferred to component implementation. Spec doc, not ADR.

## Alternatives considered

### A. Leave `LayoutRegistry` as-is, build per-route components

**Discarded.** Forks the chat shell per route; persona-aware shell modes become impossible without per-app conditionals; MFE remotes can't contribute layouts at runtime. The cost grows with every new route.

### B. Single `LayoutDef.render()` returning a composite component

**Discarded.** The agent can't decompose a render function back into slot intentions. Slot-based composition is needed for the `LAYOUT_RENDER` event in D3; a single render function defeats agent-emittability.

### C. Use Angular Material's `MatSidenavContainer` directly as the workspace primitive

**Discarded.** Hardcodes a specific UI library. The library deliberately stays UI-agnostic — adopters use Material, CDK alone, or their own design system. `<mvk-workspace-layout>` ships with CDK splitters (already a dependency for layout-registry defaults), no Material requirement.

### D. Bake responsive collapse rules into the chat shell's CSS

**Discarded.** The chat shell can't know which slot is important for a given workflow. Production pipeline wants the pipeline canvas to dominate; CAL loop wants the document. Encoding these per-LayoutDef (D6) is the only honest path.

### E. Persona-aware layouts via `LayoutRegistry.setScopePolicy` (reusing existing seam)

**Discarded.** Scope policy is a filter ("which entries are visible"); layout policy is a transformation ("how does this entry render in *this* persona's shell"). Conceptually different. Reusing `setScopePolicy` would either return all-or-nothing filtering (no good) or grow to support transformation results (semantic creep on a load-bearing API). A parallel `setLayoutPolicy` is cleaner and matches the existing pattern from [ADR-008](./0008-registry-scope-policy.md).

## Implementation notes

Sequenced for P0 of the post-chat-surfaces plan (~2 weeks):

1. **Zod schemas** for `LayoutDef`, `SlotDef`, `ResponsiveCollapseRule`. Live in `projects/agentic-ui/src/lib/layout/types.ts`. ~150 LOC.
2. **`LayoutRegistry` base-class extension** to validate slot-based defs at register time. Existing `render`-based path untouched. ~50 LOC.
3. **`<mvk-chat-shell mode="...">` prop** + reading from `LAYOUT_POLICY` InjectionToken. ~80 LOC change.
4. **`<mvk-workspace-layout>` component** reading from `LayoutRegistry.get(name)`. CDK splitters, slot ngComponentOutlet, responsive observer. ~300 LOC.
5. **`provideLayoutPolicy` factory** in `projects/agentic-ui/src/lib/platform/`. ~80 LOC.
6. **`LAYOUT_RENDER` event handling** in the existing chat-shell event mapper. Routes valid payloads to `<mvk-workspace-layout>`, invalid to fallback. ~60 LOC.
7. **`PersistenceRegistry` `layout-overrides` namespace convention** documented; no code change to PersistenceRegistry itself.
8. **`<mvk-assist-panel>` component** as a *separate* P1 deliverable per plan §7 — explicitly not part of this ADR's P0 scope. P0 ships four modes (rail/pill/overlay/docked-bottom/hidden); assist-panel mode arrives with the component in P1.
9. **Cookbook + Playwright + Compodoc updates.** Cookbook: "Per-route shell modes" + "Workspace layouts". Playwright: shell-mode transitions, slot-based layout render, responsive collapse at 1024/768.
10. **eDiscovery flagship demo wiring:**
    - `/documents/:id` route → workspace layout (doc preview 60% / annotations 25% / tag panel 15%) + chat mode `pill`
    - `/holds` route → chat mode `pill` (lifecycle widget arrives in P2)
    - `/audit` route → chat mode `hidden` + query bar at top

P0 exit criteria are §9 of the [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md#p0-layout).

## Open questions

Carried forward from plan §11. Decide before implementation:

1. Does `<mvk-chat-shell mode="...">` accept a `signal<Mode>` for runtime switching, or only static config? **Tentative:** static + a separate `setShellMode` injectable for runtime.
2. Is `LayoutDef` agent-emittable (LLM returns it as a JSON event) or only host-constructed? **Tentative per D3:** both — LLM emits via `LAYOUT_RENDER`, Zod-validated at the boundary.
3. Where do user-saved layout overrides live — `PersistenceRegistry`, `DashboardRegistry` (ADR-044), or a new `UserPreferencesRegistry`? **Tentative per D5:** `PersistenceRegistry` with a `layout-overrides` namespace.

## Status

**Accepted (library tier shipped).** All six decisions (D1–D6) are implemented across three commits:

- Slice 1 — `a330bb3` — schemas + `ChatShellMode` + `<mvk-chat-shell mode>` + `provideLayoutPolicy` + `LAYOUT_POLICY` token
- Slice 2 — `ebb4eb7` — `<mvk-workspace-layout>` with ResizeObserver-driven responsive collapse
- Slice 3 — this commit — `layout-render` event piped from backend → orchestrator → `AgenticChatRef.activeLayout`, plus the cookbook entry

**503/503 unit tests pass.** Existing `<mvk-chat-shell />` consumers and `LayoutRegistry.register({ name, render })` callers see zero diff — ADR-010 D4 zero-breaking-changes contract held throughout.

**Open follow-ups:**
- eDiscovery flagship route wiring (`/holds` → pill, `/audit` → hidden, `/documents/:id` → workspace) — deferred until the demo's Render deploy is unstuck; this is a demo concern, not a library concern.
- Playwright shell-mode transition specs — pairs with the demo wiring above.
- `<mvk-assist-panel>` (the Cursor pattern) — P1 deliverable per the plan, not P0.
