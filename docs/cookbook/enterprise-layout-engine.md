# Enterprise layout engine — the agentic-UI walkthrough

**ADR refs:** [ADR-046](../adr/0046-layered-layout-engine.md) (LayeredLayoutEngine), [ADR-047](../adr/0047-agentic-ui-coordination-layer.md) (Agentic-UI Coordination Layer)

This cookbook walks an adopter through the canonical *"reviewer arrives Monday morning, no prompts needed"* flow end-to-end. It demonstrates how `LayoutResolver`, `AgentContextProvider`, `LayeredLayoutStore`, `LayoutAuditTracker`, and the template catalog cooperate to produce a workspace that adapts to context — route, persona, selection, matter phase, agent — without forcing the user to type their way through every change.

If you've read the ADRs, this is the "show me how it actually works" companion. If you haven't, the doc still stands on its own — concepts are introduced as they're needed.

---

## 1. The mental model in one paragraph

The screen state is a **resolved `SlotMap`**, computed reactively from a stack of inputs each carrying their own precedence weight. Routes contribute a baseline. Persona pins extra slots. The agent's `setWorkspaceLayout` tool writes to a volatile top layer. The user's *"📌 Save as my preference"* button writes to a durable user-saved layer. Selection (which document you clicked) is its own input. Every time any input changes, the resolver re-merges by precedence — slot-level, not whole-layout — and emits a single `ResolvedLayout` the `<mvk-workspace-layout>` binds to. Every change is captured in a chain-hashed audit trail with attribution. The agent gets a per-turn context block describing the live state so it can reason about what to do.

That's the whole engine. The rest of this doc is concrete wiring + the demo flows it produces.

---

## 2. The seven precedence layers

```
weight   layer            source                                  durability
─────    ──────────────   ────────────────────────────────────    ───────────────
1000     agent            setWorkspaceLayout / slot-edit tools    volatile (Reset)
 800     user-saved       "📌 Save as my preference"              persisted (server / IDB / local)
 600     matter-default   matter-lead pushes per-matter layout    server (per matter)
 400     contextual       route / selection / alert / time-of-day computed live
 300     matter-phase     collection / review / production        per matter
 200     persona          per-persona pins                        adopter-supplied
 100     org-default      org admin baseline                      server (per tenant)
   0     hardcoded        lib-shipped fallback                    (last resort)
```

Higher wins on slot conflict. Lib defaults are in `DEFAULT_LAYOUT_WEIGHTS`; adopters override via `provideLayoutResolver({ weights: { ... } })`.

**Slot-level merge, not layout-level replace.** A user-saved rule can pin only `sidebar`; matter-default contributes `primary`; persona-default contributes `footer`. The resolver merges per-slot. Replace-the-whole-layout is just a rule that names every slot.

**Eviction** is separate from override: a rule can declare `evictSlots: ['footer']` to drop a slot lower-priority rules would supply, useful for *"the agent says hide the footer, don't replace it with anything"*.

---

## 3. Wiring up — `provideLayoutResolver` in `app.config.ts`

The minimal-but-real shape adopters write:

