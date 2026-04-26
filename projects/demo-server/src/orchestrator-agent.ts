import { GoogleGenAI } from '@google/genai';
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/core';
import type { ServerAgent } from '@maverick/agentic-ui-server';
import { log } from './logger.js';

export interface SubAgentSpec {
  /** Sub-agent id; must match a key the orchestrator's classifier can return. */
  readonly id: string;
  /** One-line description shown to the classifier LLM. */
  readonly description: string;
  /** A few canonical phrasings to anchor the classifier. */
  readonly examples: readonly string[];
  readonly agent: ServerAgent;
}

export interface OrchestratorAgentConfig {
  readonly apiKey: string;
  /** Classifier model. Defaults to `gemini-2.5-flash`. */
  readonly model?: string;
  /** Sub-agents the orchestrator can route to. */
  readonly subAgents: readonly SubAgentSpec[];
  /** Optional fallback message when no sub-agent matches. */
  readonly fallbackMessage?: string;
}

/**
 * Multi-agent orchestrator. Classifies the user's last message via a small
 * LLM call, picks one specialist `ServerAgent`, and forwards its event stream
 * verbatim — so the chat shell continues to receive tool calls, generative-UI
 * widgets, and text deltas exactly as if it had connected directly to the
 * specialist.
 *
 * Why intent-classification + forwarding rather than a "delegate-as-tool"
 * approach: it preserves AG-UI fidelity. Specialists keep their own tools,
 * widgets, and system prompts, and the host app's `ToolRegistry` /
 * `ComponentRegistry` are passed through untouched in `input.tools` /
 * `input.widgets`.
 *
 * Trade-offs:
 *  - One extra LLM call per turn (the classifier). Cheap with `gemini-2.5-flash`,
 *    but if you need it free, swap in a regex / keyword router by re-implementing
 *    {@link classify}.
 *  - The orchestrator commits to one specialist per turn. For multi-step
 *    cross-domain answers, model the cross-domain step as a tool the specialist
 *    owns, or upgrade to a planner-executor (a future enhancement).
 */
export class OrchestratorAgent implements ServerAgent {
  readonly id: string;
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly subs: ReadonlyMap<string, SubAgentSpec>;
  private readonly fallbackMessage: string;

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

  async *run(input: RunAgentInput, signal: AbortSignal): AsyncIterable<BaseEvent> {
    yield { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as BaseEvent;

    try {
      const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
      const userText = typeof lastUser?.content === 'string' ? lastUser.content : '';

      const decision = await this.classify(userText, signal);
      log.info('orchestrator routed', { runId: input.runId, agent: decision.agent, reason: decision.reason });

      const sub = this.subs.get(decision.agent);

      if (!sub) {
        const messageId = `msg-${input.runId}`;
        yield { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' } as BaseEvent;
        yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: this.fallbackMessage } as BaseEvent;
        yield { type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent;
      } else {
        // Annotate the routing decision so the user sees who's answering.
        const noteId = `route-${input.runId}`;
        yield { type: EventType.TEXT_MESSAGE_START, messageId: noteId, role: 'assistant' } as BaseEvent;
        yield {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: noteId,
          delta: `_Routed to **${sub.id}** specialist._\n\n`,
        } as BaseEvent;
        yield { type: EventType.TEXT_MESSAGE_END, messageId: noteId } as BaseEvent;

        // Forward the sub-agent's stream. Strip its own RUN_STARTED / RUN_FINISHED /
        // RUN_ERROR — those lifecycle events belong to the orchestrator.
        for await (const ev of sub.agent.run(input, signal)) {
          if (
            ev.type === EventType.RUN_STARTED ||
            ev.type === EventType.RUN_FINISHED ||
            ev.type === EventType.RUN_ERROR
          ) continue;
          yield ev;
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
   * Classify the user's query against the registered sub-agents using a small
   * LLM call. Returns `{ agent: 'none', ... }` when nothing matches.
   *
   * Override this if you want a deterministic router (regex / keyword / Intent
   * registry) — the rest of the orchestrator doesn't care how the decision
   * is made.
   */
  protected async classify(query: string, signal: AbortSignal): Promise<{ agent: string; reason: string }> {
    if (query.trim() === '') return { agent: 'none', reason: 'empty query' };

    const choices = [...this.subs.values()]
      .map((s) => `  - "${s.id}" — ${s.description}\n    Examples: ${s.examples.map((e) => `"${e}"`).join(', ')}`)
      .join('\n');

    const prompt =
      `You are a router. Pick exactly one specialist to handle the user's request.\n` +
      `Specialists:\n${choices}\n\n` +
      `User query: "${query}"\n\n` +
      `Reply ONLY with JSON of the form {"agent": "<id>", "reason": "<one short sentence>"}.\n` +
      `If no specialist fits, use "agent": "none".`;

    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }] as never,
        config: { abortSignal: signal } as never,
      });
      const text = response.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return { agent: 'none', reason: 'classifier returned non-JSON' };
      const parsed = JSON.parse(match[0]) as { agent?: string; reason?: string };
      const agent = typeof parsed.agent === 'string' ? parsed.agent : 'none';
      const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
      return { agent, reason };
    } catch (err) {
      log.warn('classifier failed', { err: err instanceof Error ? err.message : String(err) });
      return { agent: 'none', reason: 'classifier error' };
    }
  }
}
