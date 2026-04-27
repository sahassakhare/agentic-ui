import { GoogleGenAI } from '@google/genai';
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/core';
import type { ServerAgent } from '@maverick/agentic-ui-server';
import { log } from './logger.js';

/**
 * One specialist registered with the orchestrator. The orchestrator never
 * inspects the underlying `agent` — it just forwards events from `agent.run()`
 * verbatim. The `description` and `examples` are seen only by the classifier
 * LLM (and the keyword fallback router).
 *
 * @example
 * {
 *   id: 'bookings',
 *   agent: bookingsGeminiAgent,
 *   description: 'flight search, booking, cancellation, schedule changes',
 *   examples: [
 *     'Book a flight from LAX to JFK on March 5',
 *     'Cancel my booking BK-XXX',
 *   ],
 * }
 */
export interface SubAgentSpec {
  /** Stable id used for routing. Must be unique across registered specialists. */
  readonly id: string;
  /** One-line domain summary shown to the classifier LLM. */
  readonly description: string;
  /** Canonical phrasings that anchor the classifier and seed the keyword fallback. */
  readonly examples: readonly string[];
  /** The actual agent implementation. Anything implementing `ServerAgent` works. */
  readonly agent: ServerAgent;
}

/**
 * Constructor configuration for {@link OrchestratorAgent}.
 *
 * @remarks
 * `apiKey` is required because the classifier issues its own `generateContent`
 * calls separate from any specialist. The `model` parameter affects ONLY the
 * classifier — each specialist agent picks its own model independently.
 */
export interface OrchestratorAgentConfig {
  /** Google Generative AI API key (used by the classifier). */
  readonly apiKey: string;
  /** Classifier model. Defaults to `gemini-2.5-flash`. */
  readonly model?: string;
  /** Specialists the orchestrator can route to. At least one is required. */
  readonly subAgents: readonly SubAgentSpec[];
  /** Optional fallback assistant message when no specialist matches. */
  readonly fallbackMessage?: string;
}

/**
 * Multi-agent orchestrator. Classifies the user's last message via a small
 * LLM call, picks one specialist `ServerAgent`, and forwards its event stream
 * verbatim — so the chat shell continues to receive tool calls, generative-UI
 * widgets, and text deltas exactly as if it had connected directly to the
 * specialist.
 *
 * @remarks
 * **Why intent-classification + forwarding rather than a "delegate-as-tool"
 * approach.** It preserves AG-UI fidelity. Specialists keep their own tools,
 * widgets, and system prompts, and the host app's `ToolRegistry` /
 * `ComponentRegistry` are passed through untouched in `input.tools` /
 * `input.widgets`. The chat shell sees one continuous SSE stream — no tool
 * round-trip layered on top of a tool round-trip.
 *
 * **Resilience model.**
 *  - Sticky-by-thread routing: once a thread is routed to a specialist, the
 *    choice is remembered. The post-tool-call re-run from `runUntilSettled`
 *    short-circuits to that specialist instead of re-classifying.
 *  - Classifier retries: up to 3 attempts with exponential backoff + jitter on
 *    transient errors (429, 5xx, network).
 *  - Keyword fallback: if the LLM is permanently unavailable, route by
 *    counting query tokens against each specialist's `description` +
 *    `examples` corpus. Quota exhaustion never strands a turn.
 *  - Specialist error surfacing: if a forwarded specialist yields RUN_ERROR,
 *    the orchestrator emits a visible "⚠️ The X specialist failed: ..."
 *    message and propagates the error.
 *
 * **Trade-offs.**
 *  - One extra LLM call per fresh user turn (the classifier). Cheap with
 *    `gemini-2.5-flash`; bypass entirely by overriding {@link classify} with
 *    a deterministic router (regex / keyword / `IntentRegistry`).
 *  - The orchestrator commits to one specialist per turn. For multi-step
 *    cross-domain answers, model the cross-domain step as a tool the
 *    specialist owns, or upgrade to a planner-executor.
 *
 * @example
 * ```ts
 * const orch = new OrchestratorAgent('orchestrator', {
 *   apiKey: process.env.GEMINI_KEY!,
 *   subAgents: [
 *     { id: 'bookings', agent: bookingsAgent, description: '...', examples: [...] },
 *     { id: 'loyalty',  agent: loyaltyAgent,  description: '...', examples: [...] },
 *   ],
 * });
 * agents.set('orchestrator', orch);
 * ```
 */
