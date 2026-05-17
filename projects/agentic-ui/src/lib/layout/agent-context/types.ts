import { InjectionToken } from '@angular/core';

/**
 * A single XML-like fragment of agent context. Contributors return one
 * fragment each (or `null` if they have nothing to add this turn).
 * The provider assembles the fragments in `order` ascending into a
 * single `<context>…</context>` block.
 *
 * Why XML-like instead of JSON: large language models — including the
 * Gemini family used by the eDiscovery flagship — parse XML-tagged
 * context blocks more reliably than JSON when the block is part of a
 * larger free-text instruction. See [Anthropic prompting guide §
 * "Use XML tags to structure your prompts"](https://docs.anthropic.com/claude/docs/use-xml-tags).
 * The structured form (`composeStructured()`) is available for hosts
 * that prefer JSON.
 */
export interface ContextFragment {
  /** Tag name — appears in output as `<tag>…</tag>`. */
  readonly tag: string;
  /** Optional attributes — `<tag attr="value">…`. */
  readonly attrs?: Readonly<Record<string, string | number | boolean>>;
  /**
   * Inner content. A string becomes the text inside the tag; an array
   * of fragments produces nested children. `undefined` produces a
   * self-closing element `<tag />`.
   */
  readonly content?: string | readonly ContextFragment[];
}

/**
 * One layer that contributes information about the live UI state to
 * the agent's per-turn context block. Implementations read signals
 * inside `contribute()`; the provider's compose call captures the
 * current values.
 *
 * Per ADR-046 D5, contributors are stateless aside from their injected
 * signal sources. The compose pass is cheap (no async), so it can run
 * synchronously before each chat turn is dispatched.
 */
export interface ContextContributor {
  /** Stable id — telemetry / debugging. */
  readonly id: string;
  /**
   * Order in the assembled block, ascending. Lower numbers appear
   * earlier so adopters can place high-signal fragments (route,
   * selection) before lower-signal ones (recent activity).
   */
  readonly order: number;
  /**
   * Return the fragment for this turn, or `null` if nothing to add.
   * Returning `null` is cheaper than returning an empty fragment —
   * the provider skips it entirely.
   */
  contribute(): ContextFragment | null;
}

/**
 * Multi-provider token. Each `ContextContributor` class is registered
 * with `multi: true`; the provider injects the combined array.
 */
export const CONTEXT_CONTRIBUTOR = new InjectionToken<readonly ContextContributor[]>(
  'CONTEXT_CONTRIBUTOR',
  { factory: () => [] },
);
