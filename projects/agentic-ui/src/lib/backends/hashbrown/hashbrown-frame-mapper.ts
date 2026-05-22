import type { Chat, Frame } from '@hashbrownai/core';
import type { AgenticEvent } from '../../internal';

/**
 * Maps Hashbrown `Frame`s to library `AgenticEvent`s.
 *
 * Hashbrown streams completions as frames (`generation-start`,
 * `generation-chunk`, `generation-finish`, `generation-error`). A
 * `generation-chunk` carries an OpenAI-style `CompletionChunk` whose
 * `choices[].delta` holds text content and *partial* tool calls
 * addressed by `index`. Tool-call name + id arrive on the first delta
 * for an index; argument JSON arrives incrementally across deltas.
 *
 * This mapper is **stateful** for the duration of one run: it tracks
 * which tool-call indexes have been opened so it emits exactly one
 * `tool-call-start` per call, streams `tool-call-args`, and closes every
 * open call with `tool-call-end` when the generation finishes.
 *
 * The mapper does NOT emit `run-started`/`run-finished` for the
 * `generation-start`/`generation-finish` frames — the backend owns the
 * run lifecycle so it can guarantee exactly one of each even on abort or
 * a truncated stream. `generation-finish` instead flushes open tool
 * calls; `generation-error` maps to `run-error`.
 */
export class HashbrownFrameMapper {
  /** Stable id per generation, used for text-delta grouping. */
  private readonly messageId: string;
  /** index → toolCallId for tool calls already announced via start. */
  private readonly openToolCalls = new Map<number, string>();

  constructor(
    private readonly runId: string,
  ) {
    this.messageId = `hb-${runId}`;
  }

  /** Map one frame to zero or more events. */
  map(frame: Frame): AgenticEvent[] {
    switch (frame.type) {
      case 'generation-chunk':
        return this.mapChunk(frame.chunk);
      case 'generation-error':
        return [{
          type: 'run-error',
          runId: this.runId,
          error: { code: 'hashbrown_generation_error', message: frame.error },
        }];
      case 'generation-finish':
        return this.flushOpenToolCalls();
      default:
        // generation-start, thread-load/save frames — not surfaced.
        return [];
    }
  }

  /** Emit `tool-call-end` for any calls still open at end-of-stream. */
  finalize(): AgenticEvent[] {
    return this.flushOpenToolCalls();
  }

  private mapChunk(chunk: Chat.Api.CompletionChunk): AgenticEvent[] {
    const events: AgenticEvent[] = [];
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta;
      if (!delta) continue;

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        events.push({ type: 'text-delta', messageId: this.messageId, delta: delta.content });
      }

      for (const tc of delta.toolCalls ?? []) {
        if (tc?.index === undefined || tc.index === null) continue;
        const index = tc.index;
        const existing = this.openToolCalls.get(index);
        if (existing === undefined) {
          // First delta for this index — needs an id + name to open.
          const toolCallId = tc.id ?? `hb-tool-${this.runId}-${index}`;
          this.openToolCalls.set(index, toolCallId);
          events.push({ type: 'tool-call-start', toolCallId, name: tc.function?.name ?? '' });
          if (tc.function?.arguments) {
            events.push({ type: 'tool-call-args', toolCallId, delta: tc.function.arguments });
          }
        } else if (tc.function?.arguments) {
          events.push({ type: 'tool-call-args', toolCallId: existing, delta: tc.function.arguments });
        }
      }
    }
    return events;
  }

  private flushOpenToolCalls(): AgenticEvent[] {
    if (this.openToolCalls.size === 0) return [];
    const events: AgenticEvent[] = [...this.openToolCalls.values()].map((toolCallId) => ({
      type: 'tool-call-end' as const,
      toolCallId,
    }));
    this.openToolCalls.clear();
    return events;
  }
}
