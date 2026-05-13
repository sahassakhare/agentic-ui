# Playbooks — versioned tool-call sequences

> **Status:** ships in v1.2.x (P5 of [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md)) · **Workflow:** G — Cross-matter playbooks

A **playbook** is a named, versioned, persona-scoped sequence of tool calls that legal ops applies across matters — *"Initial Privilege Pass v3"*, *"Pre-production QC v2"*, *"Acquisition due diligence v1"*. Each step is a tool the catalog already knows about; the playbook just records the order + the args.

Playbooks ship as the 18th registry. Same federation symmetry, same persona scope, same audit chain as every other registry. The runtime separation mirrors `TriggerRegistry` ↔ `provideTriggerRunner` from ADR-045:

- **`PlaybookRegistry`** stores definitions + the version chain.
- **`PlaybookRunner`** service fires them step-by-step.
- **`<mvk-playbook-runner>`** component renders the live snapshot.

## 1. Register a playbook

```ts
import { inject } from '@angular/core';
import { PlaybookRegistry } from '@infra-tools/agentic-ui';

inject(PlaybookRegistry).register({
  name: 'initial-privilege-pass',
  title: 'Initial Privilege Pass',
  description: 'Seed → train → review → re-train. Standard kickoff for any new matter.',
  version: 'v3',
  parentVersion: 'v2',
  scopes: ['paralegal', 'partner', 'gc'],   // persona scope honoured by setScopePolicy
  owner: 'legal-ops',
  lifecycle: 'published',
  steps: [
    {
      id: 'scope',
      title: 'Define collection scope',
      tool: 'defineCollectionScope',
      args: { matterId: 'M-117' },
    },
    {
      id: 'seed',
      title: 'Tag 20 seed documents',
      tool: 'autoSeedReview',
      args: { matterId: 'M-117', count: 20 },
    },
    {
      id: 'train',
      title: 'Train classifier',
      tool: 'runTARClassifier',
      args: { matterId: 'M-117', mode: 'initial' },
    },
    {
      id: 'review-pass',
      title: 'First review pass (CAL round 1)',
      tool: 'startCalRound',
      args: { matterId: 'M-117', round: 1 },
      // requiresApproval surfaces an Approve / Skip gate before this step
      // runs — used for irreversible or expensive operations.
      requiresApproval: true,
    },
    {
      id: 'snapshot',
      title: 'Persist round-1 model snapshot',
      tool: 'persistModelSnapshot',
      args: { matterId: 'M-117', round: 1 },
      // continueOnError = the run keeps going even if this fails,
      // capturing the failure but not aborting.
      continueOnError: true,
    },
  ],
});
```

## 2. Fire it

```ts
@Component({
  selector: 'app-playbook-page',
  imports: [PlaybookRunnerComponent],
  template: `
    <mvk-playbook-runner
      [run]="run()"
      [stepTitles]="stepTitles"
      (action)="onAction($event)" />
  `,
})
class PlaybookPage {
  private readonly registry = inject(PlaybookRegistry);
  private readonly runner = inject(PlaybookRunner);
  private handle = this.runner.start(this.registry.get('initial-privilege-pass')!);

  // Bind the live state signal to the runner component.
  readonly run = this.handle.state;

  readonly stepTitles = {
    scope: 'Scope custodians + sources',
    seed: 'Tag 20 seed docs',
    train: 'Train classifier',
    'review-pass': 'Review pass — CAL round 1',
    snapshot: 'Persist round-1 model',
  };

  onAction(ev: PlaybookRunnerAction): void {
    switch (ev.action) {
      case 'cancel':  this.handle.cancel(); return;
      case 'approve': this.handle.approve(); return;
      case 'skip':    this.handle.skip(); return;
    }
  }
}
```

The runner walks the steps in order, capturing `result` per step, `error` on failure, and timestamps. Step status transitions:

```
pending → (awaiting-approval) → running → success / failed / skipped
                                                    ↓
                                                cancelled  (downstream of cancel)
```

Steps with `requiresApproval: true` pause as `awaiting-approval` until the host calls `handle.approve()` or `handle.skip()`. Steps with `continueOnError: true` let the playbook continue past their failure; otherwise a failure marks all remaining steps as `cancelled` and the overall run as `failed`.

## 3. The defensibility property

Every step's tool call **goes through the same `ToolRegistry.handler` path** the chat shell uses, so every fire chain-hashes through the audit ledger with `origin: 'playbook'`. The telemetry sink captures:

- `agentic.playbook.name` — which playbook
- `agentic.playbook.version` — exact version
- `agentic.playbook.step.id` + `.step.index` — which step

