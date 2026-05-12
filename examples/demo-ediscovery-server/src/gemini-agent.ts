import { GoogleGenAI, type FunctionDeclaration } from '@google/genai';
import { EventType, type BaseEvent, type Message, type RunAgentInput, type Tool } from '@ag-ui/core';
import type { ServerAgent } from '@infra-tools/agentic-ui-server';

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
 * @remarks
 * Supports:
 *  - **Streaming text** — Gemini token stream → `TEXT_MESSAGE_CONTENT` deltas.
 *  - **Function / tool calling** — AG-UI `tools[]` → Gemini
 *    `FunctionDeclaration[]`; `functionCall` parts → `TOOL_CALL_START` /
 *    `TOOL_CALL_ARGS` / `TOOL_CALL_END` event triplets.
 *  - **Tool-result feedback** — when the client posts a tool-result message
 *    on the next turn, this agent maps it back to a Gemini `functionResponse`
 *    so the model can compose a natural-language answer.
 *  - **Transient retry** — `openStreamWithRetry` retries the upstream
 *    streaming call up to 3 times with exponential backoff + jitter on
 *    transient errors (429, 5xx, network).
 *
 * Wire multiple instances under different ids and `systemInstruction`s to
 * create per-domain specialists; route between them with
 * {@link OrchestratorAgent}.
 *
 * @example
 * ```ts
 * const bookingsAgent = new GeminiAgent('bookings', {
 *   apiKey: process.env.GEMINI_KEY,
 *   model: 'gemini-2.5-flash',
 *   systemInstruction: 'You are a flight booking specialist...',
 * });
 * agents.set('bookings', bookingsAgent);
 * ```
 */
export class GeminiAgent implements ServerAgent {
  readonly id: string;
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly systemInstruction?: string;

  /**
   * Per-tool-call `thoughtSignature` cache. Gemini 3 / Gemini 3.x preview
   * models attach an opaque `thoughtSignature` to every `functionCall`
   * part they emit; that signature MUST be echoed back on the same
   * functionCall part in subsequent turns or the model returns a 400
   * "Function call is missing a thought_signature" error.
   *
   * AG-UI's `Message.toolCalls` shape has no slot for this Gemini-specific
   * field, so we cache it server-side keyed by the tool-call id and re-inject
   * it in `convertMessagesToGemini` when feeding the conversation back. In a
   * multi-pod deployment this map should move behind a `ThreadStateStore` —
   * scoped to (threadId, toolCallId) — but in-memory is fine for a single-pod
   * demo and any setup using gemini-2.5* (which doesn't require thought
   * signatures at all).
   */
  private readonly thoughtSignatures = new Map<string, string>();

  /**
   * @param id     Agent id used for resolution from URL paths.
   * @param config See {@link GeminiAgentConfig}. The API key may come from
   *               config, `GOOGLE_GENERATIVE_AI_API_KEY`, or `GEMINI_API_KEY`.
   * @throws Error if no API key is available.
   */
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

