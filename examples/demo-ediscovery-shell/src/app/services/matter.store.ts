import { Injectable, signal } from '@angular/core';
import {
  appendAudit,
  getDocument,
  isoNow,
  listAuditEvents,
  listCustodians,
  listDocuments,
  listLegalHolds,
  nextAuditId,
  updateDocument,
  type AuditEvent,
  type Custodian,
  type Document,
  type DocumentTag,
  type LegalHold,
  type PrivilegeReason,
} from '@infra-tools/demo-ediscovery-shared';
import { environment } from '../../environments/environment';

/**
 * Browser-side store for the active matter. Wraps the framework-agnostic
 * mock-data module from `@infra-tools/demo-ediscovery-shared` with Angular
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
 *
 * **Persistence (2026-05-11):** every mutation snapshots
 * { custodians, legalHolds, auditLog } to `localStorage` so the
 * /audit page survives a browser refresh. The shared mock-data
 * module's in-memory store is treated as the boot fixture; once we
 * rehydrate the snapshot wins. Clear via `clearPersisted()` or via
 * `localStorage.removeItem('ediscovery:matter-state:<matterId>')`.
 */

const STORAGE_PREFIX = 'ediscovery:matter-state:';

/**
 * eDiscovery matter lifecycle phases. Drives the matter-phase
 * precedence layer in the LayoutResolver (ADR-046 D2 weight 300) and
 * the `<matter phase="..." />` fragment in the agent context block
 * (ADR-047 D3). Adopters can extend with custom phases by widening
 * the type here + adding handler logic in `setPhase`.
 */
export type MatterPhase = 'collection' | 'review' | 'production' | 'closed';

interface PersistedState {
  readonly version: 1 | 2;
  readonly matterId: string;
  readonly custodians: readonly Custodian[];
  readonly legalHolds: readonly LegalHold[];
  readonly auditLog: readonly AuditEvent[];
  readonly phase?: MatterPhase;
}

@Injectable({ providedIn: 'root' })
export class MatterStore {
  readonly matterId = environment.matterId;
  private readonly storageKey = `${STORAGE_PREFIX}${this.matterId}`;

  readonly custodians = signal<readonly Custodian[]>([]);
  readonly legalHolds = signal<readonly LegalHold[]>([]);
  /** Mirror of the shared-module audit log -- exposed as a signal
   *  so the /audit page reacts to mutations without polling. */
  readonly auditLog = signal<readonly AuditEvent[]>([]);

  /**
   * Slice A reactivity gate — increment whenever any document is
   * tagged / untagged / privilege-marked. Widgets that need to
   * re-read `listDocuments` / `getDocument` watch this signal so the
   * underlying mock-data mutation surfaces in their `computed()`.
   */
  readonly documentMutation = signal(0);

  /**
   * ADR-047 D3 — matter lifecycle phase. Drives `<matter phase="..." />`
   * in the agent context block and feeds the `matter-phase` precedence
   * layer (weight 300) once a `MatterPhaseLayoutInput` is wired. Default
   * `'review'` for the demo's seeded matter, matching its data state.
   */
  readonly phase = signal<MatterPhase>('review');

  /**
   * Transition the matter to a new phase. Persists via the same path
   * as other state mutations + appends an audit event for chain-hash
   * defensibility. Production hosts gate this on lead-counsel role.
   */
  setPhase(next: MatterPhase): void {
    const before = this.phase();
    if (before === next) return;
    this.phase.set(next);
    this.audit({
      actor: this.actor(),
      action: 'matter.phase.changed',
      target: { type: 'matter', id: this.matterId },
      before: { phase: before },
      after: { phase: next },
    });
    this.persist();
  }

  constructor() {
    this.hydrate();
  }

  // ── Custodians ──────────────────────────────────────────────────────────

