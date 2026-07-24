import type { ExperienceDef } from './experience-registry';
import type { CapabilityRequirement } from '../types/registry-defs';

/**
 * Thrown when an {@link ExperienceDef} is malformed at author time — the
 * sanctioned early-surfacing error, mirroring `AgenticWorkflowError` /
 * `FormCompositionError`.
 */
export class AgenticExperienceError extends Error {
  constructor(name: string, message: string) {
    super(`[agenticExperience] "${name}": ${message}`);
    this.name = 'AgenticExperienceError';
  }
}

const IDENTIFIER_RE = /^[A-Za-z0-9_./:@-]+$/;

/**
 * Build + validate an {@link ExperienceDef} (AEP Seam C). The sanctioned
 * construction path for experiences: validates the shape that flows into the
 * planner and the capability graph so an author gets a clear error instead of a
 * silently-broken experience (empty goal, self-referential requirement, a
 * requirement that sets neither `name` nor `tag`, non-string arrays).
 *
 * Raw `ExperienceRegistry.register({...})` still works; authored/federated
 * experiences should go through this.
 */
export function agenticExperience(def: ExperienceDef): ExperienceDef {
  if (typeof def.name !== 'string' || def.name.trim() === '') {
    throw new AgenticExperienceError(String(def.name), 'name is required');
  }
  if (!IDENTIFIER_RE.test(def.name)) {
    throw new AgenticExperienceError(def.name, 'name must match [A-Za-z0-9_./:@-]+');
  }
  if (typeof def.title !== 'string' || def.title.trim() === '') {
    throw new AgenticExperienceError(def.name, 'title is required');
  }
  if (typeof def.goal !== 'string' || def.goal.trim() === '') {
    throw new AgenticExperienceError(def.name, 'goal is required');
  }
  validateStringArray(def.name, 'intents', def.intents);
  validateStringArray(def.name, 'personas', def.personas);
  validateStringArray(def.name, 'requiredPermissions', def.requiredPermissions);
  validateStringArray(def.name, 'policies', def.policies);

  for (const [i, req] of (def.requires ?? []).entries()) {
    validateRequirement(def.name, i, req);
  }
  return def;
}

function validateStringArray(name: string, field: string, value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new AgenticExperienceError(name, `${field} must be an array of strings`);
  }
}

function validateRequirement(name: string, index: number, req: CapabilityRequirement): void {
  const at = `requires[${index}]`;
  if (!req || typeof req.kind !== 'string' || req.kind.trim() === '') {
    throw new AgenticExperienceError(name, `${at}.kind is required`);
  }
  const hasName = typeof req.name === 'string' && req.name.trim() !== '';
  const hasTag = typeof req.tag === 'string' && req.tag.trim() !== '';
  if (!hasName && !hasTag) {
    throw new AgenticExperienceError(name, `${at} must set either name or tag`);
  }
  // A requirement that names the experience's own kind+name is self-referential.
  if (hasName && req.kind === 'experience' && req.name === name) {
    throw new AgenticExperienceError(name, `${at} is self-referential`);
  }
}
