import { Injectable } from '@angular/core';
import { RegistryBase } from './registry-base';
import type { PromptDef } from '../types/registry-defs';

/**
 * Registry of versioned, reusable prompt templates (AEP Seam B).
 *
 * Prompts were previously inline strings with no catalog; `PromptRegistry`
 * gives them the standard `register / list / signal / removeBySource /
 * setScopePolicy` machinery so they can be discovered, scoped, federated, and
 * authored in a "Prompt Studio". Inherits `requires`/`produces` (Seam A).
 */
@Injectable({ providedIn: 'root' })
export class PromptRegistry extends RegistryBase<PromptDef> {
  protected readonly registryName = 'prompt';
}