```ts
import {
  provideLayoutResolver,
  provideAgentContext,
  provideLayoutTiers,
  provideLayoutAudit,
  STANDARD_LAYOUT_TIERS,
} from '@infra-tools/agentic-ui';

provideLayoutResolver({
  // Routes — baseline layouts that fire on URL match.
  routeRules: [
    {
      pattern: '/workspace',
      slots: {
        primary: { component: 'documentPreview', size: { default: '70%' } },
        sidebar: { component: 'tagPanel', size: { default: '30%' } },
      },
      reason: 'route /workspace — two-pane baseline',
    },
    {
      pattern: '/documents/*',
      slots: { primary: { component: 'documentPreview' } },
      reason: 'route /documents/:id — preview',
    },
  ],

  // Persona — pin slots a specific role always wants.
  personaRules: [
    {
      personaId: 'lead-counsel',
      slots: { footer: { component: 'chainOfCustody' } },
      reason: 'persona lead-counsel — chain-of-custody pin',
    },
  ],

  // Selection — fire when SelectionStore.selection() matches.
  selectionRules: [
    {
      kind: 'document',
      minCount: 1,
      maxCount: 1,
      slots: {
        primary: { component: 'documentPreview', size: { default: '55%' } },
        sidebar: { component: 'tagPanel',        size: { default: '25%' } },
        footer:  { component: 'chainOfCustody',  size: { default: '20%' } },
      },
      reason: 'selection — single document focus',
    },
    {
      kind: 'document',
      minCount: 2,
      slots: {
        primary: { component: 'multiDocPreview' },
        sidebar: { component: 'bulkActions' },
      },
      evictSlots: ['footer'],
      reason: 'selection — multi-document bulk mode',
    },
  ],

  // Adopter-supplied signals.
  activePersona: () => inject(PersonaService).active,
  agentSlots:    () => inject(WorkspaceLayoutStore).slots,
  userSavedKey:  () => computed(() => `workspace:${inject(PersonaService).active()}`),
});
```

Each layer is opt-in: omit `selectionRules` and the selection input doesn't register. The lib pays zero cost for unused layers.

---

## 4. The canonical demo flow — annotated

A reviewer (`lead-counsel`) on the eDiscovery shell, walking through 10 moments. **None require a chat prompt.**

### 4.1 — Lands on `/workspace`

```
[ documentPreview ]  [ tagPanel ]
                     [ chainOfCustody ]  (persona-pinned)
```

Resolution:
- Route `/workspace` contributes `primary` + `sidebar` at weight 400.
- Persona `lead-counsel` contributes `footer` at weight 200.
- No agent / user-saved / selection rules firing → resolver merges into 3 slots.

The breakdown disclosure under the canvas confirms: each slot tagged with `source` + `weight` + `reason`. **The user sees what's driving each slot.**

### 4.2 — Switches persona to `vendor-reviewer`

Persona signal changes → resolver recomputes. The persona footer pin no longer fires (no rule for vendor-reviewer). Workspace shrinks to 2 slots.

This is the *"persona density"* story made explicit: different roles see structurally different layouts from the same route.

### 4.3 — Navigates to `/documents`, clicks a single row

`documents.component.ts` row click handler:

```ts
openRow(id: string): void {
  this.openId.set(id);
  this.selectionStore.set({ kind: 'document', ids: [id] });
}
```

Selection signal changes → resolver recomputes. The `selection` layer's *single-doc focus* rule fires at weight 400 — same weight as route, but selection rules are appended after route in evaluation order, so selection wins on ties.

Result: workspace pivots to **preview + tag + chain** without a chat round-trip.

### 4.4 — Multi-selects 3 documents via checkboxes

`syncSelectionToResolver()` runs on every toggle. Selection becomes `{ kind: 'document', ids: ['doc-1', 'doc-2', 'doc-3'] }`. The *multi-doc bulk mode* rule fires (minCount 2). It includes `evictSlots: ['footer']` so the chain-of-custody footer goes away — it doesn't make sense for bulk operations.

Result: workspace becomes `multiDocPreview` + `bulkActions`.

### 4.5 — Asks the chat: *"add a chain-of-custody footer"*

Agent sees its per-turn context block:

```xml
<context>
  <route>/documents</route>
  <persona>lead-counsel</persona>
  <selection kind="document" count="3"> ... </selection>
  <current-layout>
    <slot name="primary" source="selection" reason="multi-document bulk mode" />
    <slot name="sidebar" source="selection" reason="multi-document bulk mode" />
  </current-layout>
  <override-stack>
    <slot name="primary" source="selection" weight="400" reason="..." />
    <slot name="sidebar" source="selection" weight="400" reason="..." />
  </override-stack>
  <available-templates>
    <template kind="layout" name="privilege-review-v3" tags="privilege,review" approval="approved">...</template>
    ...
  </available-templates>
  <matter id="acme-2024-acquisition" phase="review" />
  <recent-tool-calls>
    <call timestamp="..." tool="tagDocuments" outcome="ok" />
    ...
  </recent-tool-calls>
</context>
```

