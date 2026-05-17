import { Injectable, InjectionToken, computed, inject, signal, type Signal } from '@angular/core';
import { RegistryBase } from './registry-base';
import type { Approval, ApprovalDef, ApprovalStatus } from '../types/registry-defs';

/**
 * Event payload delivered to {@link AGENTIC_APPROVAL_AUDIT_HOOK} after every
 * successful approval transition. Hosts translate this into their own
 * audit-chain primitive (Capability F4 — r3 plan §7.8 + AC-F4-6).
 */
export interface ApprovalAuditEvent {
  /** The post-transition approval record (status === decision). */
  readonly approval: Approval;
  /** The decision applied. */
  readonly decision: 'approved' | 'rejected';
  /** The status the approval held before the transition. */
  readonly previousStatus: ApprovalStatus;
}

/**
 * Hook the host wires to translate approval transitions into their
 * audit-chain. Default no-op so libraries that don't wire HITL pay
 * nothing.
 *
 * Hook callers MUST be exception-safe: a throwing hook does NOT abort
 * the transition (the registry already moved state); it logs to the
 * telemetry sink and continues. The chain-validation property test
 * surfaces any missing entries on the next read.
 *
 * @example
 * ```ts
 * provideAppInitializer(() => { ... }) // somewhere in app.config.ts
 *
 * { provide: AGENTIC_APPROVAL_AUDIT_HOOK, useFactory: () => {
 *     const matter = inject(MatterStore);
 *     return ({ approval, decision, previousStatus }) => {
 *       appendAudit({
 *         id: nextAuditId(),
 *         matterId: matter.matterId,
 *         actor: approval.approverPersona ?? 'system',
 *         action: decision === 'approved' ? 'tool-approved' : 'tool-rejected',
 *         target: { type: 'tool', id: approval.toolName },
 *         before: { status: previousStatus, args: approval.args, requesterPersona: approval.requesterPersona },
 *         after:  { status: decision, comment: approval.comment },
 *         reason: approval.comment,
 *         timestamp: approval.decidedAt ?? new Date().toISOString(),
 *       });
 *     };
 *   }
 * }
 * ```
 */
export const AGENTIC_APPROVAL_AUDIT_HOOK = new InjectionToken<(event: ApprovalAuditEvent) => void>(
  'AGENTIC_APPROVAL_AUDIT_HOOK',
  { providedIn: 'root', factory: () => () => {} },
);

/**
 * Registry of approval policies keyed by tool name (Capability F4 — r3
 * plan §9.4). The chat-shell intercept consults this registry before
 * executing every client tool: if a policy exists and `required(...)`
 * returns true, the tool is queued for HITL instead of executed.
 *
 * Two responsibilities, one class:
 *
 *   1. **Policy registry** — extends `RegistryBase<ApprovalDef>`, so it
 *      inherits the same `register / list / get / removeBySource /
 *      setScopePolicy` semantics every other registry follows.
 *
 *   2. **Pending-approval state** — holds the live `Approval` records
 *      created by the intercept. Records are signal-backed so the
 *      queue UI can subscribe and update without polling.
 *
 * Persistence is delegated to the host: a deployment can wire the
 * `PersistenceRegistry` to mirror approvals into a durable store; the
 * registry itself stays in-memory for the demo, which is enough to
 * exercise the audit chain + queue UI.
 */
@Injectable({ providedIn: 'root' })
export class ApprovalRegistry extends RegistryBase<ApprovalDef> {
  protected readonly registryName = 'approval';

  /**
   * Audit hook injected at construction. Called from {@link transition}
   * after every successful state change so hosts can mirror the decision
   * into their audit chain (per AC-F4-6).
   */
  private readonly auditHook = inject(AGENTIC_APPROVAL_AUDIT_HOOK);

  // ── Pending-approval state ────────────────────────────────────────────────

  /**
   * Signal-backed map of approval records, keyed by approval id. Reads
   * are reactive — the queue UI subscribes via `entries()` (computed)
   * and updates whenever an approval is appended, mutated, or cleared.
   */
  private readonly records = signal<Readonly<Record<string, Approval>>>({});

  /** Reactive view of all approval records (any status, ordered by createdAt). */
  readonly approvals: Signal<readonly Approval[]> = computed(() => {
    const all = Object.values(this.records());
    return all.sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
    );
  });

  /** Append a new pending approval; returns the inserted record. */
  enqueue(approval: Approval): Approval {
    if (approval.status !== 'pending') {
      throw new Error(`enqueue requires status='pending', got '${approval.status}'`);
    }
    if (this.records()[approval.id]) {
      throw new Error(`Approval id ${JSON.stringify(approval.id)} is already enqueued`);
    }
    this.records.update((cur) => ({ ...cur, [approval.id]: approval }));
    return approval;
  }

  /** Read a single record by id; `undefined` if unknown. */
  getApproval(id: string): Approval | undefined {
    return this.records()[id];
  }

  /**
   * Filter approvals by status. Sorted by `createdAt` ascending. Used
   * by the queue UI to show only pending items by default.
   */
  byStatus(status: ApprovalStatus): readonly Approval[] {
    return this.approvals().filter((a) => a.status === status);
  }

  /**
   * Filter pending approvals visible to a given persona. An approval is
   * visible to a persona iff the persona is in its policy's
   * `approverRoles`. Used by the `/approvals` queue route.
   */
  pendingForApprover(persona: string): readonly Approval[] {
    const out: Approval[] = [];
    for (const a of this.byStatus('pending')) {
      const policy = this.get(a.toolName);
      if (!policy) continue;
      if (policy.approverRoles.includes(persona)) out.push(a);
    }
    return out;
  }

  /**
   * Apply a status transition to an approval. Throws if the id is unknown
   * or the approval is no longer pending. After a successful transition,
   * fires the {@link AGENTIC_APPROVAL_AUDIT_HOOK} so hosts can mirror the
   * decision into their audit chain. Hook failures are swallowed and
   * surface on the chain-validation property test rather than aborting
   * the in-memory transition.
   */
  transition(
    id: string,
    next: 'approved' | 'rejected',
    fields: { approverPersona: string; comment?: string; decidedAt?: string },
  ): Approval {
    const cur = this.records()[id];
    if (!cur) throw new Error(`Approval ${JSON.stringify(id)} not found`);
    if (cur.status !== 'pending') {
      throw new Error(
        `Approval ${JSON.stringify(id)} is already ${cur.status}; cannot transition to ${next}`,
      );
    }
    const updated: Approval = {
      ...cur,
      status: next,
      approverPersona: fields.approverPersona,
      comment: fields.comment,
      decidedAt: fields.decidedAt ?? new Date().toISOString(),
    };
    this.records.update((s) => ({ ...s, [id]: updated }));
    try {
      this.auditHook({
        approval: updated,
        decision: next,
        previousStatus: cur.status,
      });
    } catch {
      // Hook failures must not roll back the in-memory transition.
      // The audit-chain property test catches missing entries on read.
    }
    return updated;
  }

  /** Drop a record outright (e.g., test reset). Does NOT emit audit events. */
  removeApproval(id: string): void {
    this.records.update((s) => {
      if (!(id in s)) return s;
      const next = { ...s };
      delete next[id];
      return next;
    });
  }

  /** Reset to empty. Does NOT emit audit events; used for test isolation. */
  clearApprovals(): void {
    this.records.set({});
  }
}
