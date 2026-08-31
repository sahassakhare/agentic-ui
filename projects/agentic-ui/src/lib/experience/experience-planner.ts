import { Injectable, computed, inject } from '@angular/core';
import {
  createCapabilityLookup,
  resolveCapabilityGraph,
  type CapabilityLookup,
  type UnmetRequirement,
} from '../registries/capability-graph';
import {
  ToolRegistry,
  ComponentRegistry,
  FormRegistry,
  DataSourceRegistry,
  IntentRegistry,
  PromptRegistry,
  SkillRegistry,
  KnowledgeRegistry,
  MemoryRegistry,
  WorkflowRegistry,
} from '../registries';
import { AGENTIC_TELEMETRY_SINK } from '../telemetry/telemetry-sink';
import { ExperienceRegistry, type ExperienceDef } from './experience-registry';
import type { RegistryEntry, SkillDef } from '../types/registry-defs';

/** The acting user the planner gates and personalizes for. */
export interface ExperiencePlanUser {
  readonly id: string;
  readonly persona: string;
  readonly permissions?: readonly string[];
}

/** Input to {@link ExperiencePlanner.plan}. */
export interface ExperiencePlanInput {
  /** Plan this experience by name. If unset, resolved from `intent` then `goal`. */
  readonly experienceId?: string;
  /** Intent phrase to resolve an experience from (matches `ExperienceDef.intents`). */
  readonly intent?: string;
  /** Free-form goal to resolve an experience from (substring match, last resort). */
  readonly goal?: string;
  /** The acting user — drives the access gate + personalization. */
  readonly user: ExperiencePlanUser;
  /** Opaque runtime context (route, selection, matter, conversation). */
  readonly context?: Record<string, unknown>;
  /**
   * When true, allow planning experiences that are not yet `approved`.
   * Default false — production only plans approved experiences.
   */
  readonly allowUnapproved?: boolean;
}

/** One audit line explaining why a capability entered the plan. */
export interface PlanRationaleEntry {
  /** Graph node id, `${kind}:${name}`. */
  readonly capability: string;
  readonly kind: string;
  readonly reason: string;
}

/** Result of the access gate. */
export interface ExperiencePlanAccess {
  readonly allowed: boolean;
  readonly reason?: string;
}

/**
 * A deterministic Experience Plan (AEP Seam D output). Resolves an experience
 * through the capability dependency graph into a concrete bundle the runtime
 * consumes: `tools` narrows the per-turn `TOOL_FILTER`, `layout` seeds the
 * layout, and the whole thing is serialized into the agent context so the LLM
 * personalizes rather than decides scope. `rationale` makes every choice
 * auditable; `unmet` surfaces gaps rather than hiding them.
 */
export interface ExperiencePlan {
  readonly experienceId: string;
  readonly goal: string;
  readonly access: ExperiencePlanAccess;
  /** `LayoutTemplateRegistry` name to seed the layout, when the experience sets one. */
  readonly layout?: string;
  readonly components: readonly string[];
  readonly forms: readonly string[];
  readonly tools: readonly string[];
  readonly dataSources: readonly string[];
  readonly prompts: readonly string[];
  readonly knowledge: readonly string[];
  readonly memory: readonly string[];
  readonly skills: readonly string[];
  /** First workflow capability reached, if any. */
  readonly workflow?: string;
  readonly policies: readonly string[];
  /** Non-optional requirements that resolved to nothing. */
  readonly unmet: readonly UnmetRequirement[];
  readonly rationale: readonly PlanRationaleEntry[];
}

/**
 * Experience Planner (AEP Seam D).
 *
 * Deterministic pre-plan: resolve an `ExperienceDef` → traverse the Seam-A
 * dependency graph → evaluate the access gate → classify the reachable
 * capabilities into a concrete bundle. It sits *beside* the LLM run-loop
 * (`runUntilSettled`) — it does not replace it. The resulting plan is what the
 * agent context serializes so the model personalizes/streams the experience,
 * while scope decisions stay in this testable, auditable layer.
 */
@Injectable({ providedIn: 'root' })
export class ExperiencePlanner {
  private readonly experiences = inject(ExperienceRegistry);
  private readonly tools = inject(ToolRegistry);
  private readonly components = inject(ComponentRegistry);
  private readonly forms = inject(FormRegistry);
  private readonly dataSources = inject(DataSourceRegistry);
  private readonly intents = inject(IntentRegistry);
  private readonly prompts = inject(PromptRegistry);
  private readonly skills = inject(SkillRegistry);
  private readonly knowledge = inject(KnowledgeRegistry);
  private readonly memory = inject(MemoryRegistry);
  private readonly workflows = inject(WorkflowRegistry);
  private readonly telemetry = inject(AGENTIC_TELEMETRY_SINK);

