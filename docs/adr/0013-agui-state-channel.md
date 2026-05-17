# ADR-013 · AG-UI `state` channel for context propagation

**Status:** Accepted

**Date:** 2026-05-09

**Related:** [ADR-008](./0008-registry-scope-policy.md) · [ADR-010](./0010-platform-principles-and-license.md) · [ADR-011](./0011-registry-provider-hook.md) · [ADR-012](./0012-thread-state-store-adapters.md)

---

## Context

Today the agent is **persona-blind in messaging.** `setScopePolicy` filters tools at the read site (the trust gate, ADR-008), so the agent never sees out-of-scope tools — that's the security boundary working as designed. But the agent has no idea *what* the active persona is when phrasing its responses. A paralegal asking "release HOLD-001" gets the same English back as a Lead Counsel — only the tool surface differs. That's a UX gap, not a security gap, but it's a noticeable one in a multi-persona deployment.

The same gap exists for matter context (the agent doesn't know we're in a securities matter), active route (it doesn't know the user is on `/custodians`), and any other reasoning context the host has that would help the agent compose better replies.

AG-UI already defines a `state` field on `RunAgentInput`. We currently send `state: {}` for every run (hardcoded in [`projects/agentic-ui/src/lib/backends/ag-ui/ag-ui-backend.ts:58`](../../projects/agentic-ui/src/lib/backends/ag-ui/ag-ui-backend.ts#L58)). The wire is there; we just don't use it.

This ADR codifies how the runtime threads host state into AG-UI without breaking ADR-010 D3 (embedded-first) or D4 (zero breaking changes), and crucially **why state is *not* a substitute for `setScopePolicy`** — the layering rationale.

---

## Decision

### D1 — `AgenticRunInput.state` is optional + additive

The `AgenticRunInput` interface gains an optional readonly `state?: Readonly<Record<string, unknown>>` field. Backends are responsible for mapping it to their wire format. Default behaviour (omitted) matches v1.2 — AG-UI sends `state: {}`, Hashbrown / A2UI ignore it.

This is **purely additive** per ADR-010 D4. No existing call site is affected.

### D2 — `AGENTIC_RUN_STATE_PROVIDER` injection token

A new injection token returns a **function** (sync, no-arg, returns a fresh object on each call):

```ts
type AgenticRunStateProvider = () => Readonly<Record<string, unknown>>;

const AGENTIC_RUN_STATE_PROVIDER = new InjectionToken<AgenticRunStateProvider>(
  'AGENTIC_RUN_STATE_PROVIDER',
  { providedIn: 'root', factory: () => () => ({}) },
);
```

The factory shape (function, not value) follows the same pattern as `AGENTIC_ACTIVE_PERSONA` — Angular `signal()` values don't fit the InjectionToken value shape cleanly, but a getter function reads them lazily on each call. Hosts can close over signals, services, and stores in the closure; the runtime calls the function once per `runUntilSettled` invocation.

Default factory returns `{}` — equivalent to v1.2 behaviour. **No host change is required.** Hosts opt in by providing the token.

### D3 — One snapshot per run, not per turn

`runUntilSettled` calls the provider **once at the start of the run** and uses that snapshot for every turn within the run. Reasoning:

- A run consists of multiple turns (user message → tool calls → tool results → final reply). Persona / matter / route shouldn't change mid-run; if they do, it's a user navigation that should typically end the in-flight run anyway (handled by `AbortController` in the chat shell).
- Calling per turn would let mid-run state changes confuse the agent (turn 1 thinks it's lead-counsel, turn 2 thinks it's paralegal). One snapshot avoids the ambiguity.
- It's also marginally cheaper: one Angular signal read per run vs. one per turn.

If a host wants per-turn freshness (rare), they can provide a state object with values that the agent re-derives on each turn server-side. But that's an explicit choice; the default snapshot-per-run is right for ~all cases.

### D4 — State is **not** a security boundary

This is the load-bearing layering distinction:

| Layer | Mechanism | Purpose |
|---|---|---|
| Trust boundary | `setScopePolicy` filtering `tools[]` at read site (ADR-008) | Security: agent **can't see** out-of-scope tools |
| Reasoning context | `AGENTIC_RUN_STATE_PROVIDER` populating `RunAgentInput.state` | UX: agent **knows what to say** |
| Reactive rendering | F1 closed-AST DSL evaluating predicates against live signals | UX: form sections flip on persona switch without re-prompt |

A jailbroken / prompt-injected agent could ignore `state` and try to call `releaseLegalHold` even after seeing `persona: 'paralegal'`. **That's fine** — the tool literally isn't in the `tools[]` array the agent received. The filter happened in the browser before the request left.

This is layered defense, not a single guard. Don't route security decisions through state. Don't send anything to state that you wouldn't be comfortable with the LLM reading + reasoning over (which often means scrubbing PII).

### D5 — PII / sensitive-data redaction is the host's job

The lib does NOT scrub the state object. If `persona: 'paralegal-001'` includes a real user identifier the host doesn't want sent to the LLM provider, the host's provider function is responsible for replacing it (e.g., return `persona: 'paralegal'` without the `-001` suffix).

A future ADR could introduce `AGENTIC_STATE_REDACTOR` as an interception seam. Out of scope for v0.1 — most hosts can simply not include sensitive fields in their provider's return value.

### D6 — Hashbrown / A2UI may ignore state

AG-UI defines a `state` field in `RunAgentInput`; Hashbrown and A2UI don't have an equivalent today. Their backends will silently drop the state — adopters using those backends won't get context-aware reasoning until the protocols add it.

This is acceptable because:
- AG-UI is the most-deployed backend (the eDiscovery flagship uses it).
- Hashbrown / A2UI are protocol experiments; their owners can add a state channel if/when consumer demand justifies it.
- `BackendCapabilities.contextChannel: boolean` could be a future capability flag if we need to surface the difference; not in scope for v0.1.

### D7 — Server-side reads + system-instruction prepend (demo only)

The runtime ships the state field on the wire. **What the server does with it is the server's choice.** The reference implementation in `examples/demo-ediscovery-server/src/gemini-agent.ts` reads `input.state` and prepends a context block to the system instruction:

> *Current context: persona = paralegal, matter = M-2026-0042 (securities), active route = /custodians.*

That's a pattern, not a contract. Other servers might thread state into Memgraph queries, RAG retrieval scoping, audit logs, etc. The runtime is agnostic.

---

## Consequences

### Positive

- **Closes the persona-blind-LLM gap.** Demo eDiscovery now phrases responses appropriately to the persona without breaking the security boundary.
- **Backwards-compatible.** Hosts that don't provide the token see no change. Existing tests stay green.
- **Standards-aligned.** AG-UI's `state` field was designed for exactly this; we're now using it.
- **Layering is explicit.** ADR documents *why* state is not a security boundary — protects future contributors from misuse.
- **Demo gets visible win.** Agent responses become persona-aware; users notice immediately.

### Negative

- **Backends without a state channel ignore it.** Adopters using Hashbrown / A2UI don't benefit. Documented in D6.
- **PII risk if hosts are sloppy.** Lib doesn't scrub. Documented in D5; future redactor token can close.
- **One more injection token to learn.** The platform-seams map gains one more entry. Trade-off accepted.

### Neutral

- ~30 LOC of net-new code in the runtime (1 token, 1 type, 5 lines threaded through orchestrator + AG-UI backend). Bundle impact: negligible.

---

## Alternatives considered

### A1 — Build state into the system instruction at server boot time

Bake persona / matter / route into the server's static system instruction; clients tell the server which persona "they are" via a custom header or query param.

**Rejected:** scales poorly (per-persona variants of the system instruction); harder to compose; doesn't survive multi-tenancy (each tenant has its own persona model).

### A2 — Pass state as a synthetic message (`role: 'system'` per-turn)

Inject a synthetic system message at the top of `messages[]` that says "current persona: paralegal".

**Rejected:** muddles the conversation history (every turn has a synthetic message); harder to reason about for agents that audit their own context; AG-UI already has a state channel — using it is cleaner.

### A3 — Per-turn refresh of the state provider

Call the provider before every turn within a run, not just once at the start.

**Rejected:** lets persona/matter/route flip mid-run, which confuses the agent and makes traces harder to audit. See D3 for the rationale.

### A4 — Lib-side redaction by default

Strip known-sensitive keys (email, ssn, etc.) before sending state.

**Rejected:** can't possibly know what's sensitive in the host's domain. The host knows; the lib doesn't. D5 places redaction responsibility correctly.

### A5 — Make state mandatory on AgenticRunInput

Every backend implementation must handle `state`; non-handling is a build error.

**Rejected:** breaks ADR-010 D4 (existing call sites would break). Optional + additive is the right shape.

---

## Implementation

This ADR is implemented in the same PR. Files:

- `projects/agentic-ui/src/lib/types/agentic-backend.ts` — add `state?: Readonly<Record<string, unknown>>` to `AgenticRunInput`
- `projects/agentic-ui/src/lib/chat/run-state-provider.ts` — new, ~50 LOC, `AgenticRunStateProvider` type + `AGENTIC_RUN_STATE_PROVIDER` token
- `projects/agentic-ui/src/lib/chat/run-orchestrator.ts` — accept `stateProvider` option, snapshot once per run, pass through `AgenticRunInput`
- `projects/agentic-ui/src/lib/chat/inject-agentic-chat.ts` — inject + forward
- `projects/agentic-ui/src/lib/chat/index.ts` — export new symbols
- `projects/agentic-ui/src/lib/backends/ag-ui/ag-ui-backend.ts` — replace hardcoded `state: {}` with `input.state ?? {}`
- `projects/agentic-ui/src/lib/chat/run-state-provider.spec.ts` — new tests
- `examples/demo-ediscovery-shell/src/app/app.config.ts` — wire persona + matter + route into the provider (worked example)
- `examples/demo-ediscovery-server/src/gemini-agent.ts` — read `input.state`, prepend to system instruction
- [docs/architecture/platform-seams.md](../architecture/platform-seams.md) — add `AGENTIC_RUN_STATE_PROVIDER` to Tier 1
- [docs/cookbook/context-aware-agent.md](../cookbook/context-aware-agent.md) — extend with the new "reasoning context vs. enforcement" section

---

## References

- [ADR-008 — Registry scope policy](./0008-registry-scope-policy.md) — the trust gate this ADR explicitly does NOT replace
- [ADR-010 — Platform principles, license, non-goals](./0010-platform-principles-and-license.md) — D3 + D4 constrain this design
- [docs/plans/platform-evolution-plan.md](../plans/platform-evolution-plan.md) §4.1 R4 — the v3 plan entry that motivated this ADR
- [docs/cookbook/context-aware-agent.md](../cookbook/context-aware-agent.md) — companion how-to (extended in this PR)
- [AG-UI specification](https://github.com/ag-ui-protocol/ag-ui) — the `state` field on `RunAgentInput`
