# Long-running operations (Capability F5)

The agent calls a tool that runs for minutes, the chat shows live
progress, the user navigates away and comes back to see the result —
all without blowing through SSE timeouts or losing state. Capability
F5 of the [r3 dynamic-UI plan](../plans/ediscovery-dynamic-ui-plan.md#95-capability-f5--long-running-operations-lro).

## Why this matters

> **The 30-second SSE problem.** Standard chat-shell event streams have
> short timeouts. A tool that takes 8–20 minutes (TAR classification,
> large production export, full-corpus indexing) cannot complete
> synchronously. Without first-class long-running primitives, you'd
> implement queueing, polling, and reconnection by hand for every
> tool that needs them. F5 standardises the pattern.

The shape: tools opt in via `longRunning: true`, return promptly with
an `opId`, and emit progress through `ToolContext.reportProgress`. The
chat shell renders an inline progress widget; a global
`OperationRegistry` retains state for cross-route navigation.

```mermaid
sequenceDiagram
    actor User
    participant Tool as runTARClassifier
    participant Reg as OperationRegistry
    participant Widget as &lt;mvk-operation-progress&gt;
    participant Audit as Audit chain

    User->>Tool: tool-call
    Tool->>Reg: ctx.startOperation({...})
    Reg-->>Audit: action='operation-started'
    Reg-->>Tool: opId
    Tool-->>User: returns {opId, components: [progress widget]}
    Note over Widget: chat renders inline progress card
    loop background loop
      Tool->>Reg: ctx.reportProgress(opId, {pct, phase})
      Reg-->>Audit: action='operation-progress'
      Reg-->>Widget: signal updates → reactive re-render
    end
    Tool->>Reg: ctx.completeOperation(opId, result)
    Reg-->>Audit: action='operation-finished'
    Reg-->>Widget: terminal-success render
```

## What you'll build

A `runTARClassifier` tool that:

- Returns immediately with an `opId` and a `mvk-operation-progress`
  widget reference.
- Streams progress over ~12 seconds, calling `reportProgress` per
  batch with `pct`, `phase`, and partial counts.
- Completes with a result payload the LLM can describe in its next
  turn.
- Respects `ctx.signal` — aborting the chat aborts the run.

Plus a `/operations` route listing in-flight + recently-completed
operations, and a sidebar nav badge showing active count.

## Step 1 — declare a long-running tool

```ts
import { agenticTool } from '@infra-tools/agentic-ui';
import { z } from 'zod';

agenticTool({
  name: 'runTARClassifier',
  description:
    'Run technology-assisted review classification on a portion of ' +
    "the matter's corpus. Returns immediately; progress streams " +
    'inline.',
  longRunning: true,
  schema: z.object({
    topic: z.string().min(1),
    onlyUntagged: z.boolean().optional().default(true),
  }),
  handler: async ({ topic, onlyUntagged }, ctx) => {
    const totalBatches = 8;
    const opId = ctx.startOperation({
      description: `TAR-classify "${topic}"`,
      estDurationMs: totalBatches * 1500,
    });

    let batch = 0;
    const counts = { responsive: 0, privileged: 0, hot: 0 };

    const tick = (): void => {
      if (ctx.signal.aborted) {
        ctx.failOperation(opId, { code: 'ABORTED', message: 'TAR run aborted.' });
        return;
      }
      batch++;
      counts.responsive += 60 + Math.floor(Math.random() * 40);
      // ...
      const pct = Math.round((batch / totalBatches) * 100);
      ctx.reportProgress(opId, {
        pct,
        phase: `scoring batch ${batch} / ${totalBatches}`,
        partialResult: { ...counts },
      });
      if (batch >= totalBatches) {
        ctx.completeOperation(opId, { topic, ...counts });
        return;
      }
      setTimeout(tick, 1500);
    };
    setTimeout(tick, 200);

    return {
      opId,
      topic,
      components: [{ name: 'mvk-operation-progress', props: { opId } }],
      markdown: `Started TAR classification for **${topic}**.`,
    };
  },
});
```

Three things matter:

1. **`longRunning: true`** is informational — for tooling, telemetry,
   the `/operations` page's classification, MCP descriptions. The
   chat shell does not require it; calling `ctx.startOperation` works
   without the flag. Setting it documents intent and lets surfaces
   show "may take time" affordances proactively.

2. **The handler returns promptly.** The chat shell sees a normal
   tool result containing `{opId, components: [...]}`. The background
   loop continues asynchronously after `return` because closures keep
   the `ctx` alive.

3. **`ctx.signal` is honoured.** When the user aborts the chat run
   (clicks Stop, navigates away, etc.), the signal fires. The loop
   checks it on every tick and calls `failOperation` with code
   `ABORTED`. Without this check, the background loop runs to
   completion regardless — the operation widget would update for an
   already-cancelled chat turn.

## Step 2 — register the progress widget

The chat-shell's `<mvk-widget-container>` resolves the synthetic
`{name: 'mvk-operation-progress', ...}` reference through
`ComponentRegistry`. Register the lib's built-in component under that
name:

```ts
import { OperationProgressComponent } from '@infra-tools/agentic-ui';

agenticWidget({
  name: 'mvk-operation-progress',
  component: OperationProgressComponent,
  propsSchema: z.object({ opId: z.string() }),
});
```

## Step 3 — wire the audit hook

By default, transitions update `OperationRegistry` only — no audit
record. To mirror them into your chain:

```ts
import {
  AGENTIC_OPERATION_AUDIT_HOOK,
  type OperationAuditEvent,
} from '@infra-tools/agentic-ui';

{
  provide: AGENTIC_OPERATION_AUDIT_HOOK,
  useFactory: () => {
    const persona = inject(PersonaService);
    return ({ operation, transition, previousStatus }: OperationAuditEvent) => {
      appendAudit({
        id: nextAuditId(),
        matterId: matter.matterId,
        actor: persona.active(),
        action: `operation-${transition}`,  // operation-started / -progress / -finished / -failed
        target: { type: 'operation', id: operation.opId },
        before: { status: previousStatus, pct: operation.pct ?? 0 },
        after: {
          status: operation.status,
          pct: operation.pct,
          phase: operation.phase,
          result: operation.result,
          error: operation.error,
          durationMs: operation.durationMs,
        },
        timestamp: isoNow(),
      });
    };
  },
},
```

Same fire-and-forget contract as F4's approval audit hook (ADR-009):
throwing the hook does NOT roll back the in-memory transition. The
chain's verb-agnostic hash chain means the new event kinds participate
in tamper detection automatically — no chain primitive changes.

**Progress events fire often.** A 12-second TAR run with one batch
per 1.5 seconds emits 8 progress events plus one started + one
finished = 10 audit rows. Chain-of-custody reports include the full
lifecycle. If the volume is too high for your audit pipeline, throttle
in the hook (e.g. only audit every Nth progress event, or only at
status changes) — but don't change the pct semantics.

## Step 4 — surface the operations panel

A `/operations` route reading `OperationRegistry.operations()` /
`active()` / status filters is the AC-F5-3 surface (closed browser →
return → see the result):

```ts
@Component({
  selector: 'app-operations',
  imports: [OperationProgressComponent],
  template: `
    @for (op of active(); track op.opId) {
      <mvk-operation-progress [opId]="op.opId" />
    }
  `,
})
export class OperationsComponent {
  private readonly operations = inject(OperationRegistry);
  protected readonly active = computed(() =>
    this.operations.active(),
  );
}
```

The same component (`<mvk-operation-progress>`) renders the
progress here as renders inline in the chat — one operation, one
component, two surfaces. The widget subscribes to the registry's
signal-backed map, so progress updates are reactive without polling.

## Step 5 — sidebar badge

Mirroring F4's approval badge:

```ts
{ path: '/operations', label: 'Operations', icon: 'bolt',
  badge: () => {
    const n = this.operationRegistry.active().length;
    return n > 0 ? n : null;
  },
}
```

The badge surfaces the moment a long-running tool starts — useful
when the user navigated away from the chat and a backlog of
operations is running.

## Lifecycle in detail

`OperationRegistry` is a state machine with four states:

| State | Trigger | Allowed transitions |
|---|---|---|
| `started` | `ctx.startOperation` | → `progress` (first reportProgress) → `finished` (complete) → `failed` (fail) |
| `progress` | `ctx.reportProgress` | stays in `progress` for subsequent calls; → `finished` / `failed` |
| `finished` | `ctx.completeOperation` | terminal; subsequent calls are no-ops |
| `failed` | `ctx.failOperation` | terminal; subsequent calls are no-ops |

Idempotency: once terminal, every subsequent registry call is a
silent no-op. This matters when:

- A background loop hasn't seen the cancellation yet and emits one
  more `reportProgress` after `failOperation` ran.
- Two abort signals fire simultaneously and both call
  `failOperation` (only the first wins).

`pct` is clamped to `[0, 100]` on every `reportProgress`. Phase is
preserved across no-phase updates (a progress call without a `phase`
field doesn't reset the prior phase). Partial result is overwritten
on each call (caller is responsible for monotonic-ish semantics).

## Cross-session durability (AC-F5-2)

`OperationRegistry` is in-memory by default — operations live for the
duration of the browser session. Production deployments need
cross-session durability so a paralegal who closes the browser at
5pm comes back the next morning to see the result.

Pattern: serialise on every transition, replay on app boot.

```ts
// Production: persist on every change
constructor() {
  effect(() => {
    const snapshot = registry.operations();
    persistenceRegistry.get('local').write('lro:operations', snapshot);
  });
}

// On app boot: replay
provideAppInitializer(() => {
  const stored = persistenceRegistry.get('local').read('lro:operations');
  if (Array.isArray(stored)) {
    for (const op of stored) {
      // Restore via private API or a hostable replay() method
      registry.replay(op);
    }
  }
});
```

The lib doesn't ship `replay()` in v1 — durable LRO is a deployment
choice deferred per the plan §9.5.5. The shape is documented here so
adopters can wire it without reverse-engineering the registry.

## Continuation handles for resume

Every `ctx.startOperation` stamps the operation's
`continuationHandle` with `{threadId, runId, toolCallId}`. This lets
the resume layer re-attach a chat thread to an in-flight operation:
the user reopens the same chat thread, the chat shell looks up the
operation by `(threadId, opId)`, and the progress widget mounts
again pointing at the live record.

For client-side LRO (where the background loop runs in the browser),
the closure is lost on reload — `ctx` is gone, `setTimeout` chains
are gone. This pattern is suitable for **server-side LRO** where the
work runs out-of-process and the browser is just a viewer.

## Telemetry

Per r3 plan §11.5:

| Metric | Type | Tags |
|---|---|---|
| `lro.run` | span (per-operation) | `toolName`, `opId`, `durationMs`, `finalStatus` |
| `lro.progress.gap_ms` | histogram | `toolName` — for healthy-stream detection |

The lib's `OperationRegistry` does NOT emit these directly; the host
wires them via the audit hook or a separate effect on the registry's
signal. The `AGENTIC_TELEMETRY_SINK` token is the integration point.

Stream-health monitoring matters for production: a TAR pass that
emits no progress for 5 minutes is probably stuck. Wire an alert via
the audit chain or a dedicated effect that watches `gap_ms` and
escalates after a threshold.

## Cancellation

`ctx.signal` is a standard `AbortSignal`. The chat shell aborts when:

- The user clicks the Stop control.
- The chat reset (new conversation).
- A run-error event lands.

Long-running handlers MUST check the signal periodically — at every
batch, before any expensive operation. The pattern:

```ts
const tick = (): void => {
  if (ctx.signal.aborted) {
    ctx.failOperation(opId, { code: 'ABORTED', message: 'aborted.' });
    return;
  }
  // ... do work, maybe schedule the next tick
};
```

Without this check, a stale background loop runs to completion
against a dead chat session — wasting cycles and emitting progress
events for an operation no surface is observing.

For server-side LRO, the cancellation path also flows through the
chat shell's abort signal: when the user aborts, the chat shell sends
a cancellation event over the SSE channel, the server picks it up,
and the server-side LRO loop checks its own signal.

## Production patterns

- **Server-side LRO.** Move the background loop to the agent server.
  The handler still calls `ctx.startOperation(...)` to mint the opId,
  but the actual work happens out-of-process. Progress events flow
  back over the SSE channel as `operation-progress` events; the chat
  shell folds them into `OperationRegistry`. Survives browser
  refresh trivially. Implementation is backend-specific — AG-UI passes
  events through; Hashbrown wraps; A2UI's text-only path degrades the
  widget to a "not supported" banner.
- **Per-tenant rate limits.** Hosts that share an agent server
  across tenants typically cap concurrent LROs per matter (S-4 in the
  r3 plan: 25 concurrent). Enforce in your tool factory or in the
  agent server before calling `ctx.startOperation`.
- **Operation history retention.** `OperationRegistry` keeps every
  record indefinitely — finished + failed entries grow unbounded over
  a long session. For real deployments, archive entries older than N
  days into a backend store and drop from the in-memory registry, or
  cap the in-memory size with an eviction policy.
- **Privacy on partialResult.** A long-running classifier may stream
  per-batch counts containing privileged ids. The progress widget
  reads from the registry, so anything you put in `partialResult`
  ends up there. If your audit policy restricts who sees in-flight
  counts, gate the registry's reads behind your scope policy
  (or omit `partialResult` and only commit it to the result field at
  completion).
- **Stuck operations.** A handler that crashes between calling
  `startOperation` and emitting `complete`/`fail` leaves the record
  pinned at `started` or `progress` forever. Add a heartbeat check:
  an effect that scans `active()` and fails any operation whose last
  progress is older than N minutes, with `code: 'STUCK'`.

## Debugging

- **Widget shows "Unknown operation: opId-...".** The chat shell
  resolved `mvk-operation-progress` (so `ComponentRegistry` is
  registered correctly), but the registry doesn't have the opId. Two
  causes:
  1. The handler never called `startOperation` — verify the result
     payload's `opId` matches what's in `OperationRegistry.operations()`.
  2. Two registries — the renderer's component injector resolved a
     different `OperationRegistry` than the tool's `ToolContext` did.
     Both should be `providedIn: 'root'`; if you've namespaced or
     wrapped, verify identity.
- **Progress never updates past 0%.** Either the background loop never
  fires (`setTimeout` swallowed?) or the loop runs but doesn't call
  `reportProgress`. Add a `console.log` inside the tick.
- **Audit chain has gaps.** The hook is fire-and-forget — a throwing
  audit-write does NOT roll back the in-memory transition. Add a
  console.error inside your hook to surface upstream issues. Run
  `verifyAuditChain()` periodically in dev to catch gaps fast.
- **Chat shows the result before progress completes.** The handler
  returned its synthetic result before the background loop finished,
  which is correct LRO behaviour — the LLM sees the queued state and
  describes it ("Started TAR classification…"). The user's view is
  the inline progress widget, which streams independently. The
  `runFinished` event of the chat run fires when the synthetic result
  is consumed, not when the operation completes.

## Related cookbook entries

- [HITL approval](./approval-flow.md) — F4 sidecar tool execution
  carries the LRO methods on its synthetic `ToolContext` too. F4
  tools that happen to be long-running route progress through the
  same `OperationRegistry`.
- [Composable intake form](./composable-intake-form.md) /
  [Interactive workflows](./interactive-workflows.md) — the same
  per-component injector pattern (`COMPOSITION_SLOT`) that F1 + F3 use
  inspires F5's `OperationRegistry` per-record subscription model.
- [Production deployment](./production-deployment.md) —
  `PersistenceRegistry` swap for cross-session LRO durability.

## See also

- [Plan, Capability F5](../plans/ediscovery-dynamic-ui-plan.md#95-capability-f5--long-running-operations-lro) —
  acceptance criteria, NFR targets, the §9.5.4 reconnection design.
- [`operation-registry.ts`](../../projects/agentic-ui/src/lib/registries/operation-registry.ts) —
  registry + lifecycle + `AGENTIC_OPERATION_AUDIT_HOOK`.
- [`operation-progress.component.ts`](../../projects/agentic-ui/src/lib/components/operation-progress.component.ts) —
  progress widget.
- [`run-orchestrator.ts`](../../projects/agentic-ui/src/lib/chat/run-orchestrator.ts) —
  `buildToolContext()` carrying the LRO surface to every tool.
- The eDiscovery flagship's working tool + page:
  [`agentic.ts`](../../examples/demo-ediscovery-shell/src/app/agentic/agentic.ts) (search `runTARClassifier`),
  [`pages/operations/operations.component.ts`](../../examples/demo-ediscovery-shell/src/app/pages/operations/operations.component.ts).