  /**
   * Reactive invalidation token (plan §11 memoization). Reads every source that
   * can change a plan; its identity changes whenever any of them mutates.
   * Reading `approved()` also tracks the experience entries, the approval
   * overlay, and the scope policy. Synchronous by design — `computed`
   * recomputes on read the instant a dependency changes, so there is no
   * stale-cache window (an effect would flush a tick late).
   */
  private readonly epoch = computed<readonly unknown[]>(() => [
    this.tools.signal(), this.components.signal(), this.forms.signal(),
    this.dataSources.signal(), this.prompts.signal(), this.skills.signal(),
    this.knowledge.signal(), this.memory.signal(), this.workflows.signal(),
    this.experiences.approved(),
  ]);
  private cacheEpoch: readonly unknown[] | null = null;
  private readonly planCache = new Map<string, { plan: ExperiencePlan; truncated: number }>();

  /**
   * Resolve + plan an experience for a user. Returns `null` if none resolves.
   *
   * Memoized on `(resolvedExperience, persona, permissions, allowUnapproved)`;
   * the whole cache is dropped the instant any source registry, approval state,
   * or scope policy changes (via {@link epoch}). Telemetry is emitted on EVERY
   * call — cache hits included — so the access-decision audit trail stays
   * complete; only the expensive graph traversal is memoized.
   */
  plan(input: ExperiencePlanInput): ExperiencePlan | null {
    const currentEpoch = this.epoch();
    if (currentEpoch !== this.cacheEpoch) {
      this.planCache.clear();
      this.cacheEpoch = currentEpoch;
    }

    const experience = this.resolveExperience(input);
    if (!experience) return null;

    const key = this.cacheKey(input, experience.name);
    let entry = this.planCache.get(key);
    if (!entry) {
      entry = this.computePlan(experience, input);
      this.planCache.set(key, entry);
    }
    this.emitTelemetry(entry.plan, input, entry.truncated);
    return entry.plan;
  }

  /** Memoization key — the inputs that determine the plan output. */
  private cacheKey(input: ExperiencePlanInput, resolvedName: string): string {
    return JSON.stringify({
      n: resolvedName,
      p: input.user.persona,
      perms: [...(input.user.permissions ?? [])].sort(),
      au: input.allowUnapproved ?? false,
    });
  }

  /** The expensive part — access gate + graph traversal. No telemetry (that's per-call). */
  private computePlan(
    experience: ExperienceDef,
    input: ExperiencePlanInput,
  ): { plan: ExperiencePlan; truncated: number } {
    const access = this.evaluateAccess(experience, input);
    const base = {
      experienceId: experience.name,
      goal: experience.goal,
      access,
      layout: experience.defaultLayout,
      policies: [...(experience.policies ?? [])],
    };

    if (!access.allowed) {
      // Denied → no capability resolution. Denial is itself the audit record.
      return {
        truncated: 0,
        plan: {
          ...base,
          components: [], forms: [], tools: [], dataSources: [], prompts: [],
          knowledge: [], memory: [], skills: [], workflow: undefined, unmet: [],
          rationale: [{ capability: `experience:${experience.name}`, kind: 'experience', reason: access.reason ?? 'access denied' }],
        },
      };
    }

    const graph = resolveCapabilityGraph({ kind: 'experience', entry: experience }, this.lookup());

    const byKind = (kind: string) =>
      graph.nodes.filter((n) => n.kind === kind && n.entry != null && n.id !== graph.root).map((n) => n.name);

    const toolSet = new Set(byKind('tool'));
    // Expand skills → their bundled tools so TOOL_FILTER covers everything a skill needs.
    const skillNames = byKind('skill');
    for (const s of skillNames) {
      const def = this.skills.get(s) as SkillDef | undefined;
      // Guard `tools` too: a raw-registered skill may omit it (no factory
      // guarantees the shape), and an unguarded forEach would abort the plan.
      def?.tools?.forEach((t) => toolSet.add(t));
    }

    const workflow = byKind('workflow')[0];

    const rationale: PlanRationaleEntry[] = [
      { capability: graph.root, kind: 'experience', reason: `goal: ${experience.goal}` },
      ...graph.edges
        .filter((e) => e.reason)
        .map((e) => ({ capability: e.to, kind: e.to.split(':')[0], reason: e.reason! })),
    ];

    return {
      truncated: graph.truncated.length,
      plan: {
        ...base,
        components: byKind('component'),
        forms: byKind('form'),
        tools: [...toolSet],
        dataSources: byKind('dataSource'),
        prompts: byKind('prompt'),
        knowledge: byKind('knowledge'),
        memory: byKind('memory'),
        skills: skillNames,
        workflow,
        unmet: graph.unmet,
        rationale,
      },
    };
  }

