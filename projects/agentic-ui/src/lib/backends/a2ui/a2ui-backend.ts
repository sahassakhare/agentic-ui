import { EnvironmentProviders, inject, InjectionToken, makeEnvironmentProviders, provideEnvironmentInitializer } from '@angular/core';
import {
  ActionRegistry,
  AGENTIC_LOGGER,
  BackendRegistry,
  ValidationRegistry,
  type AgenticBackend,
  type AgenticEvent,
  type AgenticRunInput,
  type BackendCapabilities,
  type BackendDef,
} from '../../internal';

export interface A2uiBackendConfig {
  readonly url: string;
  readonly headers?: Record<string, string>;
  /** A2UI spec version this adapter targets. */
  readonly specVersion?: string;
}

/**
 * Dispatcher invoked when the A2UI agent emits a `ui-action` event.
 * Apps wire their own (route changes, store mutations, form fills, etc.).
 */
export interface UiActionDispatcher {
  dispatch(action: { actionId: string; op: string; payload: unknown }): void | Promise<void>;
}

/**
 * Default dispatcher routes `ui-action` events to the matching `ActionDef` in
 * `ActionRegistry`, validating the payload via `ValidationRegistry`. Apps that
 * want custom routing can override the token.
 */
export const UI_ACTION_DISPATCHER = new InjectionToken<UiActionDispatcher>('UI_ACTION_DISPATCHER', {
  providedIn: 'root',
  factory: () => {
    const actions = inject(ActionRegistry);
    const validators = inject(ValidationRegistry);
    const logger = inject(AGENTIC_LOGGER);
    return {
      dispatch: async ({ actionId, op, payload }) => {
        const def = actions.byType(op);
        if (!def) {
          logger.warn(`[a2ui] No ActionDef registered for op; dropping.`, { op, actionId });
          return;
        }
        const result = validators.validate(def.payloadSchema, payload);
        if (!result.success) {
          logger.warn(`[a2ui] Payload validation failed; dropping action.`, { op, actionId, errors: result.errors });
          return;
        }
        await def.effect(result.data, {
          threadId: '',  // populated by adapter when run() bridges through, see PLAN.md §6.5
          runId: '',
          actionId,
          signal: new AbortController().signal,
        });
      },
    };
  },
});

export const A2UI_CAPABILITIES: BackendCapabilities = {
  streaming: true,
  clientTools: true,
  generativeUi: true,
  uiActions: true,
};

/**
 * A2UI backend adapter (M3 stub). The distinguishing feature vs AG-UI is the
 * `ui-action` event class — agents can issue UI ops (route, store, form)
 * dispatched through the configured `UiActionDispatcher`.
 *
 * NOTE: A2UI is the least-settled protocol; this adapter pins a specVersion.
 * See PLAN.md §11 R1 for the spec-churn handling plan.
 */
export class A2uiBackend implements AgenticBackend {
  readonly id = 'a2ui';
  readonly capabilities = A2UI_CAPABILITIES;

  constructor(
    private readonly config: A2uiBackendConfig,
    private readonly dispatcher: UiActionDispatcher,
  ) {}

  async *run(input: AgenticRunInput): AsyncIterable<AgenticEvent> {
    yield { type: 'run-started', threadId: input.threadId, runId: input.runId };

    if (input.signal.aborted) {
      yield { type: 'run-finished', runId: input.runId };
      return;
    }

    try {
      const res = await fetch(this.config.url, {
        method: 'POST',
        signal: input.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', ...(this.config.headers ?? {}) },
        body: JSON.stringify({
          threadId: input.threadId,
          runId: input.runId,
          messages: input.messages,
          tools: input.tools.map((t) => ({ name: t.name, description: t.description })),
          specVersion: this.config.specVersion ?? '0.x',
        }),
      });
      if (!res.ok || !res.body) throw new Error(`A2UI request failed: ${res.status} ${res.statusText}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        if (input.signal.aborted) break;
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          const ev = parseEvent(line);
          if (!ev) continue;
          yield ev;
          if (ev.type === 'ui-action') {
            await this.dispatcher.dispatch({ actionId: ev.actionId, op: ev.op, payload: ev.payload });
          }
        }
      }

      yield { type: 'run-finished', runId: input.runId };
    } catch (err) {
      yield {
        type: 'run-error',
        runId: input.runId,
        error: { code: 'a2ui_error', message: err instanceof Error ? err.message : String(err) },
      };
    }
  }
}

function parseEvent(line: string): AgenticEvent | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    if (typeof obj['type'] === 'string') return obj as unknown as AgenticEvent;
    return null;
  } catch {
    return null;
  }
}

export function provideA2uiBackend(config: A2uiBackendConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      const registry = inject(BackendRegistry);
      const dispatcher = inject(UI_ACTION_DISPATCHER);
      const def: BackendDef = {
        name: 'a2ui',
        id: 'a2ui',
        label: 'A2UI',
        capabilities: A2UI_CAPABILITIES,
        factory: () => new A2uiBackend(config, dispatcher),
      };
      registry.register(def);
      registry.setActive('a2ui');
    }),
  ]);
}
