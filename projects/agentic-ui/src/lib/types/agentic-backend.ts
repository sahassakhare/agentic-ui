import type { AgenticEvent } from './agentic-event';
import type { AgenticMessage } from './agentic-message';
import type { BackendCapabilities, ComponentDef, ToolDef } from './registry-defs';

export interface AgenticRunInput {
  readonly threadId: string;
  readonly runId: string;
  readonly messages: readonly AgenticMessage[];
  readonly tools: readonly ToolDef[];
  readonly widgets: readonly ComponentDef[];
  readonly signal: AbortSignal;
  /**
   * Free-form context the host application threads to the agent for
   * **reasoning only** — Capability M1 R4. Typical shape:
   * `{ persona, matter, activeRoute, department? }`.
   *
   * Populated by `runUntilSettled` from the optional
   * `AGENTIC_RUN_STATE_PROVIDER` injection token. Default is `{}`
   * when no provider is registered, preserving v1.2 behaviour.
   *
   * **Not a security boundary.** `setScopePolicy` is the trust gate
   * (ADR-008); state is only what the agent reads to phrase its
   * response. A jailbroken agent could ignore state and try to
   * call out-of-scope tools — but those tools were already filtered
   * out of `tools[]` before the request left the browser. See
   * ADR-013 for the layering rationale.
   *
   * Backends are responsible for mapping this object into their
   * wire format. AG-UI threads it through `RunAgentInput.state`.
   * Hashbrown / A2UI may not have a state channel today; they
   * MAY ignore the field and the lib will not warn.
   */
  readonly state?: Readonly<Record<string, unknown>>;
}

export interface AgenticBackend {
  readonly id: string;
  readonly capabilities: BackendCapabilities;
  run(input: AgenticRunInput): AsyncIterable<AgenticEvent>;
  reset?(threadId: string): Promise<void>;
}
