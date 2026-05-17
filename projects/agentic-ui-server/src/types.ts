import type { BaseEvent, RunAgentInput } from '@ag-ui/core';

/**
 * Server-side agent contract. Implementations consume a `RunAgentInput` and
 * yield AG-UI `BaseEvent`s; the {@link agUiRouteHandler} wraps the iterable
 * as an SSE response. Wire any framework (Mastra, LangGraph, OpenAI Agent SDK,
 * a hand-rolled echo loop) by adapting it to this interface.
 *
 * @remarks
 * - `id` should be unique within an `AgentResolver` and is the segment that
 *   appears in URLs (e.g. `/agents/<id>/run`).
 * - `run` MUST yield `RUN_STARTED` first and end with either `RUN_FINISHED`
 *   or a terminal `RUN_ERROR`. AG-UI clients depend on this lifecycle.
 * - `signal` aborts when the client disconnects; honour it to free LLM
 *   streams and pending I/O.
 *
 * @example
 * ```ts
 * import type { ServerAgent } from '@infra-tools/agentic-ui-server';
 * import { EventType } from '@ag-ui/core';
 *
 * class HelloAgent implements ServerAgent {
 *   readonly id = 'hello';
 *   async *run(input, signal) {
 *     yield { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId };
 *     const messageId = `m-${input.runId}`;
 *     yield { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' };
 *     yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: 'Hello!' };
 *     yield { type: EventType.TEXT_MESSAGE_END, messageId };
 *     yield { type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId };
 *   }
 * }
 * ```
 */
export interface ServerAgent {
  /** Stable id used to resolve this agent from a URL path. */
  readonly id: string;
  /**
   * @param input  Thread/run identifiers, message history, available tools/widgets.
   * @param signal Aborts when the client disconnects or the request times out.
   * @returns Iterable of AG-UI events; the route handler encodes each as an SSE frame.
   */
  run(input: RunAgentInput, signal: AbortSignal): AsyncIterable<BaseEvent>;
}

/**
 * Resolves a `ServerAgent` by id. The route handler expects the id to appear
 * in the URL path — by default `/agents/:agentId/run`.
 *
 * @example
 * ```ts
 * const agents = new Map<string, ServerAgent>();
 * agents.set('echo', new EchoAgent());
 * agents.set('gemini', new GeminiAgent());
 *
 * const resolver: AgentResolver = { resolve: (id) => agents.get(id) };
 * app.post('/agents/:id/run', (c) => agUiRouteHandler({ resolver })(c.req.raw));
 * ```
 */
export interface AgentResolver {
  /** Return the agent registered under `agentId`, or `undefined` if none exists. */
  resolve(agentId: string): ServerAgent | undefined;
}