export class OrchestratorAgent implements ServerAgent {
  readonly id: string;
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly subs: ReadonlyMap<string, SubAgentSpec>;
  private readonly fallbackMessage: string;
  /**
   * Per-thread sticky specialist. Once we route a thread to a specialist we
   * remember it so that follow-up runs (especially `runUntilSettled`'s
   * post-tool-call re-run) don't get re-classified on transcript content the
   * classifier can't parse cleanly (tool-result JSON, empty assistant turns
   * carrying tool calls, etc.).
   */
  private readonly threadSpecialist = new Map<string, string>();

  /**
   * @param id     Identifier under which the orchestrator is registered with
   *               the `AgentResolver`. Visible in URLs as `/agents/<id>/run`.
   * @param config See {@link OrchestratorAgentConfig}.
   * @throws Error when `apiKey` is empty or `subAgents` is empty.
   */
  constructor(id = 'orchestrator', config: OrchestratorAgentConfig) {
    if (!config.apiKey) throw new Error('OrchestratorAgent: missing apiKey.');
    if (config.subAgents.length === 0) throw new Error('OrchestratorAgent: at least one sub-agent required.');

    this.id = id;
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
    this.model = config.model ?? 'gemini-2.5-flash';
    this.subs = new Map(config.subAgents.map((s) => [s.id, s]));
    this.fallbackMessage =
      config.fallbackMessage ??
      `I'm not sure which specialist to involve. Try asking about: ${[...this.subs.keys()].join(', ')}.`;
  }

