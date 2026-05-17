import type { DashboardDef, LayoutDef } from '../../types/registry-defs';

/**
 * ADR-046 D6 — approval workflow states for org / matter / persona
 * templates. Mirrors the existing ApprovalRegistry semantics (ADR-009)
 * with a smaller surface for the layout catalog case:
 *
 *   draft → review → approved
 *             ↓
 *           rejected
 *
 * From any state, templates can also be `deprecated` to mark "still
 * usable for in-flight saves but hidden from the picker" — useful
 * during template-version transitions.
 *
 * Templates surface in the picker based on state filter:
 *  - end users see `approved` only by default
 *  - admins see all states
 */
export type TemplateApprovalState =
  | 'draft'
  | 'review'
  | 'approved'
  | 'rejected'
  | 'deprecated';

/**
 * One entry in a template's approval chain — who reviewed, when, and
 * what they decided. Captures the audit trail for compliance ("show me
 * every reviewer who approved the privilege-review-v3 layout").
 */
export interface ApprovalEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly actor: { readonly userId: string; readonly displayName?: string };
  readonly action: 'submit' | 'approve' | 'reject' | 'deprecate' | 'revoke';
  readonly fromState: TemplateApprovalState;
  readonly toState: TemplateApprovalState;
  readonly comment?: string;
}

/**
 * Visibility scope — who can see the template in their picker.
 * Cross-tenant `public` is intentionally NOT supported by this ADR
 * (out of scope per ADR-046 §"Out of scope"); a future marketplace
 * registry would add it.
 */
export type TemplateVisibility = 'private' | 'matter' | 'tenant';

/**
 * Adopter-defined parameter that a template exposes for instantiation.
 * Example: the privilege-review template has a `caseType: 'civil' | 'criminal'`
 * parameter. The picker UI prompts for parameters when the user
 * instantiates; the template's `instantiate(params)` method weaves
 * them into the produced `LayoutDef` / `DashboardDef`.
 */
export interface TemplateParameter {
  readonly id: string;
  readonly label: string;
  readonly kind: 'string' | 'enum' | 'number' | 'boolean';
  readonly required?: boolean;
  readonly default?: unknown;
  /** For `kind: 'enum'`. */
  readonly options?: readonly { value: string; label: string }[];
}

/**
 * Common template shape — layout / dashboard registries share these
 * fields. `body` differs per registry (LayoutDef vs DashboardDef).
 */
export interface TemplateMeta {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly approvalState: TemplateApprovalState;
  readonly approvalChain: readonly ApprovalEvent[];
  readonly author: { readonly userId: string; readonly tenantId: string };
  readonly visibility: TemplateVisibility;
  readonly tags: readonly string[];
  /** SVG / image preview URI (data: or remote). Picker shows when set. */
  readonly preview?: string;
  readonly parameters?: readonly TemplateParameter[];
  readonly version?: string;
  readonly parentVersion?: string;
  /** ADR-046 D7 — schema version of the embedded body. */
  readonly schemaVersion?: number;
}

/**
 * Layout template — wraps a `LayoutDef` with workflow + visibility
 * metadata so adopters can publish named, versioned, approval-gated
 * layouts.
 *
 * The embedded `LayoutDef.slots` already carries the agent-emittable
 * `slotMap` field (ADR-046 PR1 lib types). Templates can leave
 * `slotMap` undefined and instead supply a `produce(params)` callback
 * — the picker's "instantiate" action runs that to materialize the
 * final SlotMap when the user fills the template parameters.
 */
export interface LayoutTemplate extends TemplateMeta {
  /** Underlying layout definition. */
  readonly body: LayoutDef;
}

/**
 * Dashboard template — analogous to `LayoutTemplate` but wraps a
 * `DashboardDef`. The dashboard's tiles + layout reference flow
 * through unchanged; the template adds catalog metadata + approval
 * workflow on top.
 */
export interface DashboardTemplate extends TemplateMeta {
  /** Underlying dashboard definition. */
  readonly body: DashboardDef;
}
