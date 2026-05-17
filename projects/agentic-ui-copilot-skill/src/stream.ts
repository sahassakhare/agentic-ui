import type { SkillEvent } from './types.js';

/**
 * Encode an internal `SkillEvent` into the OpenAI-shaped Chat
 * Completion delta chunk that GitHub Copilot Chat expects on the
 * `data:` lines of the SSE stream. We deliberately keep the chunk
 * shape minimal -- only fields Copilot actually reads:
 *
 *   - role / content for text deltas
 *   - tool_calls[] for tool invocations
 *   - finish_reason on the terminal chunk
 *
 * Each chunk is prefixed with `data: ` and terminated with a blank
 * line per the SSE spec. The stream ends with `data: [DONE]\n\n`.
 */
const DEFAULT_MODEL = 'copilot-extension';
const NEWLINE = '\n\n';

interface OpenAIChunk {
  readonly id: string;
  readonly object: 'chat.completion.chunk';
  readonly created: number;
  readonly model: string;
  readonly choices: ReadonlyArray<{
    readonly index: number;
    readonly delta: {
      readonly role?: 'assistant';
      readonly content?: string;
      readonly tool_calls?: ReadonlyArray<{
        readonly index: number;
        readonly id?: string;
        readonly type?: 'function';
        readonly function?: { readonly name?: string; readonly arguments?: string };
      }>;
    };
    readonly finish_reason: string | null;
  }>;
}

export function encodeAsChunk(
  event: SkillEvent,
  opts: { runId: string; model?: string; idx: number },
): string {
  const base: OpenAIChunk = {
    id: opts.runId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: opts.model ?? DEFAULT_MODEL,
    choices: [chunkChoiceFor(event, opts.idx)],
  };
  return `data: ${JSON.stringify(base)}${NEWLINE}`;
}

function chunkChoiceFor(event: SkillEvent, idx: number): OpenAIChunk['choices'][0] {
  switch (event.type) {
    case 'text-delta':
      return {
        index: 0,
        delta: { role: idx === 0 ? 'assistant' : undefined, content: event.delta },
        finish_reason: null,
      };
    case 'tool-call':
      return {
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: event.toolCallId,
            type: 'function',
            function: { name: event.name, arguments: JSON.stringify(event.args) },
          }],
        },
        finish_reason: null,
      };
    case 'tool-result':
      // Copilot doesn't surface tool results back to the model
      // mid-stream -- adopters typically wrap the result into a
      // following text-delta. We emit an empty content chunk so the
      // operator at least sees movement.
      return {
        index: 0,
        delta: { content: '' },
        finish_reason: null,
      };
    case 'finish':
      return {
        index: 0,
        delta: {},
        finish_reason: event.reason ?? 'stop',
      };
  }
}

/**
 * Drive a `SkillHandler`'s event stream into a write callback.
 * Generic over the underlying transport -- the example Express
 * server passes `res.write.bind(res)`. Yields the terminal
 * `[DONE]` marker per the SSE spec.
 */
export async function streamCopilotResponse(
  events: AsyncIterable<SkillEvent>,
  write: (chunk: string) => void,
  opts: { runId: string; model?: string },
): Promise<void> {
  let idx = 0;
  let sawFinish = false;
  for await (const event of events) {
    write(encodeAsChunk(event, { ...opts, idx }));
    idx++;
    if (event.type === 'finish') {
      sawFinish = true;
      break;
    }
  }
  if (!sawFinish) {
    write(encodeAsChunk({ type: 'finish', reason: 'stop' }, { ...opts, idx }));
  }
  write(`data: [DONE]${NEWLINE}`);
}
