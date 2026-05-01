import { type ToolFilter } from '@maverick/agentic-ui';
import type { PersonaService } from './persona.service';

/**
 * Persona-scoped tool filter — Phase 7 wiring.
 *
 * Drops every tool the active persona may not invoke, then forwards
 * the survivors to a downstream filter (typically `keywordToolFilter`)
 * so the per-turn budget still applies inside the role-allowed set.
 *
 * @remarks
 * **Why a chain rather than two separate filters.** `provideToolFilter`
 * registers ONE filter at the `TOOL_FILTER` injection token. Composing
 * inline keeps the contract simple — the chat shell still sees a
 * single `ToolFilter` — while making the precedence explicit:
 *   1. Drop tools by role (governance — non-negotiable).
 *   2. Score the survivors by keyword overlap (efficiency).
 *
 * Phase 8's library work moves step 1 into `RegistryBase` via a
 * `setScopePolicy` hook so this consumer-side composition becomes
 * unnecessary; until then this function is the seam.
 *
 * @example
 * ```ts
 * provideToolFilter(
 *   personaToolFilter(inject(PersonaService),
 *                     keywordToolFilter({ maxTools: 12, floor: 5 })),
 * )
 * ```
 */
export function personaToolFilter(
  personas: PersonaService,
  inner: ToolFilter,
): ToolFilter {
  return (ctx) => {
    const persona = personas.active();
    const allowed = ctx.tools.filter((t) => personas.canInvoke(persona, t.name));
    return inner({ messages: ctx.messages, tools: allowed });
  };
}
