import { EnvironmentProviders, inject, InjectionToken, makeEnvironmentProviders, provideEnvironmentInitializer } from '@angular/core';
import {
  ActionRegistry,
  AGENTIC_LOGGER,
  AGENTIC_TELEMETRY_SINK,
  BackendRegistry,
  ValidationRegistry,
  type AgenticBackend,
  type AgenticEvent,
  type AgenticRunInput,
  type AgenticTelemetrySink,
  type BackendCapabilities,
  type BackendDef,
} from '../../internal';
import { parseAgenticEventStrict } from '../_shared/canonical-events';
import { serializeToolsForWire } from '../_shared/canonical-messages';

export interface A2uiBackendConfig {
  readonly url: string;
  readonly headers?: Record<string, string>;
  /** A2UI spec version this adapter targets. */
  readonly specVersion?: string;
}

/**
 * Dispatcher invoked when the A2UI agent emits a `ui-action` event.
 * Receives the action plus the in-flight `threadId` + `runId` so the
 * effect's audit attribution is correct. Apps wire their own
 * dispatcher (route changes, store mutations, form fills, …) or rely
 * on the {@link UI_ACTION_DISPATCHER} default that routes to
 * `ActionRegistry`.
 *
 * The `threadId` / `runId` arguments were added in slice L1
 * (`docs/plans/library-hardening-plan.md`) — before that the default
 * dispatcher hardcoded empty strings, breaking audit attribution.
 */
export interface UiActionDispatcher {
  dispatch(action: {
    actionId: string;
    op: string;
    payload: unknown;
    threadId: string;
    runId: string;
    signal: AbortSignal;
  }): void | Promise<void>;
}

/**
 * Default dispatcher routes `ui-action` events to the matching
 * `ActionDef` in `ActionRegistry`, validating the payload via
 * `ValidationRegistry`. The `threadId` / `runId` / `signal` flow
 * through to the action's effect so audit attribution is correct.
 *
 * Apps that want custom routing override this token.
 */
export const UI_ACTION_DISPATCHER = new InjectionToken<UiActionDispatcher>('UI_ACTION_DISPATCHER', {
  providedIn: 'root',
  factory: () => {
    const actions = inject(ActionRegistry);
    const validators = inject(ValidationRegistry);
    const logger = inject(AGENTIC_LOGGER);
    return {
      dispatch: async ({ actionId, op, payload, threadId, runId, signal }) => {
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
          threadId,
          runId,
          actionId,
          signal,
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
 * A2UI backend adapter. The distinguishing feature vs AG-UI is the
 * `ui-action` event class — the agent can issue UI ops (route, store,
 * form) dispatched through the configured `UiActionDispatcher`.
 *
 * Slice L1 of `docs/plans/library-hardening-plan.md` brings the
 * adapter to parity with AG-UI:
 *   - Tools posted with full JSON-Schema parameters (was: `{name,
 *     description}` only — the LLM had no argument schema)
 *   - `state` field threaded per ADR-013 (was: not posted — host
 *     reasoning context lost)
 *   - Inbound NDJSON lines validated against `agenticEventSchema`
 *     (was: `as unknown as AgenticEvent` cast — could corrupt run
 *     state on malformed payloads)
 *   - `ui-action` dispatcher receives the live threadId / runId
 *     (was: hardcoded empty strings — audit attribution broken)
 *   - Malformed events emit `agentic.run.malformed_event` telemetry
 *
 * The A2UI spec itself is the least-settled protocol in the lib —
 * the adapter pins a `specVersion` so adopters track upstream
 * changes deliberately rather than auto-upgrading.
 */
export class A2uiBackend implements AgenticBackend {
  readonly id = 'a2ui';
  readonly capabilities = A2UI_CAPABILITIES;

  constructor(
    private readonly config: A2uiBackendConfig,
    private readonly dispatcher: UiActionDispatcher,
    private readonly telemetry: AgenticTelemetrySink,
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
          tools: serializeToolsForWire(input.tools),
          // ADR-013 — host's per-turn reasoning context. Default `{}`
          // matches v1.2 wire when no AGENTIC_RUN_STATE_PROVIDER is
          // registered.
          state: input.state ?? {},
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
          const ev = parseAgenticEventStrict(line, {
            telemetry: this.telemetry,
            threadId: input.threadId,
            runId: input.runId,
            backendId: this.id,
          });
          if (!ev) continue;
          yield ev;
          if (ev.type === 'ui-action') {
            await this.dispatcher.dispatch({
              actionId: ev.actionId,
              op: ev.op,
              payload: ev.payload,
              threadId: input.threadId,
              runId: input.runId,
              signal: input.signal,
            });
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

export function provideA2uiBackend(config: A2uiBackendConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      const registry = inject(BackendRegistry);
      const dispatcher = inject(UI_ACTION_DISPATCHER);
      const telemetry = inject(AGENTIC_TELEMETRY_SINK);
      const def: BackendDef = {
        name: 'a2ui',
        id: 'a2ui',
        label: 'A2UI',
        capabilities: A2UI_CAPABILITIES,
        factory: () => new A2uiBackend(config, dispatcher, telemetry),
      };
      registry.register(def);
      registry.setActive('a2ui');
    }),
  ]);
}
