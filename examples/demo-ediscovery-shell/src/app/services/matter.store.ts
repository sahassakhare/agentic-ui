import { Injectable, signal } from '@angular/core';
import {
  appendAudit,
  isoNow,
  listCustodians,
  listLegalHolds,
  nextAuditId,
  type Custodian,
  type LegalHold,
} from '@maverick/demo-ediscovery-shared';
import { environment } from '../../environments/environment';

/**
 * Browser-side store for the active matter. Wraps the framework-agnostic
 * mock-data module from `@maverick/demo-ediscovery-shared` with Angular
 * signals for reactive views.
 *
 * @remarks
 * **Why a separate store on the browser side**: the shared mock-data
 * singleton lives in a different process when the agent server runs;
 * the two copies don't sync. Phase 0/1 demos run all tool handlers
 * client-side (`executeIn: 'host'`) so mutations land here and the
 * dashboard re-renders. A real eDiscovery vendor would replace this
 * with HTTP calls to a real backend through `DataSourceRegistry`
 * (cookbook entry for that pattern lands in Phase 4).
 *
 * Every mutation also emits an audit event — the chain-of-custody
 * substrate Phase 5 expands on.
 */
@Injectable({ providedIn: 'root' })
export class MatterStore {
  readonly matterId = environment.matterId;

  readonly custodians = signal<readonly Custodian[]>(listCustodians(this.matterId));
  readonly legalHolds = signal<readonly LegalHold[]>(listLegalHolds(this.matterId));

  // ── Custodians ──────────────────────────────────────────────────────────

  addCustodian(custodian: Custodian): void {
    this.custodians.update((list) => [...list, custodian]);
    this.audit({
      actor: this.actor(),
      action: 'custodian.added',
      target: { type: 'custodian', id: custodian.id },
      after: { name: custodian.name, department: custodian.department },
    });
  }

  patchCustodian(id: string, patch: Partial<Custodian>): Custodian | undefined {
    let updated: Custodian | undefined;
    this.custodians.update((list) =>
      list.map((c) => {
        if (c.id !== id) return c;
        updated = { ...c, ...patch };
        return updated;
      }),
    );
    if (updated) {
      this.audit({
        actor: this.actor(),
        action: 'custodian.updated',
        target: { type: 'custodian', id },
        after: patch,
      });
    }
    return updated;
  }

  // ── Legal holds ─────────────────────────────────────────────────────────

  addLegalHold(hold: LegalHold): void {
    this.legalHolds.update((list) => [...list, hold]);
    // Mark every covered custodian as on-hold.
    for (const custodianId of hold.custodianIds) {
      this.patchCustodianHoldFlag(custodianId, true);
    }
    this.audit({
      actor: this.actor(),
      action: 'hold.issued',
      target: { type: 'legal-hold', id: hold.id },
      after: { custodianCount: hold.custodianIds.length, scope: hold.scope },
    });
  }

  releaseLegalHold(id: string, reason?: string): LegalHold | undefined {
    let released: LegalHold | undefined;
    this.legalHolds.update((list) =>
      list.map((h) => {
        if (h.id !== id) return h;
        released = { ...h, releasedAt: isoNow() };
        return released;
      }),
    );
    if (released) {
      // Recompute hold flags — a custodian only loses the flag if no
      // other active hold still covers them.
      const activeHolds = this.legalHolds().filter((h) => !h.releasedAt);
      const stillCovered = new Set<string>();
      for (const h of activeHolds) for (const c of h.custodianIds) stillCovered.add(c);
      for (const cid of released.custodianIds) {
        if (!stillCovered.has(cid)) this.patchCustodianHoldFlag(cid, false);
      }
      this.audit({
        actor: this.actor(),
        action: 'hold.released',
        target: { type: 'legal-hold', id },
        reason,
      });
    }
    return released;
  }

  acknowledgeLegalHold(id: string): LegalHold | undefined {
    let updated: LegalHold | undefined;
    this.legalHolds.update((list) =>
      list.map((h) => {
        if (h.id !== id) return h;
        updated = { ...h, acknowledgedAt: isoNow() };
        return updated;
      }),
    );
    if (updated) {
      this.audit({
        actor: this.actor(),
        action: 'hold.acknowledged',
        target: { type: 'legal-hold', id },
      });
    }
    return updated;
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private patchCustodianHoldFlag(id: string, hasLegalHold: boolean): void {
    this.custodians.update((list) =>
      list.map((c) => (c.id === id ? { ...c, hasLegalHold } : c)),
    );
  }

  private actor(): string {
    // Phase 0 stub — Phase 7's persona shim threads a real user id.
    return `${environment.persona}@firm.example`;
  }

  private audit(partial: Omit<Parameters<typeof appendAudit>[0], 'id' | 'matterId' | 'timestamp'>): void {
    appendAudit({
      id: nextAuditId(),
      matterId: this.matterId,
      timestamp: isoNow(),
      ...partial,
    });
  }
}
