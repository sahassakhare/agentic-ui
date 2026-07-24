import { Injectable } from '@angular/core';
import { RegistryBase } from './registry-base';
import type { SkillDef } from '../types/registry-defs';

/**
 * Registry of skills — named, reusable tool + prompt bundles the agent can
 * select as a unit (AEP Seam B). Distinct from `PlaybookRegistry`, whose
 * entries are deterministic author-ordered sequences.
 */
@Injectable({ providedIn: 'root' })
export class SkillRegistry extends RegistryBase<SkillDef> {
  protected readonly registryName = 'skill';
}