The agent picks `addLayoutSlot` — NOT `setWorkspaceLayout`. Why: the context's `<override-stack>` shows the user has slot-level state from selection; re-emitting the whole map would clobber it. The slot-edit tool layers on top:

```ts
addLayoutSlot({ slot: 'footer', component: 'chainOfCustody' })
```

`WorkspaceLayoutStore.set()` writes the updated SlotMap (existing + new footer). Agent layer fires at weight 1000 → overrides everything. Footer appears; primary/sidebar untouched.

### 4.6 — Clicks "📌 Save as my preference"

```ts
savePreference(): void {
  const slots = this.resolver.active().slots;
  const key = `workspace:${this.persona.active()}`;
  await this.layered.writeToTier('user-saved', key, {
    schemaVersion: 1,
    slots,
  });
}
```

Writes through `LayeredLayoutStore` → `PersistenceRegistry.get('user-store')` → in-demo memory adapter (production: HTTP adapter to a backend). Button flashes "✓ Saved".

`UserSavedLayoutInput`'s effect notices the key signal didn't change but the underlying tier has new data. On next page load (reload, persona switch, or explicit invalidate) it reads the user-saved entry, populates `_slots`, the resolver recomputes — and now the user-saved layer (weight 800) drives the layout, beating route + persona + matter-default.

### 4.7 — Lead-counsel changes matter phase to `production`

```ts
matterStore.setPhase('production');
```

Audit chain captures `matter.phase.changed` event. The `<matter phase="production">` fragment in the agent's next-turn context now reads `production`. Adopter-supplied `MatterPhaseLayoutInput` (one of the optional layers) re-fires with production-specific rules — production-throughput tile becomes prominent; review-specific tiles fade.

This is the "matter lifecycle drives the canvas" story. Without phase wired, no layout shift; with phase wired, the workspace becomes phase-aware.

### 4.8 — Navigates to `/audit/layouts`

Every resolved-layout change since boot is in the chain:

```
#1  09:01:02  route → 2 slots   prevHash: null         chainHash: 0x4f2a
#2  09:01:18  +persona footer    prevHash: 0x4f2a       chainHash: 0x9b1c
#3  09:14:55  selection (1 doc)  prevHash: 0x9b1c       chainHash: 0x6e0d
#4  09:18:31  selection (3 docs) prevHash: 0x6e0d       chainHash: 0xa317
#5  09:21:02  agent +footer      prevHash: 0xa317       chainHash: 0xb02e
#6  09:21:14  user-saved active  prevHash: 0xb02e       chainHash: 0xc4f1
#7  09:34:00  matter→production  prevHash: 0xc4f1       chainHash: 0xd552
```

Pastes `09:14:55` into the snapshot scrubber → sees the exact slot map that was active when the reviewer made her single-doc privilege call. **Compliance-defensible**: "show me what Sarah saw at this exact moment" is now a real query.

### 4.9 — Resets back to defaults

Reset menu:
- "Reset to my saved" → clears agent layer; user-saved still wins.
- "Reset to matter default" → clears agent + user-saved.
- "Reset to org default" → clears agent + user-saved + matter-default.
- "Reset to lib default" → clears everything; falls back to route/persona/hardcoded.

Each option is a discrete `LayeredLayoutStore.removeFromTier()` call. The resolver re-derives on next signal cycle.

### 4.10 — Applies an approved template via the picker

`/dashboards` shows the **Approved dashboard templates** section. Clicks **"✨ Apply"** on *Matter health snapshot*:

```ts
applyTemplate(name: string): void {
  const template = this.templateRegistry.get(name);
  const def: DashboardDef = { ...template.body, source: 'user' };
  this.registry.register(def);
  this.selected.set(def.name);
}
```

Materializes the template into `DashboardRegistry`, selects it. Could also be agent-driven via `applyDashboardTemplate` tool — same code path under the hood.

---

## 5. The agent integration story

The agent isn't omniscient. The lib gives it three things per turn:

