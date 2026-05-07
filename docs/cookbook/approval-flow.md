# Human-in-the-loop approval (Capability F4)

The agent drafts an irreversible action; a senior reviewer signs off
before it runs; every state transition lands in the same tamper-evident
audit chain that everything else writes to. PR-style review for
agent-initiated mutations. Capability F4 of the
[r3 dynamic-UI plan](../plans/ediscovery-dynamic-ui-plan.md#94-capability-f4--human-in-the-loop-approval).

## Why this matters

Two enterprise objections kill agentic-UI evaluations more than any
other:

1. **"What if the agent does the wrong thing?"** — the answer is
   either *prevent* (HITL gates) or *recover* (replay/undo). F4 is the
   prevention half; F8 is the recovery half. They compose.
2. **"Who approved this?"** — auditors want a name and a timestamp on
   every irreversible mutation. F4 captures both, deterministically,
   on the same hash chain as every other state change.

F4 is the first feature in the program that *changes how the chat
runs*. Capabilities 1–3 added new UI surface; F4 wedges into the
client-tools dispatcher between argument parsing and handler execution.

```mermaid
sequenceDiagram
    actor Para as Paralegal
    participant Loop as runUntilSettled
    participant Reg as ApprovalRegistry
    participant Audit as Audit chain
    actor Counsel as Lead Counsel

    Para->>Loop: tool-call · exportProductionSet
    Loop->>Reg: required(args, ctx)?
    Reg-->>Loop: yes
    Loop->>Reg: enqueue Approval{pending}
    Loop-->>Para: synthetic queued result + mvk-approval-card widget
    Note over Para: paralegal sees "lead counsel must approve" — no buttons

    Counsel->>Reg: GET pending (via /approvals page)
    Counsel->>Reg: transition('approved', persona='lead-counsel')
    Reg->>Audit: appendAudit{action='tool-approved', actor, target, ...}
    Reg-->>Counsel: sidecar tool execution
    Note over Counsel: tool runs; result rendered inline on the card
```

## Tools-vs-actions: where F4 sits

|  | Tool | Approval policy |
|---|---|---|
| Registered via | `agenticTool({...})` → `ToolRegistry` | `agenticApproval({...})` → `ApprovalRegistry` |
| Mutates state | yes (when invoked) | no (gates a tool that does) |
| Persona scope (`setScopePolicy`) | filters which tools the LLM SEES | filters which approvals appear in a reviewer's queue |
| Audit chain | `tool-executed` event | `tool-approved` / `tool-rejected` events |
| Agent visibility | LLM sees the tool list | LLM does not see policies — they're enforced server-side / client-side at the dispatch boundary |

Both apply per call: scope decides *who can request*; approval decides
*who can authorise*. They're orthogonal and commutative — order doesn't
matter.

## Step 1 — register an approval policy

```ts
import {
  agenticApproval,
  ApprovalRegistry,
} from '@maverick/agentic-ui';

env.get(ApprovalRegistry).register(
  agenticApproval({
    tool: 'exportProductionSet',
    // Only the lead-counsel can self-approve. Paralegal, lit-support,
    // vendor-reviewer all need HITL.
    required: (_args, ctx) => ctx.persona !== 'lead-counsel',
    approverRoles: ['lead-counsel'],
    // Name of a registered widget that renders the diff. Reviewer sees
    // the LITERAL arg payload — not an LLM-generated summary.
    diffRenderer: 'production-summary-diff',
    signoffMessage: (args) => {
      const pid = (args as { productionId: string }).productionId;
      return `Approve delivery of production ${pid} to opposing counsel?`;
    },
  }),
);
```

Validates at registration:

- non-empty tool identifier
- `required` and `signoffMessage` are functions
- `approverRoles` is a non-empty array of role names
- `diffRenderer` is a registered widget identifier
- `slaMinutes` (when set) is a positive number

Throws `AgenticApprovalError` on any of the above so misconfigured
policies surface at boot, not at first interception.

## Step 2 — wire the active persona

The intercept uses an injection token rather than depending on a
specific host service:

```ts
import { AGENTIC_ACTIVE_PERSONA } from '@maverick/agentic-ui';

// In your providers array:
{
  provide: AGENTIC_ACTIVE_PERSONA,
  useFactory: () => {
    const persona = inject(PersonaService);
    return () => persona.active();
  },
},
```

The default factory returns `() => ''` so libraries that don't model
personas pay nothing.

## Step 3 — provide a diff widget

The diff is what the reviewer signs off on. Per AC-F4-2 ("the literal
arg payload that will execute on approve"), it is **NOT** an LLM
summary — it's the raw, validated args.

A generic JSON-table diff is enough for many cases:

```ts
import { Component, computed, inject } from '@angular/core';
import { APPROVAL_DIFF_INPUTS } from '@maverick/agentic-ui';

@Component({
  selector: 'app-production-summary-diff',
  template: `
    <dl>
      @for (row of rows(); track row.key) {
        <dt>{{ row.label }}</dt>
        <dd>{{ row.value }}</dd>
      }
    </dl>
  `,
})
export class ProductionSummaryDiffComponent {
  private readonly inputs = inject(APPROVAL_DIFF_INPUTS, { optional: true });
  protected readonly rows = computed(() => {
    const args = this.inputs?.args ?? {};
    // ... your shape-aware projection
  });
}
```

Then register it under the `diffRenderer` name from your policy:

```ts
agenticWidget({
  name: 'production-summary-diff',
  component: ProductionSummaryDiffComponent,
  propsSchema: z.object({}),
});
```

The lib's `<mvk-approval-card>` provides `APPROVAL_DIFF_INPUTS` (a
typed token carrying `{ approvalId, args, signoffMessage }`) via a
per-card child injector. Diff widgets opt in by `inject(...,
{ optional: true })`. Domain-specific diffs that join against your
matter store, render a before/after view, or pull privileged content
through scope-policy reads are all variations on the same shape.

## Step 4 — register the approval card widget

The chat-shell intercept emits a synthetic queued result whose
`components: [{name: 'mvk-approval-card', ...}]` array references the
canonical name. Register the lib's built-in component under that name:

```ts
import { ApprovalCardComponent } from '@maverick/agentic-ui';

agenticWidget({
  name: 'mvk-approval-card',
  component: ApprovalCardComponent,
  propsSchema: z.object({ approvalId: z.string() }),
});
```

That's it. The next time the agent calls `exportProductionSet` from a
non-counsel persona, the card renders inline in the chat — diff,
sign-off prompt, Approve / Reject buttons.

## Step 5 — wire the audit hook

By default, transitions update the in-memory registry only. To
mirror them into your audit chain:

```ts
import {
  AGENTIC_APPROVAL_AUDIT_HOOK,
  type ApprovalAuditEvent,
} from '@maverick/agentic-ui';

{
  provide: AGENTIC_APPROVAL_AUDIT_HOOK,
  useFactory: () => {
    const persona = inject(PersonaService);
    return ({ approval, decision, previousStatus }: ApprovalAuditEvent) => {
      appendAudit({
        id: nextAuditId(),
        matterId: matter.matterId,
        actor: approval.approverPersona ?? persona.active(),
        action: decision === 'approved' ? 'tool-approved' : 'tool-rejected',
        target: { type: 'tool', id: approval.toolName },
        before: {
          status: previousStatus,
          args: approval.args,
          requesterPersona: approval.requesterPersona,
        },
        after: { status: decision, comment: approval.comment },
        reason: approval.comment,
        timestamp: approval.decidedAt,
      });
    };
  },
},
```

Hook contract:

- Fires after the in-memory transition has succeeded.
- Throwing **does not roll back** the registry — the chain-validation
  property test surfaces missing entries on the next read instead.
  This separates the in-memory decision from the durable audit append:
  if your audit pipeline is briefly offline, the user still sees their
  approval take effect; the missing chain entry surfaces in the
  integrity check.

## Step 6 — surface the queue page

A `/approvals` route reading `ApprovalRegistry.pendingForApprover(activePersona)`
is the asynchronous-handoff half of the flow (AC-F4-5: paralegal
queues at 5pm; lead counsel approves Monday morning).

```ts
@Component({
  selector: 'app-approvals',
  imports: [ApprovalCardComponent],
  template: `
    <h1>Approvals queue · {{ activePersonaLabel() }}</h1>
    @for (a of visiblePending(); track a.id) {
      <mvk-approval-card [approvalId]="a.id" />
    }
  `,
})
export class ApprovalsComponent {
  private readonly approvals = inject(ApprovalRegistry);
  private readonly persona = inject(PersonaService);
  protected readonly visiblePending = computed(
    () => this.approvals.pendingForApprover(this.persona.active()),
  );
}
```

Add it to your router with `loadComponent`. A sidebar badge with
`pendingForApprover().length` makes the queue depth visible the moment
the reviewer logs in.

## Resume design

When the intercept fires, the chat thread is **not paused**. The
synthetic queued result lands on the tool call (the LLM sees
`{queued: true, approvalId, status: 'pending-approval', message,
components: [...]}`) and the chat's `runUntilSettled` loop continues
to the next turn. The agent typically responds with something like
"I've queued this for approval; lead counsel will review."

The Approve flow runs the tool **sidecar** — inside the approval card,
not in the original chat thread. The card uses `approval.continuationHandle`
({threadId, runId, toolCallId}) as the `ToolContext` so audit + tracing
attribute the execution back to the original request, even though the
thread itself has moved on.

This is the v1 simplification noted in the r3 plan §9.4.3 — full
chat-thread re-attachment (where the post-approve tool result feeds
back into the original assistant turn as if no pause had happened)
needs durable continuation tokens that are backend-specific, and
lands as a follow-up. The v1 flow is sufficient for the demo flagship
and any deployment whose audit posture cares about *who decided* more
than *which assistant message rendered the result*.

## Reject flow

`mvk-approval-card`'s Reject button requires a non-empty comment. The
registry transitions to `'rejected'`, the audit hook fires with
`decision: 'rejected'`, and the card swaps to its decided-state view
showing the reviewer name + comment. The original chat thread is
unchanged from its synthetic-queued message.

In production deployments, you'd typically also fire a notification
back to the requester (email, Slack, in-app banner). The lib doesn't
do this; the audit hook is the natural integration point — wire it to
your notification pipeline alongside the audit chain.

## Persona scope and approval visibility

`pendingForApprover(persona)` filters via the policy's
`approverRoles`. A reviewer who switches persona mid-session sees the
queue contents update reactively (the registry holds a signal-backed
record map; the component subscribes via `computed()`).

The card itself enforces persona at render time too: when the active
persona is not in `policy.approverRoles`, the Approve / Reject buttons
are absent and a "you cannot approve this" message renders. The
registry's `transition()` does NOT enforce persona — that's the card's
job, since the registry has no concept of "active user." Hosts that
expose the registry to multiple call paths (queue page, chat-inline
card, programmatic admin scripts) need to honour the persona check at
each call site OR wrap the registry with a guard.

## Telemetry

Per r3 plan §11.5 + Capability F4:

| Metric | Type | Tags |
|---|---|---|
| `approval.intercept` | counter | `agentic.tool.name`, `decision='queued'` |
| `approval.decision` | counter | `tool`, `decision` ('approved' / 'rejected') |

Both plug into the same `AGENTIC_TELEMETRY_SINK` token as the rest of
the lib. Wire your OTEL exporter at the host and you get queue-rate
+ decision-rate metrics for free.

## Production patterns

- **Persistence.** `ApprovalRegistry` is in-memory by default — the
  cross-session resume from AC-F4-5 in the v1 demo only works while
  the same browser session is alive. Persistent storage backs through
  `PersistenceRegistry`: hosts wire a serializer that mirrors
  `ApprovalRegistry.approvals()` to localStorage or a backend store,
  and replay on app boot. Production deployments back this with a
  durable store (audit-grade append-only).
- **Approver-identity binding.** The card calls `transition()` with
  the persona that was active *when the click happened*. If your IDP
  rotates or revokes between intercept and decision, you may want to
  re-validate at the approval call. Wrap `ApprovalRegistry.transition`
  in your own guard, or hook into your IDP's session-revocation event.
- **Privileged content in the diff.** The diff widget can read any
  registered service via DI, including matter stores. If the args
  reference a privileged document, the diff widget MUST enforce its
  own scope check before rendering content — `setScopePolicy` filters
  registries, not data fetched inside a component.
- **SLA timeouts.** Set `slaMinutes` on the policy. The lib doesn't
  enforce — that's a host-deployment concern (a cron / scheduled job
  that scans `byStatus('pending')` and escalates / auto-rejects /
  notifies). Pattern: read the registry, compute age, take action,
  call `transition()` programmatically with `approverPersona: 'system'`.
