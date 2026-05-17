# ADR-009: Approval intercept on `executeClientTools`; fire-and-forget audit hook

**Status**: Accepted (Capability F4 — r3 plan §9.4).
**Related**: ADR-008 (RegistryBase scope policy) · r3 plan §9.4.3 (resume design) · r3 plan §7.8 (audit-chain spec).

## Context

Capability F4 (HITL approval — r3 plan §9.4) wedges a decision boundary
between argument validation and tool execution. Two architectural
choices needed pinning down before implementation could land:

1. **Where does the intercept live?** Tools execute on either the
   client (chat-shell `runUntilSettled` loop) or the server (orchestrator
   agent). For the eDiscovery flagship and most current adopters,
   client-side execution is the dominant path. The intercept must be
   reachable per-call without rewriting tool dispatch.

2. **How does the audit append participate in the transition?** The
   plan §7.8 says every approval decision MUST land in the existing
   tamper-evident chain (Phase 5). The decision-vs-audit relationship
   is non-obvious: what if the audit pipeline is briefly offline?
   Should the in-memory transition roll back? If yes, the chat shows
   "approved" then "rejected" — a worse user experience than just
   logging the missing entry. If no, the audit chain can develop a
   gap that surfaces only on validation read.

## Decision

### Intercept location: `executeClientTools` in `run-orchestrator.ts`

Add an opt-in dependency surface to `RunOrchestratorOptions`:

```ts
readonly approvalRegistry?: ApprovalRegistry;
readonly activePersona?: () => string;
```

Inside `executeClientTools`, before `tool.handler(parsed, ctx)`:

```ts
const intercept = maybeQueueForApproval(call, parsed, ctx, opts);
if (intercept) {
  out.push({ ...call, result: intercept });
  // tool MUST NOT execute
  continue;
}
const result = await tool.handler(parsed, ctx);
```

The synthetic `intercept` payload includes `components: [{ name:
'mvk-approval-card', props: { approvalId } }]` so the chat renders the
card inline. Hosts that don't wire `ApprovalRegistry` see no
behavioural change (the registry is empty; every call passes
through).

**Why client-side, not server-side.** Server-side intercept is
strictly more powerful (works for server-only tools too) but requires
backend-specific protocol extensions and a durable continuation
store. Both are beyond the v1 scope; client-side covers the dominant
path with zero protocol changes. Server-side intercept can land later
without breaking the client-side surface, since the policy registry
is the same in both cases.

**Why a synthetic result, not a paused turn.** A paused turn requires
the chat shell's SSE connection to stay open until the decision
lands, and reattach if it drops. Both are protocol-level concerns
that deserve their own ADR. The synthetic-result approach lets
`runUntilSettled` settle naturally — the LLM sees `{queued: true,
approvalId, ...}` as the tool's "result" and continues to the next
turn (typically saying "I've queued this for approval"). The actual
tool execution happens **sidecar** when the reviewer clicks Approve,
inside the approval card's handler. Audit + tracing attribute the
sidecar execution back to the original request via the persisted
`continuationHandle = { threadId, runId, toolCallId }`.

The trade-off: the original chat thread does NOT receive the
post-approve tool result as a follow-up assistant turn in v1. Real
chat-thread re-attachment is reserved for a backend-specific
follow-up. The audit posture is unchanged either way — *who decided*
and *what executed* are both captured.

### Audit hook: fire-and-forget, no rollback

`ApprovalRegistry.transition()` updates the in-memory state, then
fires an injected `AGENTIC_APPROVAL_AUDIT_HOOK`:

```ts
this.records.update((s) => ({ ...s, [id]: updated }));
try {
  this.auditHook({ approval: updated, decision: next, previousStatus: cur.status });
} catch {
  // swallowed
}
return updated;
```

A throwing hook does NOT roll back the in-memory transition. The
chain-validation property test surfaces missing entries on the next
read — e.g., the `verifyAuditChain()` walk over `listAuditEvents()`
detects the gap when comparing the registry's state against the
chain.

**Why not a transactional approach.** Two-phase commit between an
in-memory signal and a separate audit pipeline (which may be a remote
service in production deployments) is well outside v1 scope and would
add backend-specific failure modes. The fire-and-forget contract has
clear failure semantics:

- **Audit pipeline online**: every decision writes; chain validates clean.
- **Audit pipeline offline**: in-memory state still progresses — the
  user sees their approval take effect — but the chain develops a gap.
  The next chain validation surfaces the missing entries with their
  approval ids; ops can replay from the registry.

The chain primitive (Phase 5, [`audit-chain.ts`](../../examples/demo-ediscovery-shared/src/audit-chain.ts))
is verb-agnostic — it recomputes hashes for any event regardless of
`action`. Adding the new `tool-approved` / `tool-rejected` actions is
purely additive: no chain primitive changes, no new property tests
required for verb correctness.

