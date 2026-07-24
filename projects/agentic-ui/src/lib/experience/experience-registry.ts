import { computed, Injectable, signal } from '@angular/core';
import { RegistryBase } from '../registries/registry-base';
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
  /** OPA rule paths / `ApprovalRegistry` policy ids gating this experience. */
  readonly policies?: readonly string[];
  /** Personas allowed to run this experience (planner-level gate). */
  readonly personas?: readonly string[];
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

  /** Live approval state per experience name, seeded on register. */
  private readonly _approvals = signal<ReadonlyMap<string, ApprovalRecord>>(new Map());

  /** Experiences currently `approved` — what the planner runs by default. */
  readonly approved = computed(() =>
    this.list().filter((e) => this.stateOf(e.name) === 'approved'),
  );

  /** Experiences in `review`, needing reviewer attention. */
  readonly pendingReview = computed(() =>
    this.list().filter((e) => this.stateOf(e.name) === 'review'),
  );

  override register(def: ExperienceDef): () => void {
    this._approvals.update((cur) => {
      const next = new Map(cur);
      next.set(def.name, { state: def.approvalState ?? 'draft', chain: [] });
      return next;
    });
    return super.register(def);
  }

  /** Live approval state of an experience (defaults to 'draft' if unknown). */
  stateOf(name: string): TemplateApprovalState {
    return this._approvals().get(name)?.state ?? 'draft';
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
  }
}