  /**
   * Runs one orchestration turn. Yields AG-UI events that the
   * `agUiRouteHandler` encodes as SSE.
   *
   * @param input  AG-UI run input — `threadId`, `runId`, message history,
   *               available tools/widgets.
   * @param signal Aborts when the client disconnects or the request times out.
   * @returns An async iterable of AG-UI `BaseEvent`s. The orchestrator owns the
   *          outer `RUN_STARTED` / `RUN_FINISHED` (or terminal `RUN_ERROR`); the
   *          forwarded specialist's lifecycle events are stripped.
   *
   * @see {@link classify}              for the LLM-based router (overridable).
   * @see {@link classifyByKeywords}    for the deterministic fallback router.
   */
  async *run(input: RunAgentInput, signal: AbortSignal): AsyncIterable<BaseEvent> {
    yield { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as BaseEvent;

    try {
      const sticky = this.threadSpecialist.get(input.threadId);
      const continuingTurn = isToolFollowUp(input.messages);

      let chosen: string;
      let reason: string;
      let didClassify = false;

      if (continuingTurn && sticky) {
        // `runUntilSettled` has just executed a client-side tool and is
        // re-running the agent to fetch the post-tool text. Keep the sticky
        // specialist — re-classifying on tool-result JSON tends to misroute,
        // and the topic hasn't changed.
        chosen = sticky;
        reason = 'continuing tool chain';
        log.info('orchestrator stick (tool follow-up)', { runId: input.runId, agent: chosen });
      } else {
        // Fresh user turn — classify, but feed the classifier a small recent
        // window so short follow-ups like "2026" don't fall back to "none".
        const window = recentTranscript(input.messages, 6);
        const decision = await this.classify(window, signal, sticky);
        chosen = decision.agent;
        reason = decision.reason;
        didClassify = true;
        log.info('orchestrator routed', {
          runId: input.runId,
          agent: chosen,
          reason,
          windowMessages: window.length,
          sticky: sticky ?? null,
        });
      }

      const sub = this.subs.get(chosen);

      if (!sub) {
        const messageId = `msg-${input.runId}`;
        yield { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' } as BaseEvent;
        yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: this.fallbackMessage } as BaseEvent;
        yield { type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent;
      } else {
        // Remember the choice so later turns in this thread are sticky.
        this.threadSpecialist.set(input.threadId, sub.id);

        // Show the routing banner only when classification ran AND the
        // specialist changed (or this is the first turn). Skip it for tool
        // follow-up runs and for "still the same specialist" turns — the user
        // already saw the banner and reposting it is noise.
        const switched = didClassify && sticky !== sub.id;
        if (switched || (didClassify && !sticky)) {
          const noteId = `route-${input.runId}`;
          yield { type: EventType.TEXT_MESSAGE_START, messageId: noteId, role: 'assistant' } as BaseEvent;
          yield {
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId: noteId,
            delta: `_Routed to **${sub.id}** specialist._\n\n`,
          } as BaseEvent;
          yield { type: EventType.TEXT_MESSAGE_END, messageId: noteId } as BaseEvent;
        }

        // Strip the orchestrator's own routing-annotation messages from history
        // before forwarding to the specialist — they would otherwise appear in
        // the specialist's prompt as past assistant turns ("Routed to bookings
        // specialist.") and confuse it about who said what.
        const cleanedInput = {
          ...input,
          messages: input.messages.filter((m) => !isRoutingAnnotation(m)),
        };

        // Forward the sub-agent's stream. Strip its own RUN_STARTED /
        // RUN_FINISHED — those lifecycle events belong to the orchestrator.
        // RUN_ERROR is captured so we can surface it to the user with
        // context about which specialist failed; without this, the user
        // would see only the routing banner and then dead silence when
        // the specialist hits a quota / network error.
        let subError: BaseEvent | null = null;
        for await (const ev of sub.agent.run(cleanedInput, signal)) {
          if (
            ev.type === EventType.RUN_STARTED ||
            ev.type === EventType.RUN_FINISHED
          ) continue;
          if (ev.type === EventType.RUN_ERROR) {
            subError = ev;
            continue;
          }
          yield ev;
        }

        if (subError) {
          const subMsg = ((subError as unknown as { message?: unknown }).message ?? 'unknown error') as string;
          const errMsgId = `err-${input.runId}`;
          yield { type: EventType.TEXT_MESSAGE_START, messageId: errMsgId, role: 'assistant' } as BaseEvent;
          yield {
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId: errMsgId,
            delta: `_⚠️ The **${sub.id}** specialist failed: ${truncate(String(subMsg), 240)}_`,
          } as BaseEvent;
          yield { type: EventType.TEXT_MESSAGE_END, messageId: errMsgId } as BaseEvent;
          // Forward the RUN_ERROR so any error-aware client surfaces it.
          // RUN_ERROR is terminal in AG-UI — no RUN_FINISHED follows.
          yield subError;
          return;
        }
      }

      yield { type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId } as BaseEvent;
    } catch (err) {
      yield {
        type: EventType.RUN_ERROR,
        ...({ message: err instanceof Error ? err.message : String(err), code: 'orchestrator_error' } as Record<string, unknown>),
      } as BaseEvent;
    }
  }

  /**
   * Pick a specialist for the latest user turn.
   *
   * Strategy:
   *  1. Try the LLM classifier with up to 3 attempts and exponential backoff.
   *     Recognised transients: `429`, `5xx`, `RESOURCE_EXHAUSTED`, network /
   *     timeout. Each attempt sees the recent transcript window plus a hint
   *     that biases toward `currentSpecialist` if one is active.
   *  2. If the LLM is permanently unavailable or returns malformed JSON,
   *     fall through to {@link classifyByKeywords} — a deterministic
   *     token-overlap router that needs no API call.
   *
   * Override this method to plug in a different routing strategy (regex,
   * `IntentRegistry`, embeddings). The rest of the orchestrator only depends
   * on the return shape, so swapping the classifier is a one-method change.
   *
   * @param window             Recent user/assistant transcript window
   *                           (oldest-first), already stripped of the
   *                           orchestrator's own routing-banner messages.
   * @param signal             Abort signal for the run; honoured between
   *                           retry attempts.
   * @param currentSpecialist  The specialist currently active for this thread,
   *                           if any. Passed to the LLM as a "default to
   *                           staying" hint and consumed by the keyword
   *                           fallback when nothing scores > 0.
   * @returns `{ agent, reason }` — `agent` is either a registered sub-agent id
   *          or the literal string `'none'` when no match could be found.
   */
  protected async classify(
    window: ReadonlyArray<{ role: string; text: string }>,
    signal: AbortSignal,
    currentSpecialist?: string,
  ): Promise<{ agent: string; reason: string }> {
    if (window.length === 0) return { agent: 'none', reason: 'empty conversation' };

    const choices = [...this.subs.values()]
      .map((s) => `  - "${s.id}" — ${s.description}\n    Examples: ${s.examples.map((e) => `"${e}"`).join(', ')}`)
      .join('\n');

    const transcript = window.map((m) => `${m.role}: ${m.text}`).join('\n');
    const stickyHint = currentSpecialist
      ? `\nThe conversation is currently being handled by the "${currentSpecialist}" specialist. Default to staying with them unless the user's latest turn clearly switches domain.\n`
      : '';

    const prompt =
      `You are a router. Pick exactly one specialist to handle the LATEST user turn.\n` +
      `Specialists:\n${choices}\n` +
      stickyHint +
      `\nRecent conversation (most recent last):\n${transcript}\n\n` +
      `Rules:\n` +
      `- Stay with the active specialist when the latest turn is a continuation (a date, number,\n` +
      `  yes/no, or short clarification of the previous question).\n` +
      `- Switch specialists only when the latest user turn clearly changes domain.\n` +
      `- If there is an active specialist and the user's intent is ambiguous, prefer keeping them.\n` +
      `- If truly nothing fits and there is no active specialist, use "agent": "none".\n\n` +
      `Reply ONLY with JSON of the form {"agent": "<id>", "reason": "<one short sentence>"}.`;

    // Try the LLM classifier with retry/backoff. On transient errors (429,
    // 5xx, network) wait per attempt; on permanent errors break out and use
    // the deterministic keyword fallback. Either way the orchestrator gets a
    // routing decision — quota exhaustion never strands a turn.
    const MAX_ATTEMPTS = 3;
    const BASE_DELAY_MS = 800;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (signal.aborted) return { agent: 'none', reason: 'aborted' };
      try {
        const response = await this.ai.models.generateContent({
          model: this.model,
          contents: [{ role: 'user', parts: [{ text: prompt }] }] as never,
          config: { abortSignal: signal } as never,
        });
        const text = response.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) break;
        const parsed = JSON.parse(match[0]) as { agent?: string; reason?: string };
        const agent = typeof parsed.agent === 'string' ? parsed.agent : 'none';
        const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
        return { agent, reason };
      } catch (err) {
        const transient = isTransientClassifierError(err);
        log.warn('classifier attempt failed', {
          attempt,
          transient,
          err: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
        });
        if (!transient || attempt === MAX_ATTEMPTS) break;
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 400);
        await sleepWithSignal(delay, signal);
      }
    }

