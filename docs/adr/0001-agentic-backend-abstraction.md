# ADR-001: Pluggable AgenticBackend abstraction

**Status**: Accepted (M1).

## Context

Three protocols compete for the "agent ↔ UI" wire format: AG-UI (CopilotKit-backed, AG-UI core), Hashbrown (LiveLoveApp), and A2UI (newer, agent-issues-UI-ops). Each has its own event shape, transport, and lifecycle semantics. The chat shell, run orchestrator, registries, and conformance suite would otherwise need three implementations — drift would be inevitable.

## Decision

Define a single `AgenticBackend` interface and an `AgenticEvent` union; ship one concrete adapter per protocol behind a secondary entry point (`/ag-ui`, `/hashbrown`, `/a2ui`). The chat shell only ever sees the abstraction.

```ts
export interface AgenticBackend {
  readonly id: string;
  readonly capabilities: BackendCapabilities;
  run(input: AgenticRunInput): AsyncIterable<AgenticEvent>;
  reset?(threadId: string): Promise<void>;
}
```

`capabilities` flags drive feature-detection in the chat shell — `clientTools=false` hides the tools sidebar, `uiActions=false` skips A2UI dispatcher wiring, etc.

## Consequences

- Adding a 4th protocol is an isolated workstream — new secondary entry, no chat-shell changes.
- The `ui-action` event type is reserved in the union from M1 (only A2UI emits it today) so the chat shell never breaks when a new protocol arrives.
- Conformance suite in `/testing` runs identically against every adapter — see `runConformance(backend)`.
- Mismatch policy: when an adapter's protocol has no native equivalent for an event class, it synthesizes (e.g., Hashbrown synthesizes `run-started`/`run-finished` from stream open/close).

## Alternatives considered

- **Three separate libraries** — would force consumers to choose at install time; loses the conformance suite and shared chat shell.
- **AG-UI as the only backend** — locks out Hashbrown/A2UI users. AG-UI is also CopilotKit-aligned; staying neutral matters for the registry-platform-style consumers we target.
