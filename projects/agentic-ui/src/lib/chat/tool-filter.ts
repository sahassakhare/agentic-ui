import { InjectionToken, inject, makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';
import type { ToolDef } from '../types/registry-defs';

/**
 * Input the tool filter sees when deciding which tools to send to the
 * agent for the current turn.
 */
export interface ToolFilterContext {
  /**
   * Full message history at the time of the user turn that triggered
   * this filter call. The most recent user message is typically the
   * primary signal.
   */
  readonly messages: ReadonlyArray<{ readonly role: string; readonly content: string }>;
  /** Every tool currently registered in `ToolRegistry`. */
  readonly tools: readonly ToolDef[];
}

/**
 * Hook for narrowing the tool list before each turn is sent to the
 * agent. Returns a (possibly filtered) array of tools — the chat
 * shell sends this through to the backend in `RunAgentInput.tools`.
 *
 * @remarks
 * Why this matters at scale: at 50+ federated remotes contributing
 * 200+ tools, the system prompt explodes and risks hitting the LLM's
 * context limit. A per-turn filter — even something cheap like keyword
 * scoring — keeps the sent tool set bounded regardless of how many
 * remotes are loaded.
 *
 * @returns The narrowed tool array (or all tools to no-op the filter).
 *          Order is preserved as much as possible; the agent sees
 *          tools in declared order unless the filter sorts.
 */
export type ToolFilter = (ctx: ToolFilterContext) => readonly ToolDef[];

/**
 * Identity filter — returns every tool. Used as the library default so
 * apps that don't configure a filter behave exactly as before.
 */
export const passthroughToolFilter: ToolFilter = (ctx) => ctx.tools;

/**
 * DI token consumed by `injectAgenticChat()`. Provide your filter via
 * {@link provideToolFilter} or override this token directly.
 */
export const TOOL_FILTER = new InjectionToken<ToolFilter>('TOOL_FILTER', {
  providedIn: 'root',
  factory: () => passthroughToolFilter,
});

/**
 * Register a custom {@link ToolFilter}. Call from `app.config.ts`
 * alongside `provideAgenticUi(...)`:
 *
 * @example
 * ```ts
 * provideAgenticUi(),
 * provideToolFilter(keywordToolFilter()),
 * ```
 *
 * @param filter Function called once per user turn to narrow the
 *               tool list sent to the agent.
 */
export function provideToolFilter(filter: ToolFilter): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: TOOL_FILTER, useValue: filter },
  ]);
}

// ─── Reference implementation: keyword overlap filter ────────────────────────

/**
 * Stopwords filtered out before tokenising — the same set the
 * orchestrator's keyword fallback router uses, kept here so this
 * filter is self-contained.
 */
const STOPWORDS = new Set<string>([
  'the', 'and', 'for', 'are', 'with', 'this', 'that', 'have', 'has', 'had',
  'how', 'what', 'when', 'where', 'why', 'who', 'which', 'about', 'from', 'into',
  'can', 'could', 'should', 'would', 'will', 'just', 'they', 'them', 'their',
  'you', 'your', 'yours', 'was', 'were', 'been', 'being', 'any', 'some',
  'many', 'much', 'one', 'two', 'three', 'please', 'okay', 'yes', 'sure',
]);

/**
 * Configuration for {@link keywordToolFilter}.
 */
export interface KeywordToolFilterConfig {
  /**
   * Maximum tools to send per turn. Tools are ordered by descending
   * keyword score; ties resolved by declaration order.
   * @default 12
   */
  readonly maxTools?: number;
  /**
   * Minimum tokens a tool's corpus must overlap with the user message
   * to be considered. Set to 0 to keep zero-score tools as fallback.
   * @default 1
   */
  readonly minScore?: number;
  /**
   * If fewer than `floor` tools survive the filter, fill back up to
   * `floor` with arbitrary tools so the agent has *something* to
   * call when the user asks something unforeseen. Set to 0 to disable.
   * @default 3
   */
  readonly floor?: number;
}

/**
 * Reference {@link ToolFilter} that scores each tool against the
 * user's most recent message via simple word-overlap on each tool's
 * `name + description` corpus, sorts descending, and returns the
 * top-N.
 *
 * Cheap (no LLM call), deterministic, and good enough as a starting
 * point when the registered tool set grows past the LLM's preferred
 * context window. Replace with embedding-based similarity when
 * keyword overlap stops cutting it.
 *
 * @example
 * ```ts
 * provideToolFilter(keywordToolFilter({ maxTools: 8, floor: 3 })),
 * ```
 */
export function keywordToolFilter(config: KeywordToolFilterConfig = {}): ToolFilter {
  const maxTools = config.maxTools ?? 12;
  const minScore = config.minScore ?? 1;
  const floor = config.floor ?? 3;

  return ({ messages, tools }) => {
    if (tools.length <= maxTools) return tools;

    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const text = (lastUser?.content ?? '').toLowerCase();
    const tokens = (text.match(/[a-z][a-z0-9-]+/g) ?? []).filter(
      (t) => t.length >= 3 && !STOPWORDS.has(t),
    );

    if (tokens.length === 0) return tools.slice(0, maxTools);

    const scored = tools.map((tool, idx) => {
      const corpus = `${tool.name} ${tool.description ?? ''}`.toLowerCase();
      let score = 0;
      for (const tok of tokens) if (corpus.includes(tok)) score++;
      return { tool, idx, score };
    });

    scored.sort((a, b) => b.score - a.score || a.idx - b.idx);

    const matched = scored.filter((s) => s.score >= minScore).slice(0, maxTools);
    if (matched.length >= floor) return matched.map((s) => s.tool);

    // Fewer hits than the floor — top up with the next best by declaration order.
    const filled = [
      ...matched,
      ...scored.filter((s) => s.score < minScore).slice(0, floor - matched.length),
    ];
    return filled.slice(0, maxTools).map((s) => s.tool);
  };
}
