import type { BaseEvent, RunAgentInput } from '@ag-ui/core';

/**
 * Server-side agent contract. Implementations consume an `RunAgentInput` and
 * yield AG-UI `BaseEvent`s; the {@link agUiRouteHandler} wraps the iterable
 * as an SSE response. Wire any framework (Mastra, LangGraph, OpenAI Agent SDK,
 * a hand-rolled echo loop) by adapting it to this interface.
 */
export interface ServerAgent {
  readonly id: string;
  run(input: RunAgentInput, signal: AbortSignal): AsyncIterable<BaseEvent>;
}

/** Resolves a `ServerAgent` by id, e.g., from URL path `/agents/:agentId/run`. */
export interface AgentResolver {
  resolve(agentId: string): ServerAgent | undefined;
}
