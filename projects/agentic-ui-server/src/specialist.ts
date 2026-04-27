import type { ServerAgent } from './types.js';

/**
 * One specialist registration suitable for the `OrchestratorAgent`'s
 * `subAgents` config. Mirrors the `SubAgentSpec` shape consumers would write
 * by hand, but lets you author it next to the agent it wraps.
 *
 * Re-exported via {@link createSpecialist}'s return value — you don't
 * normally construct these objects by hand.
 */
export interface SpecialistSpec<TAgent extends ServerAgent = ServerAgent> {
  /** Stable id used by the orchestrator's classifier and for direct routing. */
  readonly id: string;
  /** Underlying `ServerAgent` (e.g. a domain-specific `GeminiAgent`). */
  readonly agent: TAgent;
  /** One-line description shown to the classifier LLM. */
  readonly description: string;
  /** Canonical phrasings that anchor the classifier and seed keyword fallback. */
  readonly examples: readonly string[];
}

/**
 * Configuration for {@link createSpecialist}. Combines what would otherwise
 * be two separate concerns — constructing the `GeminiAgent` (or any
 * `ServerAgent`-shaped class) and writing the matching `SubAgentSpec` for the
 * orchestrator — into one call site.
 *
 * @typeParam TAgent the concrete server agent class (defaults to `ServerAgent`).
 */
export interface CreateSpecialistConfig<TAgent extends ServerAgent = ServerAgent> {
  /** Stable specialist id. Used as the orchestrator routing key. */
  readonly id: string;
  /**
   * Factory that builds the underlying `ServerAgent`. Receives the resolved
   * `id` so you can pass it directly to your agent class's constructor.
   *
   * @example
   *   factory: (id) => new GeminiAgent(id, { apiKey, systemInstruction: '...' }),
   */
  readonly factory: (id: string) => TAgent;
  /** One-line domain summary shown to the orchestrator's classifier. */
  readonly description: string;
  /** Canonical phrasings of user requests for this domain. */
  readonly examples: readonly string[];
}

/**
 * Build one specialist (agent + orchestrator metadata) in a single call.
 * Cuts the ~30-line "construct agent + write SubAgentSpec" boilerplate that
 * accumulates when you have several specialists, and gives the IDE a single
 * place to autocomplete every property.
 *
 * @example
 * ```ts
 * const bookings = createSpecialist({
 *   id: 'bookings',
 *   factory: (id) => new GeminiAgent(id, { apiKey, systemInstruction: '...' }),
 *   description: 'flight search, booking, cancellation',
 *   examples: ['Book a flight from LAX to JFK on March 5', 'Cancel BK-XXX'],
 * });
 *
 * const orchestrator = new OrchestratorAgent('orchestrator', {
 *   apiKey,
 *   subAgents: [bookings, loyalty, support],
 * });
 *
 * agents.set(bookings.id, bookings.agent);
 * agents.set('orchestrator', orchestrator);
 * ```
 *
 * The returned object is structurally identical to a hand-written
 * `SubAgentSpec`, so you can pass it straight into the orchestrator config —
 * no `.toSpec()` step.
 */
export function createSpecialist<TAgent extends ServerAgent = ServerAgent>(
  config: CreateSpecialistConfig<TAgent>,
): SpecialistSpec<TAgent> {
  if (!config.id) throw new Error('createSpecialist: id is required.');
  if (typeof config.factory !== 'function') {
    throw new Error('createSpecialist: factory must be a function.');
  }
  const agent = config.factory(config.id);
  if (!agent || typeof (agent as ServerAgent).run !== 'function') {
    throw new Error(`createSpecialist: factory for "${config.id}" did not return a ServerAgent.`);
  }
  return {
    id: config.id,
    agent,
    description: config.description,
    examples: config.examples,
  };
}

/**
 * Register a list of specialists with a `Map<string, ServerAgent>` so each
 * one is also reachable directly via `/agents/<id>/run` — not just through
 * the orchestrator. Returns the same array of specs so it can be used
 * inline:
 *
 * @example
 * ```ts
 * const orchestrator = new OrchestratorAgent('orchestrator', {
 *   apiKey,
 *   subAgents: registerSpecialists(agents, [bookings, loyalty, support]),
 * });
 * agents.set('orchestrator', orchestrator);
 * ```
 */
export function registerSpecialists<TAgent extends ServerAgent>(
  registry: Map<string, ServerAgent>,
  specs: readonly SpecialistSpec<TAgent>[],
): readonly SpecialistSpec<TAgent>[] {
  for (const spec of specs) registry.set(spec.id, spec.agent);
  return specs;
}
