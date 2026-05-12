import { HttpAgent } from '@ag-ui/client';
import type { EnvironmentProviders } from '@angular/core';
import {
  provideAgenticBackend,
  type AgenticBackend,
  type AgenticEvent,
  type AgenticRunInput,
  type BackendCapabilities,
} from '../../internal';
import { convertMessagesToAgUi, convertToolsToAgUi } from './converters';
import { extractWidgetRenders, mapAgUiEvent } from './event-mapper';
import { observableToAsyncIterable } from './observable-to-async-iterable';

export interface AgUiBackendConfig {
  readonly url: string;
  readonly headers?: Record<string, string>;
}

export const AG_UI_CAPABILITIES: BackendCapabilities = {
  streaming: true,
  clientTools: true,
  generativeUi: true,
  uiActions: false,
};

/**
 * Backend adapter that bridges `@infra-tools/agentic-ui` to AG-UI servers via
 * the `@ag-ui/client` HttpAgent. One `AgUiBackend` instance per BackendRegistry
 * entry; one HttpAgent instance per `run()` call (HttpAgent owns thread state).
 */
export class AgUiBackend implements AgenticBackend {
  readonly id = 'ag-ui';
  readonly capabilities = AG_UI_CAPABILITIES;

  constructor(private readonly config: AgUiBackendConfig) {}

  async *run(input: AgenticRunInput): AsyncIterable<AgenticEvent> {
    const initialMessages = convertMessagesToAgUi(input.messages);
    const agent = new HttpAgent({
      url: this.config.url,
      headers: this.config.headers ?? {},
      threadId: input.threadId,
      initialMessages,
    });

    if (input.signal.aborted) return;
    const onAbort = () => agent.abortRun();
    input.signal.addEventListener('abort', onAbort, { once: true });

    yield { type: 'run-started', threadId: input.threadId, runId: input.runId };

    try {
      const observable = agent.run({
        threadId: input.threadId,
        runId: input.runId,
        messages: agent.messages,
        tools: convertToolsToAgUi(input.tools),
        // Capability M1 R4 — thread the host's reasoning context (persona,
        // matter, active route, etc.) onto the wire so the agent can phrase
        // responses appropriately. Default `{}` matches v1.2 when no
        // AGENTIC_RUN_STATE_PROVIDER is registered. See ADR-013.
        state: input.state ?? {},
        context: [],
        forwardedProps: {},
      });

      for await (const ev of observableToAsyncIterable(observable, input.signal)) {
        const mapped = mapAgUiEvent(ev, input.runId);
        if (mapped) yield mapped;
        for (const widget of extractWidgetRenders(ev)) yield widget;
      }

      yield { type: 'run-finished', runId: input.runId };
    } catch (err) {
      yield {
        type: 'run-error',
        runId: input.runId,
        error: {
          code: 'agent_error',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    } finally {
      input.signal.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * Registers the AG-UI backend with `BackendRegistry` and (by default) sets it
 * as the active backend. Add to your `bootstrapApplication` providers:
 *
 *   provideAgUiBackend({ url: '/api/ag-ui' })
 */
export function provideAgUiBackend(config: AgUiBackendConfig): EnvironmentProviders {
  return provideAgenticBackend({
    id: 'ag-ui',
    label: 'AG-UI',
    capabilities: AG_UI_CAPABILITIES,
    factory: () => new AgUiBackend(config),
  });
}
