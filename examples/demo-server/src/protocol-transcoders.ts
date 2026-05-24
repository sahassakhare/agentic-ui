import { EventType, type BaseEvent, type Message, type RunAgentInput, type Tool } from '@ag-ui/core';
import type { Frame } from '@hashbrownai/core';

/**
 * Transcoders that let the Hashbrown + A2UI reference servers reuse the
 * SAME `GeminiAgent` the AG-UI route runs — so all three protocols stream
 * REAL LLM output and REAL tool calls, not an echo.
 *
 * The agent emits AG-UI `BaseEvent`s. These helpers (a) adapt each
 * protocol's POST body into the agent's `RunAgentInput`, and (b) transcode
 * the agent's `BaseEvent` stream into the target wire:
 *   - A2UI    → canonical `AgenticEvent` objects (NDJSON), the shape the
 *               A2UI client adapter validates.
 *   - Hashbrown → `@hashbrownai/core` `Frame`s, the shape its client decodes.
 *
 * Why this is enough to render the flight card on every protocol: the
 * `bookFlight` tool's HANDLER runs CLIENT-SIDE (it's registered in the
 * browser). The server only has to emit a real tool *call*; the client
 * executes it, gets `{ components: [...] }`, and the chat shell renders the
 * widget — identically for AG-UI, Hashbrown, and A2UI.
 */

// ── Request body → RunAgentInput ────────────────────────────────────────────

/** Flatten string | multipart content to a plain string. */
function flatten(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text) : ''))
      .join('');
  }
  return '';
}

/** lib `AgenticMessage[]` (A2UI body) → AG-UI `Message[]`. */
function agenticMessagesToAgUi(messages: readonly Record<string, unknown>[]): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    const role = m['role'];
    const id = String(m['id'] ?? `m-${out.length}`);
    const text = flatten(m['content']);
    const toolCalls = (m['toolCalls'] as Array<Record<string, unknown>> | undefined) ?? [];
    if (role === 'user') {
      out.push({ id, role: 'user', content: text } as Message);
    } else if (role === 'assistant') {
      out.push({
        id,
        role: 'assistant',
        content: text || undefined,
        toolCalls: toolCalls.length
          ? toolCalls.map((tc) => ({
              id: String(tc['toolCallId']),
              type: 'function' as const,
              function: {
                name: String(tc['name']),
                arguments: typeof tc['args'] === 'string' ? (tc['args'] as string) : JSON.stringify(tc['args'] ?? {}),
              },
            }))
          : undefined,
      } as Message);
      // Tool results carried on the assistant's tool calls become tool messages.
      for (const tc of toolCalls) {
        if (tc['result'] !== undefined) {
          out.push({
            id: `${String(tc['toolCallId'])}-result`,
            role: 'tool',
            toolCallId: String(tc['toolCallId']),
            content: typeof tc['result'] === 'string' ? (tc['result'] as string) : JSON.stringify(tc['result']),
          } as Message);
        }
      }
    } else if (role === 'system') {
      out.push({ id, role: 'system', content: text } as Message);
    } else if (role === 'tool') {
      out.push({ id, role: 'tool', toolCallId: id, content: text } as Message);
    }
  }
  return out;
}

/** Hashbrown `Chat.Api.Message[]` → AG-UI `Message[]`. */
function hashbrownMessagesToAgUi(messages: readonly Record<string, unknown>[]): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    const role = m['role'];
    const id = `m-${out.length}`;
    if (role === 'user') {
      out.push({ id, role: 'user', content: flatten(m['content']) } as Message);
    } else if (role === 'assistant') {
      const toolCalls = (m['toolCalls'] as Array<Record<string, unknown>> | undefined) ?? [];
      out.push({
        id,
        role: 'assistant',
        content: typeof m['content'] === 'string' ? (m['content'] as string) : undefined,
        toolCalls: toolCalls.length
          ? toolCalls.map((tc) => ({
              id: String(tc['id']),
              type: 'function' as const,
              function: (tc['function'] as { name?: string; arguments?: string }) ?? { name: '', arguments: '{}' },
            }))
          : undefined,
      } as Message);
    } else if (role === 'tool') {
      // Hashbrown carries the result as a PromiseSettledResult.
      const c = m['content'] as { status?: string; value?: unknown; reason?: unknown } | undefined;
      const value = c?.status === 'fulfilled' ? c.value : c?.reason;
      out.push({
        id,
        role: 'tool',
        toolCallId: String(m['toolCallId'] ?? id),
        content: typeof value === 'string' ? value : JSON.stringify(value ?? null),
      } as Message);
    }
  }
  return out;
}

