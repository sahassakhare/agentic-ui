/**
 * Audit-chain verification + chain-of-custody report builder.
 * Phase 5 wiring.
 *
 * @remarks
 * `appendAudit` (in `mock-data.ts`) auto-stamps each event with a
 * chain hash. This module re-walks the chain to verify it and
 * builds the user-facing chain-of-custody report.
 *
 * Real eDiscovery deployments back the chain with a write-once /
 * append-only store and an HMAC keyed off a per-matter secret kept
 * in an HSM. The demo uses the deterministic FNV-1a hash from
 * `hash.ts` so the demo runs offline and tests are repeatable;
 * swapping in SHA-256 is a one-function change.
 */
import type { AuditEvent, ProductionSet } from './types.js';
import { computeChainHash } from './hash.js';
import { listAuditEvents, listDocuments } from './mock-data.js';

export { computeChainHash } from './hash.js';

/** Result of verifying the matter's audit chain. */
export interface ChainVerification {
  readonly events: number;
  readonly chained: number;       // events with non-null chainHash
  readonly verified: number;      // events whose chainHash recomputes
  readonly broken: ReadonlyArray<{ id: string; reason: 'no-hash' | 'mismatch' }>;
  readonly head: string | null;   // chainHash of the latest event
}

/**
 * Walk the matter's audit log in order, recompute each chain hash,
 * and report any breaks. Drives the chain-of-custody report and the
 * Audit-Trail page's integrity badge.
 */
export function verifyAuditChain(matterId: string): ChainVerification {
  const events = listAuditEvents(matterId, 1000);
  const broken: { id: string; reason: 'no-hash' | 'mismatch' }[] = [];
  let prevHash: string | undefined;
  let chained = 0;
  let verified = 0;
  for (const e of events) {
    if (!e.chainHash) {
      broken.push({ id: e.id, reason: 'no-hash' });
    } else {
      chained += 1;
      const expected = computeChainHash(e, prevHash);
      if (expected === e.chainHash) verified += 1;
      else broken.push({ id: e.id, reason: 'mismatch' });
    }
    prevHash = e.chainHash ?? prevHash;
  }
  return {
    events: events.length,
    chained,
    verified,
    broken,
    head: prevHash ?? null,
  };
}

/** A single line in the chain-of-custody report. */
export interface ChainOfCustodyLine {
  readonly timestamp: string;
  readonly actor: string;
  readonly action: string;
  readonly target: { readonly type: string; readonly id: string };
  readonly reason?: string;
  readonly chainHash?: string;
  readonly verified: boolean;
}

/** Built chain-of-custody report. */
export interface ChainOfCustodyReport {
  readonly matterId: string;
  readonly productionId: string;
  readonly title: string;
  readonly generatedAt: string;
  readonly summary: {
    readonly documentCount: number;
    readonly totalRedactions: number;
    readonly auditEventsTotal: number;
    readonly auditEventsRelevant: number;
    readonly chainVerified: boolean;
  };
  readonly lines: readonly ChainOfCustodyLine[];
  readonly chain: ChainVerification;
}

/**
 * Build a chain-of-custody report for a production set. Walks the
 * matter's audit log, filters to events touching this production
 * set's id or any of its documents, and verifies the hash chain.
 */
export function buildChainOfCustodyReport(
  matterId: string,
  production: ProductionSet,
  generatedAtIso: string,
): ChainOfCustodyReport {
  const events = listAuditEvents(matterId, 1000);
  const docIds = new Set(production.documents);

  const chain = verifyAuditChain(matterId);
  // Per-event verification — single pass over the matter's chain.
  const verifiedSet = new Set<string>();
  let prevHash: string | undefined;
  for (const e of events) {
    if (e.chainHash && computeChainHash(e, prevHash) === e.chainHash) {
      verifiedSet.add(e.id);
    }
    prevHash = e.chainHash ?? prevHash;
  }

  const lines: ChainOfCustodyLine[] = [];
  for (const e of events) {
    const relevant =
      (e.target.type === 'production-set' && e.target.id === production.id) ||
      (e.target.type === 'document' && docIds.has(e.target.id)) ||
      (e.target.type === 'matter' && e.target.id === matterId &&
        e.action.startsWith('production'));
    if (!relevant) continue;
    lines.push({
      timestamp: e.timestamp,
      actor: e.actor,
      action: e.action,
      target: e.target,
      reason: e.reason,
      chainHash: e.chainHash,
      verified: verifiedSet.has(e.id),
    });
  }

  const docs = listDocuments(matterId).filter((d) => docIds.has(d.id));
  const totalRedactions = docs.reduce((n, d) => n + d.redactions.length, 0);

  return {
    matterId,
    productionId: production.id,
    title: `Chain of Custody — ${production.name}`,
    generatedAt: generatedAtIso,
    summary: {
      documentCount: production.documents.length,
      totalRedactions,
      auditEventsTotal: events.length,
      auditEventsRelevant: lines.length,
      chainVerified: chain.broken.length === 0 && chain.chained > 0,
    },
    lines,
    chain,
  };
}
