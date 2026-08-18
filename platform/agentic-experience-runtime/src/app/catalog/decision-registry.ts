/**
 * Runtime registry of compiled decisions (name → table + evaluator). Populated
 * by `CatalogDecisionSource`. Gives the Hub a governed, testable place to
 * evaluate a `kind:'decision'` — the substrate for the assistant (via a tool),
 * and for forms/workflows to branch on a decision by name (follow-on).
 */
import { Injectable } from '@angular/core';
import { evaluateDecision, type DecisionTable, type DecisionResult } from './decision-eval';

export interface DecisionEntry {
  readonly name: string;
  readonly description?: string;
  readonly table: DecisionTable;
}

@Injectable({ providedIn: 'root' })
export class DecisionRegistry {
  private readonly map = new Map<string, DecisionEntry>();

  set(entry: DecisionEntry): void { this.map.set(entry.name, entry); }
  clear(): void { this.map.clear(); }
  get(name: string): DecisionEntry | undefined { return this.map.get(name); }
  list(): DecisionEntry[] { return [...this.map.values()]; }
  get size(): number { return this.map.size; }

  /** Evaluate a named decision against an input context (undefined if unknown). */
  evaluate(name: string, ctx: Record<string, unknown>): DecisionResult | undefined {
    const entry = this.map.get(name);
    return entry ? evaluateDecision(entry.table, ctx) : undefined;
  }
}