    // LLM unavailable — use keyword scoring against each specialist's
    // description + examples. Lossy but bounded; if the user clearly says
    // "loyalty points", we route to loyalty regardless of API quota state.
    const fallback = this.classifyByKeywords(window, currentSpecialist);
    log.info('classifier fell back to keywords', {
      agent: fallback.agent,
      reason: fallback.reason,
      sticky: currentSpecialist ?? null,
    });
    return fallback;
  }

  /**
   * Deterministic keyword-overlap router used as a fallback when the LLM
   * classifier is unavailable (rate-limited, network outage, malformed output).
   *
   * Algorithm:
   *  1. Take the user's latest turn from the window.
   *  2. Tokenise on word boundaries, lowercase, keep tokens of length >= 3
   *     that aren't stopwords.
   *  3. For each specialist, build a corpus from `description + examples + id`
   *     and count how many query tokens appear in it.
   *  4. Pick the highest-scoring specialist if any score > 0.
   *
   * Fallbacks within the fallback:
   *  - If nothing scores > 0 and there's a sticky specialist, stay with them.
   *  - Otherwise return `'none'` (caller emits the user-facing fallback message).
   *
   * Override this to change the scoring (TF-IDF, BM25, embeddings); the
   * rest of the orchestrator only depends on the return shape.
   *
   * @param window             Same window passed to {@link classify}.
   * @param currentSpecialist  Sticky specialist for the thread, if any.
   * @returns `{ agent, reason }` — `reason` carries the score for telemetry.
   */
  protected classifyByKeywords(
    window: ReadonlyArray<{ role: string; text: string }>,
    currentSpecialist?: string,
  ): { agent: string; reason: string } {
    const lastUserText = [...window].reverse().find((m) => m.role === 'user')?.text ?? '';
    const tokens = (lastUserText.toLowerCase().match(/[a-z][a-z0-9-]+/g) ?? []).filter(
      (t) => t.length >= 3 && !STOPWORDS.has(t),
    );

    let best = { agent: 'none', score: 0 };
    for (const sub of this.subs.values()) {
      const corpus = (sub.description + ' ' + sub.examples.join(' ') + ' ' + sub.id).toLowerCase();
      let score = 0;
      for (const tok of tokens) if (corpus.includes(tok)) score++;
      if (score > best.score) best = { agent: sub.id, score };
    }

    if (best.score > 0) {
      return { agent: best.agent, reason: `keyword fallback (score ${best.score})` };
    }
    if (currentSpecialist) {
      return { agent: currentSpecialist, reason: 'no keyword match — staying with active specialist' };
    }
    return { agent: 'none', reason: 'no keyword match and no active specialist' };
  }
}

