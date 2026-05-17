import { EventType, type BaseEvent, type RunAgentInput, type Message } from '@ag-ui/core';
import type { ServerAgent } from './types.js';

export interface EchoAgentConfig {
  /** Word emit delay in ms (simulates streaming). Default 60ms. */
  readonly tickMs?: number;
  /** Optional prefix prepended to the echo, e.g., 'You said: '. */
  readonly prefix?: string;
}

/**
 * Reference {@link ServerAgent} implementation that emits the AG-UI lifecycle
 * for a single text turn and "echoes" the user's last message word-by-word as
 * streaming text deltas. Useful for validating the chat shell + AG-UI adapter
 * without an LLM, and as a template for real agent integrations.
 */
export class EchoAgent implements ServerAgent {
  readonly id: string;
  private readonly tickMs: number;
  private readonly prefix: string;

  constructor(id = 'echo', config: EchoAgentConfig = {}) {
    this.id = id;
    this.tickMs = config.tickMs ?? 60;
    this.prefix = config.prefix ?? 'You said: ';
  }

  async *run(input: RunAgentInput, signal: AbortSignal): AsyncIterable<BaseEvent> {
    yield { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as BaseEvent;

    const lastUser = lastUserMessage(input.messages);
    const reply = `${this.prefix}${lastUser?.content ?? '(silence)'}`;
    const messageId = `msg-${input.runId}`;

    yield { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' } as BaseEvent;

    for (const word of reply.split(/(\s+)/)) {
      if (signal.aborted) break;
      await wait(this.tickMs, signal);
      yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: word } as BaseEvent;
    }

    yield { type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent;
    yield { type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId } as BaseEvent;
  }
}

function lastUserMessage(messages: readonly Message[]): { content: string } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Message & { role?: string; content?: unknown };
    if (m.role === 'user' && typeof m.content === 'string') {
      return { content: m.content };
    }
  }
  return undefined;
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}
