import { EnvironmentProviders, inject, makeEnvironmentProviders, provideEnvironmentInitializer } from '@angular/core';
import { Chat, decodeFrames } from '@hashbrownai/core';
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
import { serializeToolsForWire } from '../_shared/canonical-messages';
import { convertMessagesToHashbrown } from './hashbrown-converters';
import { HashbrownFrameMapper } from './hashbrown-frame-mapper';

export interface HashbrownBackendConfig {
  /** URL of the Hashbrown completions endpoint (emits length-prefixed frames). */
  readonly url: string;
  /** Optional headers to include on every request. */
  readonly headers?: Record<string, string>;
  /**
   * Hashbrown model id passed through as `CompletionCreateParams.model`
   * (e.g. `gpt-4o`, `gemini-2.0-flash`). The server's configured model
   * adapter (`@hashbrownai/openai`, `@hashbrownai/google`, …) resolves it.
   * Defaults to `gpt-4o`.
   */
  readonly model?: string;
}

export const HASHBROWN_CAPABILITIES: BackendCapabilities = {
  streaming: true,
  clientTools: true,
  generativeUi: true,
  uiActions: false,
};

/**
 * Backend adapter for **Hashbrown** servers — a real client of
 * `@hashbrownai/core`.
 *
 * It speaks Hashbrown's actual wire protocol rather than a look-alike:
 *   - the request body is a `Chat.Api.CompletionCreateParams`
 *     (`operation`, `model`, `system`, `messages`, `tools`), built by
 *     {@link convertMessagesToHashbrown};
 *   - the response is a stream of length-prefixed frames
 *     (`[4-byte BE length][UTF-8 JSON]`) decoded with the SDK's
 *     `decodeFrames`;
 *   - frames are mapped to canonical `AgenticEvent`s by
 *     {@link HashbrownFrameMapper}.
 *
 * `@hashbrownai/core` is an **optional peer dependency** — only apps that
 * call {@link provideHashbrownBackend} pull it into their bundle.
 *
 * The adapter owns the run lifecycle (`run-started` / `run-finished`)
 * so exactly one of each is emitted even on abort or a truncated stream;
 * the frame mapper supplies text + tool-call + error events in between.
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

    const mapper = new HashbrownFrameMapper(input.runId);

    try {
      const { system, messages } = convertMessagesToHashbrown(input.messages);
      const params: Chat.Api.CompletionCreateParams = {
        operation: 'generate',
        model: (this.config.model ?? 'gpt-4o') as Chat.Api.CompletionCreateParams['model'],
        system,
        messages,
        tools: serializeToolsForWire(input.tools) as Chat.Api.Tool[],
        threadId: input.threadId,
      };

      const res = await fetch(this.config.url, {
        method: 'POST',
        signal: input.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/octet-stream',
          ...(this.config.headers ?? {}),
        },
        body: JSON.stringify(params),
      });
      if (!res.ok || !res.body) {
        throw new Error(`Hashbrown request failed: ${res.status} ${res.statusText}`);
      }

      let errored = false;
      for await (const frame of decodeFrames(res.body, { signal: input.signal })) {
        for (const ev of mapper.map(frame)) {
          if (ev.type === 'run-error') errored = true;
          yield ev;
        }
        if (errored) break;
      }

      // Close any tool calls left open by a truncated stream, then end.
      for (const ev of mapper.finalize()) yield ev;
      yield { type: 'run-finished', runId: input.runId };
    } catch (err) {
      // Network / decode failure — a wire-level problem, not a model
      // error. Mirror the other adapters' observability.
      this.telemetry.emit('agentic.run.malformed_event', {
        backendId: this.id,
        threadId: input.threadId,
        runId: input.runId,
        message: err instanceof Error ? err.message : String(err),
      });
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