  /** Emits the access-decision telemetry for a plan — runs on every `plan()` call. */
  private emitTelemetry(plan: ExperiencePlan, input: ExperiencePlanInput, truncated: number): void {
    if (!plan.access.allowed) {
      this.telemetry.emit('agentic.experience.access_denied', {
        experienceId: plan.experienceId,
        persona: input.user.persona,
        userId: input.user.id,
        reason: plan.access.reason,
      });
      return;
    }
    this.telemetry.emit('agentic.experience.plan', {
      experienceId: plan.experienceId,
      persona: input.user.persona,
      userId: input.user.id,
      toolCount: plan.tools.length,
      unmetCount: plan.unmet.length,
      truncated,
    });
    if (plan.unmet.length > 0) {
      this.telemetry.emit('agentic.experience.unresolved', {
        experienceId: plan.experienceId,
        unmet: plan.unmet.map((u) => `${u.requirement.kind}:${u.requirement.name ?? u.requirement.tag ?? '*'}`),
      });
    }
  }

  /** Builds a capability lookup over the live registries, keyed by kind. */
  private lookup(): CapabilityLookup {
    const src = (kind: string, entries: () => readonly RegistryEntry[]) => ({ kind, entries });
    return createCapabilityLookup([
      src('tool', () => this.tools.list()),
      src('component', () => this.components.list()),
      src('form', () => this.forms.list()),
      src('dataSource', () => this.dataSources.list()),
      src('prompt', () => this.prompts.list()),
      src('skill', () => this.skills.list()),
      src('knowledge', () => this.knowledge.list()),
      src('memory', () => this.memory.list()),
      src('workflow', () => this.workflows.list()),
      src('experience', () => this.experiences.list()),
    ]);
  }

  /** Resolve an experience from an explicit id, an intent, or a goal substring. */
  private resolveExperience(input: ExperiencePlanInput): ExperienceDef | undefined {
    if (input.experienceId) return this.experiences.get(input.experienceId);

    const all = this.experiences.list();
    if (input.intent) {
      const intent = input.intent.toLowerCase();
      const byIntent = all.find(
        (e) =>
          e.name.toLowerCase() === intent ||
          e.intents?.some((i) => i.toLowerCase() === intent),
      );
      if (byIntent) return byIntent;
      // Fall back to the naive IntentRegistry router, then map its target name.
      const matched = this.intents.match(input.intent);
      if (matched) {
        const viaTarget = all.find((e) => e.intents?.includes(matched.id) || e.name === matched.mapsTo.target);
        if (viaTarget) return viaTarget;
      }
    }
    if (input.goal) {
      const goal = input.goal.toLowerCase();
      return all.find((e) => e.goal.toLowerCase().includes(goal) || goal.includes(e.goal.toLowerCase()));
    }
    return undefined;
  }

  /**
   * Access gate — the in-runtime authorization decision point, run *before*
   * capability resolution so a forbidden experience is never planned. Enforces,
   * in order: approval state (unless `allowUnapproved`), the `personas`
   * allow-list, and `requiredPermissions` (the user must hold all). It does NOT
   * evaluate `ExperienceDef.policies` — those are OPA/downstream and forwarded
   * into the plan for the policy layer to enforce (runtime non-goal: no OPA in
   * the bundle). So "denied here" is a subset of the full policy decision, not
   * the whole of it; the plan still carries `policies` for downstream enforcement.
   */
  private evaluateAccess(experience: ExperienceDef, input: ExperiencePlanInput): ExperiencePlanAccess {
    if (!input.allowUnapproved && this.experiences.stateOf(experience.name) !== 'approved') {
      return { allowed: false, reason: `experience "${experience.name}" is not approved` };
    }
    if (experience.personas && experience.personas.length > 0 && !experience.personas.includes(input.user.persona)) {
      return { allowed: false, reason: `persona "${input.user.persona}" is not permitted for "${experience.name}"` };
    }
    const required = experience.requiredPermissions ?? [];
    if (required.length > 0) {
      const held = new Set(input.user.permissions ?? []);
      const missing = required.filter((p) => !held.has(p));
      if (missing.length > 0) {
        return { allowed: false, reason: `missing permission(s): ${missing.join(', ')}` };
      }
    }
    return { allowed: true };
  }
}