- **Auto-approve with audit note.** Set `autoApproveAfterAuditNote: true`
  on the policy. The lib doesn't enforce; the host-side intercept
  override or a wrapper around `transition()` is where you implement
  this. Useful for low-friction record-keeping on actions that need a
  decision in writing but not human discretion.

## Debugging

- **Tool ran without going through approval.** Check that:
  1. The policy is registered before the chat shell fires its first
     turn (use `provideAppInitializer`).
  2. `ApprovalRegistry` is the same instance — both the intercept
     and the queue page use `inject(ApprovalRegistry)`; if you've
     namespaced or wrapped it, verify the wrapper preserves identity.
  3. `AGENTIC_ACTIVE_PERSONA` returns the expected persona at
     intercept time (log it in your `required(args, ctx)` predicate).
- **Card shows "missing widget" for the diff.** The widget name in
  `policy.diffRenderer` doesn't resolve through `ComponentRegistry`.
  Diff widget registration runs on the host, not on the policy
  registration; verify both happened.
- **Audit events don't appear.** Verify the
  `AGENTIC_APPROVAL_AUDIT_HOOK` provider is in your `app.config.ts`
  providers array — the default factory is a no-op. Once wired, hook
  failures are silent (by design); add a console-error inside your
  hook implementation to surface upstream issues.
