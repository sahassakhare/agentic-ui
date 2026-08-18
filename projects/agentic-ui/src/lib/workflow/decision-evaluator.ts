import { InjectionToken, makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';

/**
 * Host-provided evaluator for governed decisions, consumed by the workflow engine
 * to drive a `DecisionNext` branch. The library declares the seam; the app
 * supplies the implementation (e.g. backed by a catalog-loaded decision registry),
 * so the library never depends on the app. Mirrors {@link TOOL_FILTER}.
 */
export interface DecisionEvaluator {
  /**
   * Evaluate a named `kind:'decision'` against an input context; resolve to its
   * output map, or `null` when the decision is unknown or no rule matched.
   */
  evaluate(decision: string, input: Readonly<Record<string, unknown>>): Promise<Record<string, string> | null>;
}

/** Default: no decisions are known, so every `DecisionNext` falls back to its `default`. */
export const noopDecisionEvaluator: DecisionEvaluator = { evaluate: async () => null };

/** DI seam a host app overrides with `provideDecisionEvaluator(...)`. */
export const AGENTIC_DECISION_EVALUATOR = new InjectionToken<DecisionEvaluator>('AGENTIC_DECISION_EVALUATOR', {
  providedIn: 'root',
  factory: () => noopDecisionEvaluator,
});

/** Register a governed decision evaluator (place in the app's root providers). */
export function provideDecisionEvaluator(evaluator: DecisionEvaluator): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: AGENTIC_DECISION_EVALUATOR, useValue: evaluator }]);
}
