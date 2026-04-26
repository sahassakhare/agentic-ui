import { GoogleGenAI, type FunctionDeclaration } from '@google/genai';
import { EventType, type BaseEvent, type Message, type RunAgentInput, type Tool } from '@ag-ui/core';
import type { ServerAgent } from '@maverick/agentic-ui-server';

export interface GeminiAgentConfig {
  /** Google Generative AI API key. Defaults to env GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY. */
  readonly apiKey?: string;
  /** Model id; defaults to `gemini-2.5-flash` (fast tool-calling model). */
  readonly model?: string;
  /** Optional system instruction prepended to every conversation. */
  readonly systemInstruction?: string;
}

interface PendingFunctionCall {
  readonly id: string;
  readonly name: string;
  args: Record<string, unknown>;
}

/**
 * Server-side AG-UI agent backed by Google Gemini. Translates AG-UI's
 * `RunAgentInput` ⇄ Gemini's chat API and emits AG-UI `BaseEvent`s for the
 * route handler to encode as SSE.
 *
 * Supports:
 *  - Streaming text (Gemini token stream → TEXT_MESSAGE_CONTENT deltas)
 *  - Function/tool calling (AG-UI tools[] → Gemini function declarations;
 *    function-call response → TOOL_CALL_* events)
 *  - Tool-result feedback (a follow-up turn after the client returns a
 *    tool result, so Gemini can compose a natural-language answer)
 */
export class GeminiAgent implements ServerAgent {
  readonly id: string;
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly systemInstruction?: string;

  constructor(id = 'gemini', config: GeminiAgentConfig = {}) {
    const apiKey = config.apiKey ?? process.env['GOOGLE_GENERATIVE_AI_API_KEY'] ?? process.env['GEMINI_API_KEY'];
    if (!apiKey) {
      throw new Error(
        'GeminiAgent: missing API key. Set GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY env var, or pass {apiKey} in config.',
      );
    }
    this.ai = new GoogleGenAI({ apiKey });
    this.model = config.model ?? 'gemini-2.5-flash';
    this.systemInstruction = config.systemInstruction;
    this.id = id;
  }

  async *run(input: RunAgentInput, signal: AbortSignal): AsyncIterable<BaseEvent> {
    yield { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as BaseEvent;

    try {
      const contents = convertMessagesToGemini(input.messages);
      const tools = convertToolsToGemini(input.tools);

      const stream = await this.ai.models.generateContentStream({
        model: this.model,
        contents: contents as never,
        config: {
          systemInstruction: this.systemInstruction,
          ...(tools.length > 0 ? { tools: [{ functionDeclarations: tools }] } : {}),
          abortSignal: signal,
        } as never,
      });

      const messageId = `msg-${input.runId}`;
      let textStarted = false;
      const pendingCalls: PendingFunctionCall[] = [];

      for await (const chunk of stream) {
        if (signal.aborted) break;

        // Each chunk may carry text and/or function calls.
        const candidate = chunk.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];

        for (const part of parts) {
          if (typeof part.text === 'string' && part.text.length > 0) {
            if (!textStarted) {
              yield { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' } as BaseEvent;
              textStarted = true;
            }
            yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: part.text } as BaseEvent;
          }
          if (part.functionCall) {
            const callId = part.functionCall.id ?? `fc-${pendingCalls.length}-${input.runId}`;
            const name = part.functionCall.name ?? '';
            const args = (part.functionCall.args as Record<string, unknown> | undefined) ?? {};
            pendingCalls.push({ id: callId, name, args });

            yield { type: EventType.TOOL_CALL_START, toolCallId: callId, toolCallName: name, parentMessageId: messageId } as BaseEvent;
            yield { type: EventType.TOOL_CALL_ARGS, toolCallId: callId, delta: JSON.stringify(args) } as BaseEvent;
            yield { type: EventType.TOOL_CALL_END, toolCallId: callId } as BaseEvent;
          }
        }
      }

      if (textStarted) {
        yield { type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent;
      }

      yield { type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId } as BaseEvent;
    } catch (err) {
      yield {
        type: EventType.RUN_ERROR,
        ...({ message: err instanceof Error ? err.message : String(err), code: 'gemini_error' } as Record<string, unknown>),
      } as BaseEvent;
    }
  }
}

/** Convert AG-UI `Message[]` to Gemini `contents` array. */
function convertMessagesToGemini(messages: readonly Message[]): { role: string; parts: Array<{ text?: string; functionCall?: unknown; functionResponse?: unknown }> }[] {
  const out: { role: string; parts: Array<{ text?: string; functionCall?: unknown; functionResponse?: unknown }> }[] = [];
  for (const m of messages) {
    if (m.role === 'user' && typeof m.content === 'string') {
      out.push({ role: 'user', parts: [{ text: m.content }] });
    } else if (m.role === 'assistant') {
      const parts: Array<{ text?: string; functionCall?: unknown }> = [];
      if (m.content) parts.push({ text: typeof m.content === 'string' ? m.content : '' });
      const tcs = (m as Message & { toolCalls?: Array<{ id: string; function?: { name?: string; arguments?: string } }> }).toolCalls ?? [];
      for (const tc of tcs) {
        try {
          parts.push({ functionCall: { name: tc.function?.name ?? '', args: JSON.parse(tc.function?.arguments ?? '{}') } });
        } catch {
          parts.push({ functionCall: { name: tc.function?.name ?? '', args: {} } });
        }
      }
      if (parts.length > 0) out.push({ role: 'model', parts });
    } else if (m.role === 'tool') {
      const toolCallId = (m as Message & { toolCallId?: string }).toolCallId;
      let response: unknown;
      try { response = JSON.parse(typeof m.content === 'string' ? m.content : ''); } catch { response = m.content; }
      out.push({
        role: 'user',
        parts: [{ functionResponse: { name: toolCallId ?? 'unknown', response: { result: response } } }],
      });
    }
  }
  return out;
}

/** Convert AG-UI `Tool[]` to Gemini `FunctionDeclaration[]`. */
function convertToolsToGemini(tools: readonly Tool[]): FunctionDeclaration[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: (t.parameters ?? { type: 'object', properties: {} }) as FunctionDeclaration['parameters'],
  }));
}