/**
 * Take the last N messages, keep only `user` / `assistant` text content, skip
 * the orchestrator's own routing annotations, and return them oldest-first as
 * `{role, text}` pairs. Used to give the classifier enough context so short
 * follow-ups ("2026", "yes please") don't get routed to `none`.
 */
function recentTranscript(
  messages: RunAgentInput['messages'],
  limit: number,
): Array<{ role: string; text: string }> {
  const out: Array<{ role: string; text: string }> = [];
  for (let i = messages.length - 1; i >= 0 && out.length < limit; i--) {
    const m = messages[i];
    if (!m) continue;
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    if (isRoutingAnnotation(m)) continue;
    const text = typeof m.content === 'string' ? m.content.trim() : '';
    if (text === '') continue;
    out.push({ role: m.role, text });
  }
  return out.reverse();
}

/**
 * The orchestrator emits a one-line italic "_Routed to **<id>** specialist._"
 * banner before forwarding a specialist's stream. Recognise it by structure
 * so we can strip it from both the classifier window and the prompt history
 * the specialist sees.
 */
function isRoutingAnnotation(m: { role: string; content?: unknown }): boolean {
  if (m.role !== 'assistant') return false;
  if (typeof m.content !== 'string') return false;
  return /^_Routed to \*\*[^*]+\*\* specialist\._/.test(m.content.trim());
}

/**
 * Recognise classifier errors that are worth retrying:
 *  - HTTP 429 (rate limit / quota exhausted)
 *  - HTTP 5xx
 *  - Network / fetch failures and timeouts
 *
 * Anything else (4xx other than 429, malformed request, auth) is permanent —
 * fall straight through to the keyword fallback.
 */
function isTransientClassifierError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /\b(429|500|502|503|504|temporarily|unavailable|reset|timeout|network|fetch failed|resource_exhausted|quota)\b/.test(msg);
}

/** Truncate to N chars with an ellipsis. Defensive — long Gemini error
 *  bodies include nested JSON we don't want to dump into the chat. */
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Sleep that aborts cleanly when the run is cancelled. */
async function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}

/**
 * Stopwords used by the keyword fallback router. Without these every short
 * filler word like "have" or "many" would inflate the score for whichever
 * specialist's examples happened to use them. Kept tiny — we only need to
 * suppress the most generic English words that show up in routing prompts.
 */
const STOPWORDS = new Set<string>([
  'the', 'and', 'for', 'are', 'with', 'this', 'that', 'have', 'has', 'had',
  'how', 'what', 'when', 'where', 'why', 'who', 'which', 'about', 'from', 'into',
  'can', 'could', 'should', 'would', 'will', 'just', 'they', 'them', 'their',
  'you', 'your', 'yours', 'are', 'was', 'were', 'been', 'being', 'any', 'some',
  'many', 'much', 'one', 'two', 'three', 'please', 'okay', 'yes', 'sure',
]);

/**
 * Detect whether `messages` represents the post-tool-call re-run inside
 * `runUntilSettled` — i.e., the latest message is either a tool result
 * (`role: 'tool'`) or an assistant turn whose only payload is tool calls.
 *
 * Used to skip re-classification: the topic hasn't changed since the previous
 * run, and re-classifying on tool-result JSON tends to misroute.
 */
function isToolFollowUp(messages: RunAgentInput['messages']): boolean {
  if (messages.length === 0) return false;
  const last = messages[messages.length - 1];
  if (!last) return false;
  if (last.role === 'tool') return true;
  if (last.role === 'assistant') {
    const calls = (last as { toolCalls?: unknown[] }).toolCalls;
    const hasToolCalls = Array.isArray(calls) && calls.length > 0;
    const text = typeof last.content === 'string' ? last.content.trim() : '';
    return hasToolCalls && text === '';
  }
  return false;
}