- **Approver clicks Approve and nothing visible happens.** Check the
  active persona is in `policy.approverRoles`. The card's button is
  hidden when it isn't, but a programmatic call to `transition()`
  from outside the card bypasses that check — wrap calls.

## Related cookbook entries

- [Composable intake form](./composable-intake-form.md) — F1; the
  widget contract reused by the diff renderer.
- [Interactive workflows](./interactive-workflows.md) — F3; an
  approval gate fits naturally as a workflow's terminal step (the
  guided wizard's preview becomes the approval card, with `onComplete`
  routing through the approval-policy intercept).
- [Production deployment](./production-deployment.md) — `PersistenceRegistry`
  + audit-store swap.
- [MCP server for analyst workstations](./paralegal-mcp-review.md) —
  one-tool-many-surfaces pattern that approval policies extend (the
  same gated tool surfaces in chat AND MCP — the policy applies in
  both because it's keyed on tool name).

## See also

- [Plan, Capability F4](../plans/ediscovery-dynamic-ui-plan.md#94-capability-f4--human-in-the-loop-approval) —
  acceptance criteria, NFR targets, the r3 §7.8 audit-chain spec for
  new event kinds.
- [`approval-registry.ts`](../../projects/agentic-ui/src/lib/registries/approval-registry.ts) —
  registry + `AGENTIC_APPROVAL_AUDIT_HOOK` + `ApprovalAuditEvent`.
- [`approval-card.component.ts`](../../projects/agentic-ui/src/lib/components/approval-card.component.ts) —
  card + `APPROVAL_DIFF_INPUTS` token.
- [`agentic-approval.ts`](../../projects/agentic-ui/src/lib/factories/agentic-approval.ts) —
  factory + validation.
- [`run-orchestrator.ts`](../../projects/agentic-ui/src/lib/chat/run-orchestrator.ts) —
  intercept logic in `executeClientTools`.
- The eDiscovery flagship's working policies + diff:
  [`agentic.ts`](../../examples/demo-ediscovery-shell/src/app/agentic/agentic.ts) (search `registerApprovals`),
  [`approval-summary-diff.component.ts`](../../examples/demo-ediscovery-shell/src/app/agentic/approval-summary-diff.component.ts),
  [`approvals.component.ts`](../../examples/demo-ediscovery-shell/src/app/pages/approvals/approvals.component.ts).
