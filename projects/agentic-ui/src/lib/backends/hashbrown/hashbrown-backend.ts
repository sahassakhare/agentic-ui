import { EnvironmentProviders, inject, makeEnvironmentProviders, provideEnvironmentInitializer } from '@angular/core';
import {
  AGENTIC_TELEMETRY_SINK,
  BackendRegistry,
  type AgenticBackend,
  type AgenticEvent,
  type AgenticRunInput,
  type AgenticTelemetrySink,
  type BackendCapabilities,
  type BackendDef,
} from '../../internal';
import { parseAgenticEventStrict } from '../_shared/canonical-events';
import { serializeToolsForWire } from '../_shared/canonical-messages';

export interface HashbrownBackendConfig {
  /** URL of the Hashbrown server endpoint (returns NDJSON or SSE). */
  readonly url: string;
  /** Optional headers to include on every request. */
  readonly headers?: Record<string, string>;
  /** Model variant to use. Server determines actual model from this. */
  readonly model?: 'openai' | 'google' | string;
}

export const HASHBROWN_CAPABILITIES: BackendCapabilities = {
  streaming: true,
  clientTools: true,
  generativeUi: true,
  uiActions: false,
};

/**
 * Backend adapter for Hashbrown UI servers. Hashbrown is a
 * model-agnostic LLM abstraction (LiveLoveApp) supporting OpenAI and
 * Google variants — see `flights42`'s `hashbrown/server-{openai,
 * google}.ts` for reference servers.
 *
 * The wire protocol is server-defined; this adapter posts the lib's
 * `AgenticMessage[]` shape directly (the same shape AG-UI consumes),
 * with `tools[]` carrying the full JSON-Schema parameters derived
 * from each ToolDef's Zod schema, and `state` threaded per ADR-013.
 *
 * Slice L1 of `docs/plans/library-hardening-plan.md` brings this
 * adapter to parity with AG-UI:
 *   - Tools posted with full schemas (was: `{name, description}` only)
 *   - `state` field threaded (was: not posted; lost persona/route ctx)
 *   - Inbound NDJSON lines validated against `agenticEventSchema`
 *     (was: `as unknown as AgenticEvent` cast — could corrupt run
 *     state on a malformed wire payload)
 *   - Malformed events emit `agentic.run.malformed_event` telemetry
 *     instead of silently dropping
 */
export class HashbrownBackend implements AgenticBackend {
  readonly id = 'hashbrown';
  readonly capabilities = HASHBROWN_CAPABILITIES;

  constructor(
    private readonly config: HashbrownBackendConfig,
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
          // ADR-013 — host's per-turn reasoning context (persona,
          // matter, active route). Default `{}` matches v1.2 wire when
          // no AGENTIC_RUN_STATE_PROVIDER is registered.
          state: input.state ?? {},
          model: this.config.model ?? 'openai',
        }),
      });
      if (!res.ok || !res.body) throw new Error(`Hashbrown request failed: ${res.status} ${res.statusText}`);

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
          if (ev) yield ev;
        }
      }

      yield { type: 'run-finished', runId: input.runId };
    } catch (err) {
      yield {
        type: 'run-error',
        runId: input.runId,
        error: { code: 'hashbrown_error', message: err instanceof Error ? err.message : String(err) },
      };
    }
  }
}

export function provideHashbrownBackend(config: HashbrownBackendConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      const telemetry = inject(AGENTIC_TELEMETRY_SINK);
      const registry = inject(BackendRegistry);
      const def: BackendDef = {
        name: 'hashbrown',
        id: 'hashbrown',
        label: 'Hashbrown',
        capabilities: HASHBROWN_CAPABILITIES,
        factory: () => new HashbrownBackend(config, telemetry),
      };
      registry.register(def);
      registry.setActive('hashbrown');
    }),
  ]);
}