That means *"Run the same playbook on three different matters"* produces three independent chain-hashed runs, each fully reconstructable. Opposing counsel can replay any one.

Persona scope flows automatically — when a paralegal tries to run a step whose tool requires partner scope, the runner records the step as `failed` with *"Tool not visible to this persona"* and (unless `continueOnError`) aborts. Same `setScopePolicy` invariant as the chat shell's tool list.

## 4. Cross-matter is mostly free

A single playbook applies across matters by parameterising step args:

```ts
const baseDef = inject(PlaybookRegistry).get('initial-privilege-pass')!;
const matterIds = ['M-117', 'M-118', 'M-119'];

for (const matterId of matterIds) {
  const matterSpecific: PlaybookDef = {
    ...baseDef,
    name: `${baseDef.name}-${matterId}`,
    steps: baseDef.steps.map((s) => ({ ...s, args: { ...s.args, matterId } })),
  };
  this.runner.start(matterSpecific);
}
```

The original `PlaybookDef` stays untouched in the registry. Each per-matter handle runs independently — three matters, three audit-chained runs.

If the playbook only needs **one** parameter swapped (the `matterId`), the more elegant pattern is to set the playbook's `args` with no `matterId` and pass it via a [`DashboardDef.filters`](./dashboards.md)-style cross-matter filter — but this is host-side glue.

## 5. The Workflow G property — playbooks meet dashboards

Per ADR-044, a dashboard tile can drill into a playbook via `tile.drilldown.tool` referring to the playbook-starting tool. Per ADR-045, a trigger can fire a playbook (`target: { kind: 'action', action: 'run-playbook', payload: { name: 'initial-privilege-pass' } }`). Hosts wire these compositions; the lib supplies the registries.

The full Workflow G shape:

```
TriggerRegistry.cron fires at 09:00 UTC
  → action 'run-playbook' dispatched
    → PlaybookRegistry.get('weekly-privilege-sweep')
      → PlaybookRunner.start()
        → 5 tool calls, each chain-hashed
          → DashboardRegistry tile counts update on next refresh
            → mvk-dashboard-canvas re-renders
              → user clicks the tile drilldown
                → /playbooks/weekly-privilege-sweep
                  → mvk-playbook-runner renders the last run's snapshot
```

Eight registries participate in one workflow. **No bespoke orchestration code** anywhere — just registry entries.

## 6. What this slice does NOT do

- **Conditional branching.** Steps are sequential; the runner doesn't support `if-then-else` between steps. Hosts that need that wire two playbooks + a dispatcher tool that picks one.
- **Loops / parallel fan-out.** Steps fire sequentially. For parallel work, register a single step whose tool internally fans out + awaits.
- **Visual builder.** P5 ships the registry + runner; a drag-drop playbook-builder UI is its own slice (probably a follow-up to P3.B's `mvk-dashboard-preview` pattern).
- **Cross-tenant execution.** A playbook runs in the tenant of the caller; the catalog's tenant-isolation rules apply on every step.

## 7. Reference

- **Registry:** `PlaybookRegistry` (18th registry; standard `register / list / signal / removeBySource / setScopePolicy`)
- **Service:** `PlaybookRunner` (`providedIn: 'root'`) with `.start(def): RunningPlaybook`
- **Runtime handle:** `RunningPlaybook` with `state: Signal<PlaybookRun>`, `done: Promise<PlaybookRun>`, `cancel()` / `approve()` / `skip()` methods
- **Component:** `<mvk-playbook-runner [run] [stepTitles] (action) />`
- **Types:** `PlaybookDef`, `PlaybookStep`, `PlaybookStepStatus`, `PlaybookStepState`, `PlaybookRunStatus`, `PlaybookRun`, `PlaybookRunnerAction`
- **Tests:** 4 registry specs + 9 runner-service specs (happy path, failure with/without continueOnError, persona-blocked, approval flow approve/skip, cancellation pre-run + at approval gate) + 11 component specs (empty + rendering, title/version/pill, step rows + status data attr, stepTitles override, Cancel surfaces during running, Cancel emit, Approve/Skip surface on awaiting-approval + emit, error rendering, Result disclosure, host-data-status attribute)
- **Plan:** [post-chat-surfaces-plan §3 Pillar 3 + §4 Workflow G](../plans/post-chat-surfaces-plan.md#4-complex-workflows-worth-modelling)
- **Related:**
  - [User-built dashboards (P3.A)](./dashboards.md) — dashboards can drill into playbooks
  - [Proactive triggers + Inbox](./proactive-triggers-and-inbox.md) — triggers can fire playbooks via the `'action'` target kind
  - [CAL workbench (P4.B)](./cal-workbench.md) — typical playbook step orchestrates a CAL round
