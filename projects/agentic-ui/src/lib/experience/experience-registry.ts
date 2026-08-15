import { computed, inject, Injectable, signal } from '@angular/core';
import { RegistryBase } from '../registries/registry-base';
import { AGENTIC_TELEMETRY_SINK } from '../telemetry/telemetry-sink';
import type { CapabilityRequirement, RegistryEntry } from '../types/registry-defs';
import { randomId } from '../chat/message-utils';
import { nextState } from '../layout/templates/approval-workflow';
import type { ApprovalEvent, TemplateApprovalState } from '../layout/templates/types';

/**
 * An Experience (AEP Seam C) — business intent decoupled from implementation.
 *
 * An `ExperienceDef` names a goal ("Create Legal Matter") and the capabilities
 * needed to accomplish it via {@link RegistryEntry.requires} (Seam A). The
 * Experience Planner (Seam D) resolves it into a concrete bundle at runtime.
 * Because it extends `RegistryEntry`, an experience is a first-class capability:
 * it participates in the dependency graph, is persona-scopable via
 * `setScopePolicy`, and is federation-symmetric via `removeBySource`.
 *
 * Approval is layered on top by {@link ExperienceRegistry}, reusing the same
 * `draft → review → approved` state machine as the layout/dashboard template
 * catalogs (ADR-046 D6).
 */
export interface ExperienceDef extends RegistryEntry {
  /** Business-facing title ("Legal Intake"). */
  readonly title: string;
  /** Natural-language goal the planner reasons over. */
  readonly goal: string;
  /** `IntentRegistry` ids that should trigger this experience. */
  readonly intents?: readonly string[];
  /** The capabilities this experience needs (Seam A). Normally set. */
  readonly requires?: readonly CapabilityRequirement[];
  /** Optional `LayoutTemplateRegistry` name used to seed the layout. */
  readonly defaultLayout?: string;
  /**
   * OPA rule paths / `ApprovalRegistry` policy ids associated with this
   * experience. **Advisory / pass-through:** the planner forwards these into
   * the `ExperiencePlan` for enforcement by the downstream policy layer (the
   * OPA sidecar / catalog `/policy/decide`) — it does NOT evaluate OPA
   * in-runtime (runtime non-goal: no OPA in the bundle). For in-runtime denial,
   * use {@link personas} and {@link requiredPermissions}.
   */
  readonly policies?: readonly string[];
  /** Personas allowed to run this experience (enforced in-runtime by the planner gate). */
  readonly personas?: readonly string[];
  /**
   * Permissions the acting user must ALL hold to run this experience. Enforced
   * in-runtime by the planner's access gate against `ExperiencePlanUser.permissions`
   * (simple ABAC that needs no OPA). Omit for no permission requirement.
   */
  readonly requiredPermissions?: readonly string[];
  /** Semver; reuse the template version-chain convention. */
  readonly version?: string;
  /** Initial approval state at registration. Defaults to 'draft'. */
  readonly approvalState?: TemplateApprovalState;
}

interface ApprovalRecord {
  readonly state: TemplateApprovalState;
  readonly chain: readonly ApprovalEvent[];
}

/**
 * Registry of Experiences (AEP Seam C). Standard `RegistryBase` machinery plus
 * an approval state machine kept in a side signal — the base entries stay
 * immutable (no re-register side effects) while approval evolves independently.
 */
@Injectable({ providedIn: 'root' })
export class ExperienceRegistry extends RegistryBase<ExperienceDef> {
  protected readonly registryName = 'experience';

  private readonly experienceTelemetry = inject(AGENTIC_TELEMETRY_SINK);

  /**
   * Transition-driven approval overlay, keyed by experience name. Populated
   * ONLY by {@link transition} — never at register time. This is deliberate:
   * seeding at register (before `super.register` decides whether the def is
   * actually stored) corrupted approval state under `first-wins` / `namespace`
   * / version-mismatch conflict policies (a dropped re-registration would still
   * reset a live experience's approval). With the lazy overlay, the base state
   * comes from the stored def's `approvalState`, and transitions layer on top.
   */
  private readonly _approvals = signal<ReadonlyMap<string, ApprovalRecord>>(new Map());

  /** Experiences currently `approved` — what the planner runs by default. */
  readonly approved = computed(() =>
    this.list().filter((e) => this.stateOf(e.name) === 'approved'),
  );

  /** Experiences in `review`, needing reviewer attention. */
  readonly pendingReview = computed(() =>
    this.list().filter((e) => this.stateOf(e.name) === 'review'),
  );

  /**
   * Prune the approval overlay for a removed source so it can't leak or go
   * stale across MFE load/unload cycles (the overlay is not the source of
   * truth — the stored def is).
   */
  override removeBySource(source: string): void {
    const removed = new Set(this.listRaw().filter((e) => e.source === source).map((e) => e.name));
    super.removeBySource(source);
    if (removed.size > 0) {
      this._approvals.update((cur) => {
        const next = new Map(cur);
        for (const name of removed) next.delete(name);
        return next;
      });
    }
  }

  /**
   * Live approval state: a recorded transition wins; otherwise the stored def's
   * initial `approvalState` (defaulting to 'draft'). Reads `getRaw` so state is
   * scope-policy-independent (a hidden experience still has a real state).
   */
  stateOf(name: string): TemplateApprovalState {
    const overlaid = this._approvals().get(name)?.state;
    if (overlaid) return overlaid;
    return this.getRaw(name)?.approvalState ?? 'draft';
  }

  /** Full approval chain for one experience. */
  approvalChain(name: string): readonly ApprovalEvent[] {
    return this._approvals().get(name)?.chain ?? [];
  }

  /**
   * Run an approval action against an experience — submit / approve / reject /
   * deprecate / revoke. Validates via the shared state machine and appends an
   * `ApprovalEvent` to the audit chain. Throws if the experience is unknown or
   * the transition is illegal (`ApprovalTransitionError`).
   */
  transition(
    name: string,
    action: ApprovalEvent['action'],
    opts: { actor: ApprovalEvent['actor']; comment?: string },
  ): void {
    if (!this.getRaw(name)) {
      throw new Error(`[ExperienceRegistry] experience "${name}" is not registered.`);
    }
    const current = this.stateOf(name);
    const toState = nextState(current, action);
    const event: ApprovalEvent = {
      id: randomId('approval'),
      timestamp: new Date().toISOString(),
      actor: opts.actor,
      action,
      fromState: current,
      toState,
      comment: opts.comment,
    };
    this._approvals.update((cur) => {
      const next = new Map(cur);
      const rec = next.get(name);
      next.set(name, { state: toState, chain: [...(rec?.chain ?? []), event] });
      return next;
    });
    // Approval state changes are audit-critical — surface to the telemetry
    // pipeline, not just the in-memory signal that dies with the tab.
    this.experienceTelemetry.emit('agentic.experience.approval_transition', {
      experience: name,
      action,
      fromState: current,
      toState,
      actor: opts.actor.userId,
    });
  }
}
