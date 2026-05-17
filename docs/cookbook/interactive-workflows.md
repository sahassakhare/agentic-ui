# Interactive workflows (Capability F3 — provisional)

A multi-step wizard where the agent (or the user) walks through a
sequence of step widgets, with conditional transitions, Back navigation
that preserves prior values, and a single terminal handler that runs
the same domain logic as the equivalent one-shot tool. Capability F3
of the [r3 dynamic-UI plan](../plans/ediscovery-dynamic-ui-plan.md#93-capability-f3--interactive-workflow-wizard---provisional-registry).

> **Provisional design.** Per r3 plan §9.3.3, F3 ships as
> `FormDef.workflow` carried through `FormRegistry`. Promotion to a
> top-level `WorkflowRegistry` is an ARB decision at F3 exit. The
> `agenticWorkflow({...})` call shape stays stable across either path,
> so any refactor later is mechanical.

> Builds on [Composable intake form](./composable-intake-form.md). The
> `CompositionStore` + `COMPOSITION_SLOT` contract is the same — F3
> mounts ONE step's widget at a time instead of all sections at once.

## Workflow vs composition vs schema form

|   | Schema form | Composition form | Workflow |
|---|---|---|---|
| Renderer | `<mvk-form-renderer>` | `<mvk-form-renderer>` | `<mvk-workflow-renderer>` |
| Layout | One section, all fields visible | Multiple sections, all visible, predicates toggle | One step at a time, Back / Next controls |
| State carrier | Renderer-local `signal()` | `CompositionStore` keyed by widget name | `CompositionStore` keyed by step id |
| Terminal handler | `submit(values)` | `submit(snapshot)` | `workflow.onComplete(snapshot, ctx)` |
| Branching | None | Per-section `if` / `predicate` | Per-step `next: string \| null \| (state) => string \| null` |
| Audience | Static fields | Agent-driven section assembly | Guided multi-step flows |

A workflow is the right shape when:
- The user benefits from a step-by-step flow rather than seeing all inputs at once.
- Step order matters and one step's output reasonably feeds the next.
- The flow may branch on intermediate state (e.g., zero custodians selected → show a setup-redirect step instead of advancing).

## What you'll build

A `placeLegalHold` wizard with five steps:

| # | Step id | Widget | `next` |
|---|---|---|---|
| 1 | `scope`        | keyword chip picker         | unconditional → `'custodians'` |
| 2 | `custodians`   | matter-custodian multi-select | conditional: `ids.length === 0 ? 'matter-setup' : 'date-range'` |
| 3 | `date-range`   | from / to date picker (optional) | unconditional → `'preview'` |
| 4 | `preview`      | read-only summary of all prior steps | terminal (`null`) — Submit runs `onComplete` |
| 5 | `matter-setup` | redirect placeholder (only reached on the AC-F3-2 branch) | terminal (`null`) |

The full working version ships in the eDiscovery flagship —
[`examples/demo-ediscovery-shell`](../../examples/demo-ediscovery-shell/src/app/agentic).

## Step 1 — register step widgets

Same contract as F1 section widgets: each step component injects
`COMPOSITION_SLOT` (the renderer provides this set to the step id) and
reads / writes its value through `CompositionStore`. State persists
across step transitions and Back navigation because it lives in the
store, not the component.

```ts
import { Component, computed, inject, signal } from '@angular/core';
import { COMPOSITION_SLOT, CompositionStore } from '@infra-tools/agentic-ui';

@Component({
  selector: 'app-place-hold-keywords',
  imports: [FormsModule],
  template: `
    <div class="chips">
      @for (kw of keywords(); track kw) {
        <span class="chip">{{ kw }}<button (click)="remove(kw)">×</button></span>
      }
    </div>
    <input type="text" [ngModel]="draft()" (ngModelChange)="draft.set($event)"
           (keydown.enter)="commit($event)" placeholder="Press Enter" />
  `,
})
export class PlaceHoldKeywordsComponent {
  private readonly slot = inject(COMPOSITION_SLOT, { optional: true });
  private readonly store = inject(CompositionStore, { optional: true });
  protected readonly draft = signal('');
  protected readonly keywords = computed<readonly string[]>(() => {
    if (!this.store || !this.slot) return [];
    const v = this.store.values()[this.slot];
    return Array.isArray(v) ? (v as readonly string[]) : [];
  });

  protected commit(event: Event): void {
    event.preventDefault();
    const raw = this.draft().trim();
    if (!raw || !this.store || !this.slot) return;
    const cur = this.keywords();
    if (cur.includes(raw)) return this.draft.set('');
    this.store.write(this.slot, [...cur, raw]);
    this.draft.set('');
  }

  protected remove(kw: string): void {
    if (!this.store || !this.slot) return;
    this.store.write(this.slot, this.keywords().filter((k) => k !== kw));
  }
}
```

Register it on the host's `ComponentRegistry` like any widget:

```ts
agenticWidget({
  name: 'place-hold-keywords',
  component: PlaceHoldKeywordsComponent,
  propsSchema: z.object({}),
});
```

The preview step is a great example of one widget reading **other**
slots' values. It injects only `CompositionStore` (no slot), and reads
`store.values()['scope']`, `store.values()['custodians']`,
`store.values()['date-range']` — all populated by prior steps.

## Step 2 — declare the workflow

```ts
import { agenticWorkflow, FormRegistry, type FormDef } from '@infra-tools/agentic-ui';

env.get(FormRegistry).register(
  agenticWorkflow({
    name: 'placeLegalHold',
    description: 'Guided wizard to draft, scope, and send a legal hold notice.',
    steps: [
      { id: 'scope',        widget: 'place-hold-keywords',     section: 'Scope',       next: 'custodians' },
      {
        id: 'custodians',
        widget: 'place-hold-custodians',
        section: 'Custodians',
        next: (state) => {
          const ids = (state['custodians'] as readonly string[] | undefined) ?? [];
          return ids.length === 0 ? 'matter-setup' : 'date-range';
        },
      },
      { id: 'date-range',   widget: 'place-hold-dates',        section: 'Date range',  next: 'preview' },
      { id: 'preview',      widget: 'place-hold-preview',      section: 'Preview',     next: null },
      { id: 'matter-setup', widget: 'place-hold-matter-setup', section: 'Setup',       next: null },
    ],
    onComplete: async (state) => {
      // The renderer hands you a Record<stepId, slotValue> snapshot.
      const keywords = (state['scope'] as readonly string[]) ?? [];
      const custodianIds = (state['custodians'] as readonly string[]) ?? [];
      const range = (state['date-range'] as { from?: string; to?: string }) ?? {};
      // ... call your domain handler (e.g., MatterStore.addLegalHold)
    },
  }) as FormDef,
);
```

The factory validates at registration:

- non-empty `steps` array,
- unique step ids,
- string `next` targets resolve to a real step,
- step ids and widget names look like identifiers.

Function `next` targets are dynamic — the renderer validates their
return value at transition time and shows an inline error if the
result is an unknown step id, without advancing.

## Step 3 — surface via a tool

Same pattern as F1's `openCustodianIntake`. A small generative-UI
wrapper mounts `<mvk-workflow-renderer>`; a tool returns it.

```ts
@Component({
  selector: 'app-place-legal-hold-card',
  imports: [WorkflowRendererComponent],
  template: `
    <article class="card">
      <header><strong>Place legal hold</strong></header>
      <mvk-workflow-renderer formName="placeLegalHold" />
    </article>
  `,
})
export class PlaceLegalHoldCardComponent {}

agenticWidget({
  name: 'placeLegalHoldCard',
  component: PlaceLegalHoldCardComponent,
  propsSchema: z.object({}),
});

agenticTool({
  name: 'openPlaceLegalHoldWorkflow',
  description: 'Open the guided wizard for placing a legal hold.',
  schema: z.object({}),
  handler: async () => ({
    components: [{ name: 'placeLegalHoldCard', props: {} }],
    markdown: 'Opening the place-legal-hold wizard.',
  }),
});
```

Now the user can ask *"open the place-hold wizard"* and the agent
emits the card. The renderer takes over from there — Back, Next, the
breadcrumb, the conditional transition, and `onComplete` on terminal
Submit.

## Conditional transitions in detail

`next` accepts three shapes:

```ts
// 1. Unconditional: advance to a named step.
next: 'date-range'

// 2. Terminal: clicking Next on this step runs onComplete.
next: null

// 3. Branching: examine the workflow's aggregated state and decide.
next: (state) => state['custodians'].length === 0
  ? 'matter-setup'
  : 'date-range'
```

The function signature receives `Readonly<Record<string, unknown>>` —
exactly the snapshot of `CompositionStore`. State keys mirror step ids
unless your widgets write to other slots.

If the branching function throws, the renderer surfaces the message
inline (`"Transition failed: ..."`) without advancing. If it returns
an unknown step id, the renderer surfaces `"Unknown next step 'X' from
'Y'"` — also without advancing. **The user is never silently sent to
nowhere.**

## Back navigation + state preservation

Every Next pushes the current step id onto a history stack. Back pops
it and restores the prior step. `CompositionStore` is unchanged across
either direction, so values entered on prior steps survive a Back +
re-edit cycle for free.

The `currentStep` computed re-evaluates whenever the step id signal
changes; the per-step injector (carrying `COMPOSITION_SLOT`) is cached
in a `Map<stepId, Injector>` so re-mounts don't churn.

## Submit flow

When the user clicks Next on a step whose `next` resolves to `null`,
the renderer:

1. Sets `submitting = true` and disables both controls.
2. Calls `workflow.onComplete(store.snapshot(), {})`.
3. On success: marks `completed = true`; the template swaps to a
   "Workflow X complete." panel.
4. On failure: surfaces the error in the inline error region; the
   step stays mounted so the user can retry or correct prior steps via
   Back. `completed` stays false.

`onComplete` is the **single domain handler**. In the eDiscovery
flagship the same `MatterStore.addLegalHold` runs whether the user
went through the one-shot `placeLegalHold` tool or the wizard — one
audit posture, two surfaces.

## Telemetry

Per r3 plan §11.5, the workflow renderer emits:

- `workflow.transition` (counter, value 1) on every Next / Back, tagged with `workflow`, `from`, `to`, `direction` (`'forward'` / `'back'`).
- `workflow.complete_ms` (histogram) on every terminal Submit, tagged with `workflow` + `ok` (`'true'` / `'false'`).

These plug into the same `AGENTIC_TELEMETRY_SINK` injection token as
the rest of the lib. Wire your OTEL exporter at the host and you get
per-step latency + success-rate metrics for free.

## Mounting outside the chat shell

Nothing requires the workflow to be agent-emitted. You can also mount
`<mvk-workflow-renderer formName="...">` directly in any route's
template — the renderer reads the form by name from `FormRegistry`
and operates the same way. Useful for "/legal-holds/new" landing
pages where the workflow IS the page.

## Debugging

- **Step never appears.** Check the widget name in the workflow's
  `steps[]` matches a `ComponentRegistry` registration. The renderer
  shows "Unknown widget: …" when the lookup misses.
- **Conditional `next` doesn't branch as expected.** Log the snapshot
  inside the function: `next: (state) => { console.log(state); return ... }`.
  Verify the keys you're reading match the step ids that were filled
  before the transition.
- **Back doesn't restore values.** Verify the step widget reads + writes
  via `CompositionStore`, not local component state. Components that use
  local `signal()` lose state on unmount; the store survives.
- **Submit failed but the wizard says "complete."** That shouldn't
  happen — `onComplete` errors trip the failure path which keeps
  `completed = false`. If you see "complete" after a failure, your
  `onComplete` resolved despite the error (caught it internally?).
  Re-throw to surface.
- **Form-switch leaks state.** When the input `formName` changes on a
  mounted renderer, the renderer auto-clears the store, history,
  pending prompts, keep-overrides, and cached step injectors. Slot keys
  mean different things in different workflows — they're always reset.

## Production patterns

- **Persona scope.** `WorkflowDef` is carried on `FormDef`, which goes
  through `FormRegistry`. `FormRegistry` honours `setScopePolicy`, so a
  workflow whose `RegistryEntry.scopes` doesn't include the active
  persona is invisible. Step widgets are looked up via
  `ComponentRegistry`, also scope-aware — the renderer surfaces an
  "Unknown widget" placeholder for an off-scope step, which is the
  intended audit trail.
- **Audit chain integration.** `onComplete` is a normal async
  function; call your audit-append primitive there. The renderer
  emits the `workflow.complete_ms` histogram regardless, so you have
  observability even when the audit append runs out-of-band.
- **Validation.** Composition skips `ValidationRegistry` because each
  widget validates its own props. Workflows do the same — apply
  cross-step validation inside `onComplete` before the persistence
  call. If validation fails, throw — the renderer surfaces the error
  and the user can use Back to fix.
- **Cancellation.** The renderer doesn't cancel `onComplete` if the
  user navigates away. If `onComplete` calls a long-running tool,
  prefer Capability F5 (LRO) for the durable-progress story.

## Future: AC-F3-4 (`ui-action workflow.transition`)

The plan §9.3.4 reserves a server-emitted `ui-action` event with
`op: 'workflow.transition'` so the agent can override a step
transition (e.g., "all custodians on existing hold — skip to
preview"). Not yet wired; lands in a follow-up slice with a paired
ADR on the security boundary (R-F3-B). When it ships, the renderer
will subscribe to `ActionRegistry` for that op and apply the
transition only if the target step exists in the current workflow.

## Related cookbook entries

- [Composable intake form](./composable-intake-form.md) — F1; the
  step-widget contract (`COMPOSITION_SLOT` + `CompositionStore`) is
  identical.
- [Widgets with live data](./widgets-with-live-data.md) — F2; step
  widgets often need autocomplete suggestions or precomputed options
  via `DataSourceRegistry`.
- [Production deployment](./production-deployment.md) — environment
  routing for the data sources behind step widgets.

## See also

- [Plan, Capability F3](../plans/ediscovery-dynamic-ui-plan.md#93-capability-f3--interactive-workflow-wizard---provisional-registry) —
  acceptance criteria, NFR targets, conformance approach, the §9.3.3
  promotion-decision criteria.
- [`agentic-workflow.ts`](../../projects/agentic-ui/src/lib/factories/agentic-workflow.ts) —
  factory + `AgenticWorkflowError`.
- [`workflow-renderer.component.ts`](../../projects/agentic-ui/src/lib/components/workflow-renderer.component.ts) —
  state machine + Back/Next + onComplete.
- The eDiscovery flagship's working `placeLegalHold` workflow:
  [`agentic.ts`](../../examples/demo-ediscovery-shell/src/app/agentic/agentic.ts) —
  search for `agenticWorkflow({` and `openPlaceLegalHoldWorkflowTool`.
- Step widgets:
  [`place-hold-steps.component.ts`](../../examples/demo-ediscovery-shell/src/app/agentic/place-hold-steps.component.ts).
