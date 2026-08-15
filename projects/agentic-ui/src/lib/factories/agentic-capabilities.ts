import type {
  KnowledgeDef,
  MemoryDef,
  NavigationDef,
  PromptDef,
  SkillDef,
} from '../types/registry-defs';

/**
 * Validating factories for the AEP Seam-B capabilities (Prompt / Skill /
 * Knowledge / Memory / Navigation). These are the sanctioned construction path
 * — like `agenticTool` / `agenticForm` / `agenticWorkflow` — validating the def
 * shape at *author time* so malformed capabilities can't register silently and
 * then surface as a `TypeError` deep in the planner or context contributor.
 *
 * Raw `registry.register({...})` still works (RegistryBase is permissive by
 * design), but authored/federated content should go through these.
 */
export class AgenticCapabilityError extends Error {
  constructor(kind: string, name: string, message: string) {
    super(`[agentic${cap(kind)}] "${name}": ${message}`);
    this.name = 'AgenticCapabilityError';
  }
}

const IDENTIFIER_RE = /^[A-Za-z0-9_./:@-]+$/;

function requireName(kind: string, name: unknown): string {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new AgenticCapabilityError(kind, String(name), 'name is required');
  }
  if (!IDENTIFIER_RE.test(name)) {
    throw new AgenticCapabilityError(kind, name, 'name must match [A-Za-z0-9_./:@-]+');
  }
  return name;
}

function requireNonEmpty(kind: string, name: string, field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AgenticCapabilityError(kind, name, `${field} is required`);
  }
  return value;
}

function requireStringArray(kind: string, name: string, field: string, value: unknown): void {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new AgenticCapabilityError(kind, name, `${field} must be an array of strings`);
  }
}

/** Build + validate a {@link PromptDef}. */
export function agenticPrompt(def: PromptDef): PromptDef {
  requireName('prompt', def.name);
  requireNonEmpty('prompt', def.name, 'template', def.template);
  if (def.variables !== undefined) requireStringArray('prompt', def.name, 'variables', def.variables);
  return def;
}

/** Build + validate a {@link SkillDef}. */
export function agenticSkill(def: SkillDef): SkillDef {
  requireName('skill', def.name);
  requireNonEmpty('skill', def.name, 'description', def.description);
  requireStringArray('skill', def.name, 'tools', def.tools);
  if (def.tools.length === 0) {
    throw new AgenticCapabilityError('skill', def.name, 'tools must list at least one tool');
  }
  return def;
}

/** Build + validate a {@link KnowledgeDef}. */
export function agenticKnowledge(def: KnowledgeDef): KnowledgeDef {
  requireName('knowledge', def.name);
  requireNonEmpty('knowledge', def.name, 'kind', def.kind);
  return def;
}

/** Build + validate a {@link MemoryDef}. */
export function agenticMemory(def: MemoryDef): MemoryDef {
  requireName('memory', def.name);
  requireNonEmpty('memory', def.name, 'kind', def.kind);
  return def;
}

/** Build + validate a {@link NavigationDef}. */
export function agenticNavigation(def: NavigationDef): NavigationDef {
  requireName('navigation', def.name);
  requireNonEmpty('navigation', def.name, 'title', def.title);
  requireNonEmpty('navigation', def.name, 'route', def.route);
  return def;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