  /**
   * One full Gemini turn. Yields lifecycle, text-stream, and tool-call events
   * in AG-UI's canonical shape.
   *
   * @param input  AG-UI run input — message history, tools, widgets.
   * @param signal Aborts when the client disconnects or the request times out.
   * @returns AG-UI events: `RUN_STARTED` → `TEXT_MESSAGE_*` and/or
   *          `TOOL_CALL_*` → `RUN_FINISHED` (or terminal `RUN_ERROR`).
   */
  async *run(input: RunAgentInput, signal: AbortSignal): AsyncIterable<BaseEvent> {
    yield { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as BaseEvent;

    try {
      const contents = convertMessagesToGemini(input.messages, this.thoughtSignatures);
      const tools = convertToolsToGemini(input.tools);
      // Capability M1 R4 — read RunAgentInput.state and fold it into
      // the system instruction so the agent's natural-language
      // responses reflect the active context (persona, matter, route).
      // NOT a security boundary — that's setScopePolicy on the client.
      // See ADR-013.
      const contextBlock = formatContextBlock(input.state);
      const systemInstruction = contextBlock
        ? `${this.systemInstruction ?? ''}\n\n${contextBlock}`.trim()
        : this.systemInstruction;

      const stream = await this.openStreamWithRetry(contents, tools, signal, systemInstruction);

      const messageId = `msg-${input.runId}`;
      let textStarted = false;
      const pendingCalls: PendingFunctionCall[] = [];
      // Per-tool-name dedup: Gemini can emit the same tool twice in one turn
      // — sometimes with identical args (sampling noise), sometimes with
      // refined args (eager call then refined call after seeing its own
      // first call). The shell would then render duplicate widgets and re-
      // run the handler, so we keep only the FIRST call per tool name in
      // this turn. The shared system rule "Call each tool AT MOST ONCE per
      // user request" makes this the contract; any genuine multi-step work
      // happens on subsequent turns once the tool result lands.
      const seenToolNames = new Set<string>();

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

            // Skip if we've already emitted this tool name in this turn.
            if (seenToolNames.has(name)) continue;
            seenToolNames.add(name);

            pendingCalls.push({ id: callId, name, args });

            // Gemini 3 attaches `thoughtSignature` on the same Part as the
            // functionCall. Capture it here so we can echo it back on the
            // next turn — see this.thoughtSignatures docstring.
            const ts = (part as { thoughtSignature?: string }).thoughtSignature;
            if (typeof ts === 'string' && ts.length > 0) {
              this.thoughtSignatures.set(callId, ts);
            }

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

  /**
   * Retry transient Gemini errors (429 quota, 503 unavailable, 500, network)
   * with exponential backoff + jitter. Bails on user abort and on permanent
   * errors (400 invalid arg, 401/403 auth, 404 not found).
   */
  private async openStreamWithRetry(
    contents: ReturnType<typeof convertMessagesToGemini>,
    tools: FunctionDeclaration[],
    signal: AbortSignal,
    systemInstruction: string | undefined = this.systemInstruction,
  ): Promise<AsyncIterable<{ candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { id?: string; name?: string; args?: unknown }}>}}>}>> {
    const MAX_ATTEMPTS = 4;
    const BASE_DELAY_MS = 500;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (signal.aborted) throw new Error('aborted');
      try {
        return await this.ai.models.generateContentStream({
          model: this.model,
          contents: contents as never,
          config: {
            systemInstruction,
            ...(tools.length > 0 ? { tools: [{ functionDeclarations: tools }] } : {}),
            abortSignal: signal,
          } as never,
        }) as never;
      } catch (err) {
        lastErr = err;
        if (!isTransient(err) || attempt === MAX_ATTEMPTS) throw err;
        // Honor Gemini's RetryInfo when present (429s carry "retry in 39s"
        // etc. — exponential backoff alone undershoots that by 10x).
        const hinted = parseRetryDelayMs(err);
        const fallback = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
        // Cap at 65s so a single retry still fits within the per-test
        // timeout; rolling-minute window will have cleared by then.
        const delay = hinted !== null ? Math.min(hinted + 500, 65_000) : fallback;
        await sleep(delay, signal);
      }
    }
    throw lastErr;
  }
}

/**
 * Format the host's reasoning state (M1 R4 — ADR-013) into a short
 * natural-language paragraph that gets prepended to the system
 * instruction. The agent reads this on every turn within a run.
 *
 * Returns empty string when state is missing / empty so callers
 * can short-circuit without conditional concatenation.
 *
 * Specific to this demo's state shape (`persona`, `matter`,
 * `activeRoute`). Other servers can format their own state shape
 * however they prefer — the runtime puts state on the wire; what
 * the server does with it is the server's choice.
 */
function formatContextBlock(state: unknown): string {
  if (!state || typeof state !== 'object') return '';
  const s = state as Record<string, unknown>;

  const parts: string[] = [];
  if (typeof s['persona'] === 'string' && s['persona']) {
    parts.push(`persona = ${s['persona']}`);
  }
  const matter = s['matter'];
  if (matter && typeof matter === 'object') {
    const m = matter as Record<string, unknown>;
    const id = typeof m['id'] === 'string' ? m['id'] : null;
    const type = typeof m['type'] === 'string' ? m['type'] : null;
    if (id && type) parts.push(`matter = ${id} (${type})`);
    else if (id) parts.push(`matter = ${id}`);
  }
  if (typeof s['activeRoute'] === 'string' && s['activeRoute']) {
    parts.push(`active route = ${s['activeRoute']}`);
  }
  if (parts.length === 0) return '';
  return `Current context: ${parts.join(', ')}. Phrase responses appropriately for this context, but do not relax tool-permission rules — that's enforced separately by the host.`;
}