1. **An XML context block** describing the live UI state (route, persona, selection, current-layout, override-stack, available-templates, recent-tool-calls, matter).
2. **Slot-level tools** (`addLayoutSlot` / `removeLayoutSlot` / `replaceLayoutSlot`) so it can intervene without clobbering user state.
3. **Template-aware tools** (`listLayoutTemplates` / `applyLayoutTemplate` / `listDashboardTemplates` / `applyDashboardTemplate`) so it can recommend by name.

With this stack, prompts like *"add a chain-of-custody footer"* route through `addLayoutSlot` instead of `setWorkspaceLayout`. The agent reads `<override-stack>`, sees primary/sidebar are user-driven, and preserves them. The user's intent is augmented, not overwritten.

---

## 6. Adopter checklist

To wire ADR-046 + ADR-047 into your own app, you need to:

| Item | Why | Effort |
|---|---|---|
| Register `provideLayoutResolver({...})` | The engine itself | 1 file change |
| Register `provideAgentContext({...})` | Agent gets context block | 1 line if defaults work |
| Implement / register your slot widgets (`documentPreview`, etc.) | The resolver references them by name | 1 widget per slot type |
| Wire `selectionStore.set()` on row-click sites | Triggers selection rules | 2-3 lines per page |
| Wire `selectionStore.clear()` on `NavigationEnd` | Selection doesn't bleed across routes | 1 hook at the app root |
| Register `provideLayoutTiers([...])` | If you want server-backed user-saved / matter-default / org-default tiers | 1 file change + adapters |
| Register `provideLayoutAudit({...})` | If you want the chain integration | 1 file change |
| Seed `LayoutTemplate` / `DashboardTemplate` entries | If you want the catalog populated | 1 file with seed data |
| Build the admin UI for approval workflow | If you want non-admins to promote templates | A small new page |

For the eDiscovery flagship: every line above is implemented. See `examples/demo-ediscovery-shell/src/app/app.config.ts`, `services/matter.store.ts`, `pages/documents/documents.component.ts`, `pages/workspace/workspace-demo.component.ts`, `pages/audit-layouts/audit-layouts.component.ts`, and `agentic/coordination.tools.ts`.

---

## 7. Pitfalls to avoid

**Don't use kpiTile for every slot.** It's the lib's universal stub. Real widgets — `documentPreview`, `tagPanel`, `chainOfCustody` — are what make the precedence story legible. If every slot looks identical, adopters can't see WHY the resolver picked what it did.

**Don't wrap the workspace banner in `@if (attribution())`.** The audit chain takes a moment to capture the first event after boot. Banner-on-attribution-only renders empty on first paint. Always render the banner; show fallback text when attribution is null.

**Don't call `provideLayoutAudit({ eager: false })` and expect the chain to populate on first navigation.** The tracker only starts watching when its constructor runs. Use `ENVIRONMENT_INITIALIZER` (the default) so boot-time instantiation captures the very first resolved layout.

**Don't omit `provideLayoutTiers`.** Without it, `LayeredLayoutStore` has no tiers to look up — every read returns null. Save preference appears to work but never feeds back to the resolver.

**Don't bind every context contributor.** Each adds ~0.5-2 KB to the per-turn HTTP body. The defaults (route + persona + layout-state + selection + available-templates + override-stack) are enough for ~95% of cases. Add `includeRecentToolCalls` + `includeMatter` only when your agent's reasoning actually benefits from them.

---

## 8. Where to go next

- **[ADR-046](../adr/0046-layered-layout-engine.md)** — the architectural rationale + decisions D1–D7
- **[ADR-047](../adr/0047-agentic-ui-coordination-layer.md)** — the coordination layer + D1–D8
- **[post-chat-surfaces-tour.md](./post-chat-surfaces-tour.md)** — the pre-ADR-046 surface tour (§17–22) showing what came before
- **`examples/demo-ediscovery-shell/`** — the canonical reference implementation
- **`projects/agentic-ui/src/lib/layout/`** — the lib's layout subsystem source

---

**Last updated:** 2026-05-16 · **Reflects:** lib ~720 KB, demo at commit on `main` post-ADR-047 ship.
