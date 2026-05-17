import { Injectable } from '@angular/core';
import { RegistryBase } from './registry-base';
import type { IntentDef } from '../types/registry-defs';

/**
 * Registry of natural-language intents that map to tools, actions, or routes.
 * Acts as a *router*; never executes. Useful for short-circuiting common
 * phrases pre-LLM (offline / restricted / latency-sensitive flows) and for
 * contributing structured intent metadata to the agent's system prompt.
 */
@Injectable({ providedIn: 'root' })
export class IntentRegistry extends RegistryBase<IntentDef> {
  protected readonly registryName = 'intent';

  /**
   * Naive substring-based intent match. Apps with non-trivial routing should
   * supply their own matcher (e.g., embeddings, regex, trained classifier);
   * this default is meant for tests and the simplest shortcut cases.
   */
  match(text: string): IntentDef | undefined {
    const normalized = text.trim().toLowerCase();
    if (!normalized) return undefined;
    return this.list().find((i) =>
      i.examples.some((ex) => normalized.includes(ex.toLowerCase())),
    );
  }
}