function isTransient(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /\b(429|500|502|503|504|temporarily|unavailable|reset|timeout|network|fetch failed)\b/.test(msg);
}

/**
 * Extract the `retryDelay` value from a Gemini 429 response body.
 * The error JSON nests `details[].@type ===
 * "type.googleapis.com/google.rpc.RetryInfo"` with `retryDelay: "39s"`.
 * Returns the delay in milliseconds, or null if not present / not parseable.
 */
function parseRetryDelayMs(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (!m) return null;
  const seconds = Number(m[1]);
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : null;
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
  });
}

/**
 * Convert AG-UI `Message[]` to Gemini `contents` array.
 *
 * @param messages           AG-UI message history.
 * @param thoughtSignatures  Optional `Map<toolCallId, signature>` populated
 *                           from streaming responses. When present, each
 *                           `functionCall` Part the converter emits is
 *                           tagged with its matching `thoughtSignature` so
 *                           Gemini 3.x preview models accept the follow-up
 *                           turn. Older models ignore the field.
 */
function convertMessagesToGemini(
  messages: readonly Message[],
  thoughtSignatures?: ReadonlyMap<string, string>,
): { role: string; parts: Array<{ text?: string; functionCall?: unknown; functionResponse?: unknown; thoughtSignature?: string }> }[] {
  // Build tool-call-id → function-name from prior assistant turns. Gemini's
  // `functionResponse.name` MUST be the original function name (`bookFlight`),
  // not the AG-UI tool-call id (`fc-0-run-…`); using the id silently breaks
  // the model's notion that its own call was answered, which causes
  // duplicate tool calls.
  const idToName = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    const tcs = (m as Message & { toolCalls?: Array<{ id: string; function?: { name?: string } }> }).toolCalls ?? [];
    for (const tc of tcs) {
      const name = tc.function?.name;
      if (tc.id && typeof name === 'string' && name !== '') idToName.set(tc.id, name);
    }
  }

  const out: { role: string; parts: Array<{ text?: string; functionCall?: unknown; functionResponse?: unknown; thoughtSignature?: string }> }[] = [];
  for (const m of messages) {
    if (m.role === 'user' && typeof m.content === 'string') {
      out.push({ role: 'user', parts: [{ text: m.content }] });
    } else if (m.role === 'assistant') {
      const parts: Array<{ text?: string; functionCall?: unknown; thoughtSignature?: string }> = [];
      if (m.content) parts.push({ text: typeof m.content === 'string' ? m.content : '' });
      const tcs = (m as Message & { toolCalls?: Array<{ id: string; function?: { name?: string; arguments?: string } }> }).toolCalls ?? [];
      for (const tc of tcs) {
        const sig = thoughtSignatures?.get(tc.id);
        const part: { functionCall: unknown; thoughtSignature?: string } = (() => {
          try {
            return { functionCall: { name: tc.function?.name ?? '', args: JSON.parse(tc.function?.arguments ?? '{}') } };
          } catch {
            return { functionCall: { name: tc.function?.name ?? '', args: {} } };
          }
        })();
        if (sig) part.thoughtSignature = sig;
        parts.push(part);
      }
      if (parts.length > 0) out.push({ role: 'model', parts });
    } else if (m.role === 'tool') {
      const toolCallId = (m as Message & { toolCallId?: string }).toolCallId;
      // Resolve back to the original function name; fall back to the id only
      // if we can't match (defensive — should never happen in a normal flow).
      const fnName = (toolCallId && idToName.get(toolCallId)) || toolCallId || 'unknown';
      let response: unknown;
      try { response = JSON.parse(typeof m.content === 'string' ? m.content : ''); } catch { response = m.content; }
      out.push({
        // Gemini expects `role: 'function'` for function responses.
        role: 'function',
        parts: [{ functionResponse: { name: fnName, response: { result: response } } }],
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