### Persona enforcement: at the call site, not in the registry

`ApprovalRegistry.transition()` does NOT check whether the active
persona is in the policy's `approverRoles`. The check happens in:

- `<mvk-approval-card>` — buttons are absent for ineligible personas.
- `<mvk-approval-queue>` — `pendingForApprover(persona)` filters per role.

**Why not centralise in the registry.** The registry has no concept
of "active user" — that's a host-application concern delivered via
`AGENTIC_ACTIVE_PERSONA`. Centralising the check would require the
registry to inject that token, which couples the persistence layer to
the UI's session model. Keeping the check at the call site lets:

- Programmatic admin scripts pass a system persona.
- Auto-approve-with-audit-note pass the policy's auto-approver role.
- Tests transition without persona setup.

Hosts that add additional call paths (server-side admin endpoints,
batch-decision tools) MUST honour the persona check at each new call
site OR wrap the registry with a guard. This is documented in the
cookbook as a production-pattern note.

## Consequences

### Positive

- **Zero protocol changes.** AG-UI / Hashbrown / A2UI backends don't
  know F4 exists. The intercept lives entirely on the client.
- **Default no-op.** Hosts that don't wire `ApprovalRegistry` see no
  behavioural change; the registry is empty, no policy matches.
- **Audit decoupling.** The audit hook is the natural integration
  point for non-chain notifications (Slack, email, in-app banners) —
  hosts wire one provider and get fan-out for free.
- **Observability.** The intercept emits an `approval.intercept`
  counter; the card emits `approval.decision`. Both flow through the
  existing `AGENTIC_TELEMETRY_SINK` token without adding metric APIs.

### Negative / accepted trade-offs

- **No chat-thread re-attachment in v1.** The post-approve tool
  result lands on the approval card, not in the original chat thread
  as a follow-up assistant turn. Acceptable for the demo and most
  current deployments; revisited when a backend-specific durable
  continuation lands.
- **Audit gap on hook failure.** Fire-and-forget means a temporary
  audit-pipeline outage produces a chain gap that surfaces only on
  validation read. Mitigation: the registry retains the full record
  with `approvalId` + `decidedAt` + `approverPersona`, so replay is
  trivial.
- **Persona check distributed.** Hosts adding new call paths must
  remember to check persona. Mitigation: the cookbook's "Production
  patterns" section calls this out; lib-side helpers (e.g. a
  `guardedTransition`) can be added later without breaking changes.

## Rejected alternatives

### Alternative: server-side intercept

Move the intercept to the orchestrator agent (`executeServerTools` or
similar). Rejected for v1 because:

- Requires backend-specific protocol extensions to encode the
  "queued" state for the LLM to understand.
- Requires a durable continuation store on the server.
- Inverts the client-side dispatch flow that the eDiscovery flagship
  + most current adopters use.

Can land later as an *additional* surface (both intercepts coexist;
the policy registry is the same).

### Alternative: transactional in-memory + audit append

Roll back the in-memory transition if the audit hook throws. Rejected
because:

- The user has already seen "approved" rendered.
- The hook may be remote (audit service); transient failure is common
  and would create a frustrating retry loop.
- The chain-validation property test catches gaps cheaper than
  two-phase commit code paths catch races.

### Alternative: lib enforces persona inside `transition()`

Inject `AGENTIC_ACTIVE_PERSONA` into `ApprovalRegistry`. Rejected
because:

- Couples the persistence layer to the UI session model.
- Breaks programmatic / admin / system-persona call paths without
  workarounds.

### Alternative: synchronous audit append (no hook)

Have `transition()` directly call a known audit primitive. Rejected
because:

- Forces the lib to depend on an audit primitive that doesn't exist
  in the lib.
- Hosts have different audit pipelines (some chain-based, some plain
  log streams, some external SaaS).
- Mock-friendly hook is the standard Angular DI pattern.

## Implementation references

- [`projects/agentic-ui/src/lib/chat/run-orchestrator.ts`](../../projects/agentic-ui/src/lib/chat/run-orchestrator.ts) —
  `maybeQueueForApproval()` intercept.
- [`projects/agentic-ui/src/lib/registries/approval-registry.ts`](../../projects/agentic-ui/src/lib/registries/approval-registry.ts) —
  registry + `AGENTIC_APPROVAL_AUDIT_HOOK`.
- [`projects/agentic-ui/src/lib/components/approval-card.component.ts`](../../projects/agentic-ui/src/lib/components/approval-card.component.ts) —
  card + persona check at button render.
- [`docs/cookbook/approval-flow.md`](../cookbook/approval-flow.md) —
  adopter walkthrough.
