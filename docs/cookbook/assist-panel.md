# Cursor-pattern agent assist panel with `<mvk-assist-panel>`

> **Status:** ships in v1.2.x (P1.5 of [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md)) · **Pattern:** §3 Pillar 1 row 6 (the highest-leverage P1 component) · **Shell mode:** [`mvk-chat-shell mode="assist-panel"`](./agent-directed-workspace-layouts.md)

The chat rail is a *conversation* surface. The assist panel is a **structured-affordance** surface — the layout that has won in code editors (Cursor, Copilot) and is starting to win in legal, medical, and financial workbenches. The page is split: left ~65% is the work surface (form, document, table, canvas); right ~35% is the agent — *not a chat, but a structured panel showing context + next-actions + an Ask input at the bottom*.

`<mvk-assist-panel>` is the component that fills that right pane. It pairs with the `assist-panel` shell mode from [ADR-043](../adr/0043-layout-registry-promotion.md) D2 — apps wire `provideLayoutPolicy({shellMode: r => 'assist-panel' if reviewerRoute})` and render this component where the chat rail would have been.

## 1. Four affordances, one panel

```html
<mvk-assist-panel
  [context]="'Editing custodian ' + custodian().name"
  [intents]="['runHoldAck', 'openInReview', 'showCommsTimeline']"
  [filterContext]="custodian()"
  [filter]="custodianFilter"
  [focusedItem]="focusedField()"
  focusLabel="this field"
  (intentSelected)="onAction($event)"
  (explain)="onExplain($event)"
  (ask)="onAsk($event)" />
```

What you get:

| Affordance | Source | When it shows |
|---|---|---|
| **Context summary** | `[context]` string | Always when non-empty |
| **Suggested next-actions** | `[intents]` resolved via `IntentRegistry.get()` (persona-scoped) AND `[filter]` predicate against `[filterContext]` | When ≥ 1 intent passes both filters |
| **"Explain {focusLabel}"** | `[focusedItem]` payload | When `focusedItem` is not `undefined` / `null` |
| **Ask input** | bottom of the panel | Always (the host wires `(ask)` to the chat or wherever) |

## 2. Wire the dispatch handler

Same dispatch-agnostic pattern as every other P1 surface — `(intentSelected)` emits a typed `AssistAction` with `mapsTo.kind`, and the host switches:

```ts
import type { AssistAction } from '@infra-tools/agentic-ui';

onAction(a: AssistAction): void {
  switch (a.mapsTo.kind) {
    case 'route':  this.router.navigateByUrl(a.mapsTo.target); return;
    case 'action': this.actions.dispatch({ name: a.mapsTo.target, payload: this.custodian() }); return;
    case 'tool':   this.chat.sendMessage(`${a.intentId} for custodian ${this.custodian().id}`); return;
  }
}

onExplain(item: unknown): void {
  // Build a prompt the agent can answer with the focused payload as context.
  const field = item as { name: string };
  this.chat.sendMessage(`Explain the ${field.name} field on this custodian intake form.`);
}

onAsk(text: string): void {
  // Send the free-form question through the same chat the rail uses.
  this.chat.sendMessage(text);
}
```

## 3. The persona-aware filter chain (same shape as P1.3 / P1.4)

For each name in `[intents]`:

1. **Allow-list** — only names listed here are considered.
2. **Persona scope** — `IntentRegistry.get()` returns undefined when `setScopePolicy` denies; junior reviewer's `releaseHold` is filtered automatically.
3. **Context predicate** — `[filter]=(intent, context) => boolean` against the host-supplied `[filterContext]`. Hide intents that don't apply for the current view.

All three are AND-ed. Re-evaluates when intents / filter / filterContext / scope-policy change.

## 4. Layout density flows through `LAYOUT_POLICY`

