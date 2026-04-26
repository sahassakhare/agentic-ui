import type { EnvironmentProviders } from '@angular/core';
import {
  provideAgenticBackend,
  type AgenticBackend,
  type AgenticEvent,
  type AgenticRunInput,
  type BackendCapabilities,
} from '../../internal';

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
 * Backend adapter for Hashbrown UI servers. Hashbrown is a model-agnostic LLM
 * abstraction (LiveLoveApp) supporting OpenAI and Google variants — see
 * `flights42`'s `hashbrown/server-{openai,google}.ts` for reference servers.
 *
 * The wire protocol is server-defined; this adapter assumes NDJSON event
 * lines compatible with the {@link AgenticEvent} union (the canonical form).
 * Servers that emit a different shape can either translate at the edge or
 * use this adapter as a base class with overridden `mapServerEvent`.
 */
export class HashbrownBackend implements AgenticBackend {
  readonly id = 'hashbrown';
  readonly capabilities = HASHBROWN_CAPABILITIES;

  constructor(private readonly config: HashbrownBackendConfig) {}

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
          const ev = parseLine(line);
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

function parseLine(line: string): AgenticEvent | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    if (typeof obj['type'] !== 'string') return null;
    return obj as unknown as AgenticEvent;
  } catch {
    return null;
  }
}

export function provideHashbrownBackend(config: HashbrownBackendConfig): EnvironmentProviders {
  return provideAgenticBackend({
    id: 'hashbrown',
    label: 'Hashbrown',
    capabilities: HASHBROWN_CAPABILITIES,
    factory: () => new HashbrownBackend(config),
  });
}