/** A2UI POST body → `RunAgentInput`. */
export function a2uiBodyToRunInput(body: Record<string, unknown>): RunAgentInput {
  return {
    threadId: String(body['threadId'] ?? `thread-${Date.now()}`),
    runId: String(body['runId'] ?? `run-${Date.now()}`),
    messages: agenticMessagesToAgUi((body['messages'] as Array<Record<string, unknown>>) ?? []),
    tools: ((body['tools'] as Tool[]) ?? []),
    state: (body['state'] as Record<string, unknown>) ?? {},
    context: [],
    forwardedProps: {},
  };
}

/** Hashbrown `CompletionCreateParams` POST body → `RunAgentInput`. */
export function hashbrownParamsToRunInput(body: Record<string, unknown>): RunAgentInput {
  return {
    threadId: String(body['threadId'] ?? `thread-${Date.now()}`),
    runId: `run-${Date.now()}`,
    messages: hashbrownMessagesToAgUi((body['messages'] as Array<Record<string, unknown>>) ?? []),
    tools: ((body['tools'] as Tool[]) ?? []),
    state: {},
    context: [],
    forwardedProps: {},
  };
}

// ── BaseEvent → target wire ─────────────────────────────────────────────────

/** AG-UI `BaseEvent` → canonical `AgenticEvent` objects (A2UI NDJSON). */
export function aguiEventToCanonical(ev: BaseEvent, ctx: { threadId: string; runId: string }): Array<Record<string, unknown>> {
  const e = ev as BaseEvent & Record<string, unknown>;
  switch (ev.type) {
    case EventType.RUN_STARTED:
      return [{ type: 'run-started', threadId: ctx.threadId, runId: ctx.runId }];
    case EventType.RUN_FINISHED:
      return [{ type: 'run-finished', runId: ctx.runId }];
    case EventType.RUN_ERROR:
      return [{ type: 'run-error', runId: ctx.runId, error: { code: String(e['code'] ?? 'agent_error'), message: String(e['message'] ?? 'agent error') } }];
    case EventType.TEXT_MESSAGE_CONTENT:
      return [{ type: 'text-delta', messageId: String(e['messageId']), delta: String(e['delta']) }];
    case EventType.TEXT_MESSAGE_END:
      return [{ type: 'text-end', messageId: String(e['messageId']) }];
    case EventType.TOOL_CALL_START:
      return [{ type: 'tool-call-start', toolCallId: String(e['toolCallId']), name: String(e['toolCallName']) }];
    case EventType.TOOL_CALL_ARGS:
      return [{ type: 'tool-call-args', toolCallId: String(e['toolCallId']), delta: String(e['delta']) }];
    case EventType.TOOL_CALL_END:
      return [{ type: 'tool-call-end', toolCallId: String(e['toolCallId']) }];
    default:
      return [];
  }
}

/**
 * AG-UI `BaseEvent` → Hashbrown `Frame`s. Stateful: assigns a stable
 * `index` per tool call so the client's frame decoder accumulates the
 * streamed `tool_calls` correctly.
 */
export class AgUiToHashbrownFrames {
  private readonly toolIndex = new Map<string, number>();

  frames(ev: BaseEvent): Frame[] {
    const e = ev as BaseEvent & Record<string, unknown>;
    switch (ev.type) {
      case EventType.RUN_STARTED:
        return [{ type: 'generation-start' }];
      case EventType.TEXT_MESSAGE_CONTENT:
        return [{ type: 'generation-chunk', chunk: { choices: [{ index: 0, delta: { content: String(e['delta']) }, finishReason: null }] } }];
      case EventType.TOOL_CALL_START: {
        const id = String(e['toolCallId']);
        const index = this.toolIndex.size;
        this.toolIndex.set(id, index);
        return [{
          type: 'generation-chunk',
          chunk: { choices: [{ index: 0, delta: { toolCalls: [{ index, id, type: 'function', function: { name: String(e['toolCallName']), arguments: '' } }] }, finishReason: null }] },
        }];
      }
      case EventType.TOOL_CALL_ARGS: {
        const index = this.toolIndex.get(String(e['toolCallId'])) ?? 0;
        return [{
          type: 'generation-chunk',
          chunk: { choices: [{ index: 0, delta: { toolCalls: [{ index, function: { arguments: String(e['delta']) } }] }, finishReason: null }] },
        }];
      }
      case EventType.RUN_FINISHED:
        return [{ type: 'generation-finish' }];
      case EventType.RUN_ERROR:
        return [{ type: 'generation-error', error: String(e['message'] ?? 'agent error') }];
      default:
        // TOOL_CALL_END, TEXT_MESSAGE_START/END — no direct Hashbrown frame;
        // the client closes tool calls on generation-finish.
        return [];
    }
  }
}