  addCustodian(custodian: Custodian): void {
    this.custodians.update((list) => [...list, custodian]);
    this.audit({
      actor: this.actor(),
      action: 'custodian.added',
      target: { type: 'custodian', id: custodian.id },
      after: {
        id: custodian.id,
        name: custodian.name,
        email: custodian.email,
        department: custodian.department,
        hasLegalHold: custodian.hasLegalHold,
        collectionStatus: custodian.collectionStatus,
        documentCount: custodian.documentCount,
      },
    });
    this.persist();
  }

  patchCustodian(id: string, patch: Partial<Custodian>): Custodian | undefined {
    let updated: Custodian | undefined;
    let before: Custodian | undefined;
    this.custodians.update((list) =>
      list.map((c) => {
        if (c.id !== id) return c;
        before = c;
        updated = { ...c, ...patch };
        return updated;
      }),
    );
    if (updated && before) {
      this.audit({
        actor: this.actor(),
        action: 'custodian.updated',
        target: { type: 'custodian', id },
        before: pickChanged(before, patch),
        after: pickChanged(updated, patch),
      });
      this.persist();
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
      after: {
        id: hold.id,
        custodianIds: hold.custodianIds,
        custodianCount: hold.custodianIds.length,
        scope: hold.scope,
        issuedAt: hold.issuedAt,
      },
    });
    this.persist();
  }

  releaseLegalHold(id: string, reason?: string): LegalHold | undefined {
    let released: LegalHold | undefined;
    let before: LegalHold | undefined;
    this.legalHolds.update((list) =>
      list.map((h) => {
        if (h.id !== id) return h;
        before = h;
        released = { ...h, releasedAt: isoNow() };
        return released;
      }),
    );
    if (released && before) {
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
        before: { releasedAt: before.releasedAt ?? null },
        after: {
          releasedAt: released.releasedAt,
          custodiansCovered: released.custodianIds.length,
          scope: released.scope,
        },
        reason,
      });
      this.persist();
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
        after: { acknowledgedAt: updated.acknowledgedAt, scope: updated.scope },
      });
      this.persist();
    }
    return updated;
  }

  /** Operator-facing escape hatch — wipes the persisted snapshot
   *  and rehydrates from the shared-module seed fixture. Bound to a
   *  future "Reset matter" button on the audit page. */
  clearPersisted(): void {
    try { localStorage.removeItem(this.storageKey); } catch { /* private mode / quota */ }
    this.seedFromFixture();
  }

  // ── Documents (Slice A) ─────────────────────────────────────────────────

  /**
   * Add a tag to a document. Mutates the shared-module store, appends
   * an audit event, increments the document-mutation counter so
   * widgets re-read. No-op when the doc already carries the tag.
   *
   * `actor` defaults to the active persona (caller may override for
   * agent-dispatched calls). Returns the updated doc or undefined.
   */
  tagDocument(id: string, tag: DocumentTag, actor?: string): Document | undefined {
    const doc = getDocument(id);
    if (!doc) return undefined;
    if (doc.tags.includes(tag)) return doc;
    const next = [...doc.tags, tag] as readonly DocumentTag[];
    const updated = updateDocument(id, { tags: next });
    this.audit({
      actor: actor ?? this.actor(),
      action: 'document.tag.added',
      target: { type: 'document', id },
      before: { tags: [...doc.tags] },
      after: { tags: next },
    });
    this.documentMutation.update((v) => v + 1);
    return updated;
  }

  /**
   * Remove a tag. Same semantics as `tagDocument` in reverse.
   */
  untagDocument(id: string, tag: DocumentTag, actor?: string): Document | undefined {
    const doc = getDocument(id);
    if (!doc) return undefined;
    if (!doc.tags.includes(tag)) return doc;
    const next = doc.tags.filter((t) => t !== tag) as readonly DocumentTag[];
    const updated = updateDocument(id, { tags: next });
    this.audit({
      actor: actor ?? this.actor(),
      action: 'document.tag.removed',
      target: { type: 'document', id },
      before: { tags: [...doc.tags] },
      after: { tags: next },
    });
    this.documentMutation.update((v) => v + 1);
    return updated;
  }

  /**
   * Bulk-tag a set of documents. Emits one audit event per document
   * touched (skips no-ops). Returns the count actually modified.
   */
  bulkTagDocuments(ids: readonly string[], tag: DocumentTag, actor?: string): number {
    let modified = 0;
    for (const id of ids) {
      const before = getDocument(id);
      const after = this.tagDocument(id, tag, actor);
      if (after && before && !before.tags.includes(tag)) modified += 1;
    }
    return modified;
  }

  /**
   * Set the privilege reason on a document — drives the privilege-log
   * widget. Pairs naturally with `tagDocument(id, 'privileged')`;
   * adopters can do them together or separately depending on workflow.
   */
  setDocumentPrivilegeReason(id: string, reason: PrivilegeReason | null, actor?: string): Document | undefined {
    const doc = getDocument(id);
    if (!doc) return undefined;
    if (doc.privilegeReason === reason) return doc;
    const updated = updateDocument(id, { privilegeReason: reason ?? undefined });
    this.audit({
      actor: actor ?? this.actor(),
      action: 'document.privilege.reason',
      target: { type: 'document', id },
      before: { privilegeReason: doc.privilegeReason ?? null },
      after: { privilegeReason: reason },
    });
    this.documentMutation.update((v) => v + 1);
    return updated;
  }

  /**
   * Convenience — list all documents in this matter. Wraps the
   * shared-module function so callers don't have to import it +
   * pass matterId; also lets widgets re-evaluate on every mutation
   * by reading `documentMutation` alongside.
   */
  documents(): readonly Document[] {
    return listDocuments(this.matterId);
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
    const evt = {
      id: nextAuditId(),
      matterId: this.matterId,
      timestamp: isoNow(),
      ...partial,
    };
    appendAudit(evt);
    // Mirror the just-appended row (with its chainHash + prevHash)
    // into our signal-backed copy by re-reading the shared list.
    this.auditLog.set(listAuditEvents(this.matterId, 1000));
  }

  /**
   * Best-effort rehydration: try localStorage first; fall back to
   * the shared module's seed fixture. The shared module's audit
   * chain is already loaded with seed events, so on a fresh install
   * the audit log isn't empty.
   */
  private hydrate(): void {
    const persisted = this.loadPersisted();
    if (persisted) {
      this.custodians.set(persisted.custodians);
      this.legalHolds.set(persisted.legalHolds);
      this.auditLog.set(persisted.auditLog);
      if (persisted.phase) this.phase.set(persisted.phase);
      // Replay the persisted audit log into the shared module's
      // in-memory store so callers that read via listAuditEvents()
      // see the same events. Skip-rehash because chainHash is
      // already populated.
      for (const evt of persisted.auditLog) appendAudit(evt);
    } else {
      this.seedFromFixture();
    }
  }

  private seedFromFixture(): void {
    this.custodians.set(listCustodians(this.matterId));
    this.legalHolds.set(listLegalHolds(this.matterId));
    this.auditLog.set(listAuditEvents(this.matterId, 1000));
  }

  private loadPersisted(): PersistedState | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersistedState;
      if ((parsed?.version !== 1 && parsed?.version !== 2) || parsed.matterId !== this.matterId) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private persist(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const snapshot: PersistedState = {
        version: 2,
        matterId: this.matterId,
        custodians: this.custodians(),
        legalHolds: this.legalHolds(),
        auditLog: this.auditLog(),
        phase: this.phase(),
      };
      localStorage.setItem(this.storageKey, JSON.stringify(snapshot));
    } catch {
      /* quota exceeded / private mode — silently degrade to
         in-memory-only. Next mutation may retry. */
    }
  }
}

/** Return only the keys of `obj` that appear in `patch`. Lets the
 *  diff payload stay focused on what actually changed. */
function pickChanged<T extends object>(obj: T, patch: Partial<T>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(patch) as (keyof T)[]) {
    out[k as string] = obj[k];
  }
  return out;
}