The panel reads `LAYOUT_POLICY.density()` ([ADR-043 D4](../adr/0043-layout-registry-promotion.md#d4--setlayoutpolicypersona-on-registrybase-parallel-to-setscopepolicy)) and adapts internal padding + font size:

| Density | Internal padding | Use case |
|---|---|---|
| `comfortable` *(default)* | 1rem · gap 1rem · 0.9rem font | Generalist persona, ample real estate |
| `compact` | 0.7rem · 0.85rem font | Mid-density — partner with several panels open |
| `dense` | 0.5rem · 0.8rem font | Power-user — partner doing QC, keyboard-first |

The panel's host element gets `data-density="..."` so stylesheets can target it for theme overrides (`mvk-assist-panel .panel[data-density="dense"] { ... }`).

Wire density via the same `provideLayoutPolicy({...})` that drives shell mode:

```ts
provideLayoutPolicy({
  resolvePersona: () => persona(),
  byPersona: {
    paralegal: { density: () => 'comfortable', shellMode: () => 'rail' },
    partner:   { density: () => 'compact',     shellMode: r => isProfile(r) ? 'assist-panel' : 'rail' },
    reviewer:  { density: () => 'dense',       shellMode: r => isDoc(r) ? 'pill' : 'rail' },
  },
});
```

## 5. Pair with `<mvk-chat-shell mode="assist-panel">`

The cleanest integration is to drop the assist panel where the chat rail used to be:

```html
<!-- app-shell.component.ts -->
<main class="three-pane">
  <nav class="left">…</nav>
  <section class="content"><router-outlet /></section>
  <aside class="right">
    @switch (chatMode()) {
      @case ('assist-panel') {
        <mvk-assist-panel ...inputs />
      }
      @case ('rail') {
        <mvk-chat-shell mode="rail" />
      }
      @case ('pill') {
        <mvk-chat-shell mode="pill" />
      }
      @default {
        <mvk-chat-shell [mode]="chatMode()" />
      }
    }
  </aside>
</main>
```

The panel and the chat rail are **not** mutually exclusive in principle — apps can render both if they want — but the `assist-panel` shell mode exists for the simple case of "swap rail for panel on this persona/route".

## 6. The architectural property

The assist panel is the **most concentrated** application of the post-chat-surfaces premise:

- Same `IntentRegistry` as the cmd-k palette, row menu, bulk toolbar.
- Same persona scope via `setScopePolicy` — junior reviewer's panel suggests three things; partner's panel suggests seven.
- Same dispatch-agnostic `(selected)` semantics — host decides whether each action is a route, action, or chat prompt.
- Same `LAYOUT_POLICY` for density — one provider drives shell mode + panel verbosity.

Per the [post-chat-surfaces plan §3 pattern 6](../plans/post-chat-surfaces-plan.md#pillar-1--web-surface-patterns-post-chat-affordances), this is *"probably the highest-leverage single addition to the demo. It makes the agent feel present everywhere without the user having to type."*

## 7. Reference

- **Component:** `<mvk-assist-panel [context] [intents] [filterContext] [filter] [focusedItem] [focusLabel] [askPlaceholder] (intentSelected) (explain) (ask) />`
- **Types:** `AssistAction`, `AssistIntentFilter`
- **Tests:** 18 specs covering context render + hide, intent resolution + persona scope + context filter + empty state + kind badges + click dispatch, explain hide/show/emit, ask input disabled/emit/clear/custom placeholder, density default + compact + dense via `LAYOUT_POLICY`
- **Plan:** [post-chat-surfaces-plan §3 Pillar 1 pattern 6](../plans/post-chat-surfaces-plan.md#pillar-1--web-surface-patterns-post-chat-affordances)
- **Related:**
  - [Agent-directed workspace layouts (ADR-043)](./agent-directed-workspace-layouts.md) — the shell mode + `LAYOUT_POLICY` machinery
  - [⌘K / Ctrl+K palette](./cmd-k-palette.md) — app-wide summon
  - [`<mvk-row-action-menu>`](./row-action-menu.md), [`<mvk-bulk-toolbar>`](./bulk-toolbar.md), [`<mvk-smart-cell>`](./smart-cell.md) — the other three P1 surfaces
