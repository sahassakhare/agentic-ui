import type {
  AuditEvent,
  Custodian,
  Document,
  LegalHold,
  Matter,
  ProductionSet,
} from './types.js';
import { computeChainHash } from './hash.js';

/**
 * In-memory mock data. Process-wide singleton — the agent server, the
 * MCP server, and the Angular shell (when run in the same workspace)
 * all hit the same `MockStore` instance through the framework-agnostic
 * accessor functions below.
 *
 * @remarks
 * **Not for production**. A real eDiscovery vendor would back these
 * stores with a relational DB (Postgres for metadata), a document
 * blob store (S3 for natives + image renditions), and an audit log
 * with append-only / write-once semantics. See the production-deployment
 * cookbook entry for the patterns we'd document at Phase 5.
 */
class MockStore {
  matters: Matter[] = [];
  custodians: Custodian[] = [];
  documents: Document[] = [];
  productionSets: ProductionSet[] = [];
  legalHolds: LegalHold[] = [];
  auditLog: AuditEvent[] = [];

  reset(): void {
    this.matters = [];
    this.custodians = [];
    this.documents = [];
    this.productionSets = [];
    this.legalHolds = [];
    this.auditLog = [];
    seedDefault(this);
  }
}

const store = new MockStore();
seedDefault(store);

// ─── Public accessors ─────────────────────────────────────────────────────

export function listMatters(): readonly Matter[] {
  return store.matters;
}

export function getMatter(id: string): Matter | undefined {
  return store.matters.find((m) => m.id === id);
}

export function listCustodians(matterId: string): readonly Custodian[] {
  return store.custodians.filter((c) => c.matterId === matterId);
}

export function getCustodian(id: string): Custodian | undefined {
  return store.custodians.find((c) => c.id === id);
}

export function addCustodian(custodian: Custodian): Custodian {
  store.custodians.push(custodian);
  return custodian;
}

export function updateCustodian(id: string, patch: Partial<Custodian>): Custodian | undefined {
  const idx = store.custodians.findIndex((c) => c.id === id);
  if (idx === -1) return undefined;
  const updated = { ...store.custodians[idx]!, ...patch } as Custodian;
  store.custodians[idx] = updated;
  return updated;
}

export function listLegalHolds(matterId: string): readonly LegalHold[] {
  return store.legalHolds.filter((h) => h.matterId === matterId);
}

export function getLegalHold(id: string): LegalHold | undefined {
  return store.legalHolds.find((h) => h.id === id);
}

export function addLegalHold(hold: LegalHold): LegalHold {
  store.legalHolds.push(hold);
  return hold;
}

export function updateLegalHold(id: string, patch: Partial<LegalHold>): LegalHold | undefined {
  const idx = store.legalHolds.findIndex((h) => h.id === id);
  if (idx === -1) return undefined;
  const updated = { ...store.legalHolds[idx]!, ...patch } as LegalHold;
  store.legalHolds[idx] = updated;
  return updated;
}

// ─── Production sets ──────────────────────────────────────────────────────

export function listProductionSets(matterId: string): readonly ProductionSet[] {
  return store.productionSets.filter((p) => p.matterId === matterId);
}

export function getProductionSet(id: string): ProductionSet | undefined {
  return store.productionSets.find((p) => p.id === id);
}

export function addProductionSet(set: ProductionSet): ProductionSet {
  store.productionSets.push(set);
  return set;
}

export function updateProductionSet(id: string, patch: Partial<ProductionSet>): ProductionSet | undefined {
  const idx = store.productionSets.findIndex((p) => p.id === id);
  if (idx === -1) return undefined;
  const updated = { ...store.productionSets[idx]!, ...patch } as ProductionSet;
  store.productionSets[idx] = updated;
  return updated;
}

export function listDocuments(matterId: string): readonly Document[] {
  return store.documents.filter((d) => d.matterId === matterId);
}

export function getDocument(id: string): Document | undefined {
  return store.documents.find((d) => d.id === id);
}

export function updateDocument(id: string, patch: Partial<Document>): Document | undefined {
  const idx = store.documents.findIndex((d) => d.id === id);
  if (idx === -1) return undefined;
  const updated = { ...store.documents[idx]!, ...patch } as Document;
  store.documents[idx] = updated;
  return updated;
}

/**
 * Naive full-text search across `contentSnippet`, `fileName`, and
 * `authoredBy`. Demo-grade — a real eDiscovery vendor wires this to
 * a Lucene/Elasticsearch index or a vector store. Phase 4's search
 * remote shows the `DataSourceRegistry` pattern that swaps the
 * implementation without touching tool handlers.
 */
export function searchDocuments(
  matterId: string,
  query: string,
  opts?: {
    readonly custodianIds?: readonly string[];
    readonly tags?: readonly string[];
    readonly excludeTags?: readonly string[];
    readonly limit?: number;
  },
): readonly Document[] {
  const q = query.trim().toLowerCase();
  const limit = opts?.limit ?? 25;
  const custodianFilter = opts?.custodianIds?.length ? new Set(opts.custodianIds) : null;
  const tagFilter = opts?.tags?.length ? new Set(opts.tags) : null;
  const excludeFilter = opts?.excludeTags?.length ? new Set(opts.excludeTags) : null;

  return store.documents
    .filter((d) => d.matterId === matterId)
    .filter((d) => !custodianFilter || custodianFilter.has(d.custodianId))
    .filter((d) => !tagFilter || d.tags.some((t) => tagFilter.has(t)))
    .filter((d) => !excludeFilter || !d.tags.some((t) => excludeFilter.has(t)))
    .filter((d) => {
      if (!q) return true;
      return (
        d.contentSnippet.toLowerCase().includes(q) ||
        d.fileName.toLowerCase().includes(q) ||
        (d.authoredBy?.toLowerCase().includes(q) ?? false)
      );
    })
    .slice(0, limit);
}

/**
 * Append an event to the matter's audit log, stamping the
 * tamper-evident chain hash in the process.
 *
 * @remarks
 * Looks up the matter's most recent prior event to compute the
 * `prevHash` link, then derives this event's `chainHash` so the
 * chain-of-custody report can verify integrity at any point. If
 * the caller already supplied a `chainHash` (e.g. replaying from
 * an external store) we trust it.
 */
export function appendAudit(event: AuditEvent): void {
  if (event.chainHash) {
    store.auditLog.push(event);
    return;
  }
  let prevHash: string | undefined;
  for (let i = store.auditLog.length - 1; i >= 0; i--) {
    const prev = store.auditLog[i]!;
    if (prev.matterId === event.matterId) {
      prevHash = prev.chainHash;
      break;
    }
  }
  const chainHash = computeChainHash(event, prevHash);
  store.auditLog.push({ ...event, prevHash, chainHash });
}

export function listAuditEvents(matterId: string, limit = 100): readonly AuditEvent[] {
  return store.auditLog.filter((e) => e.matterId === matterId).slice(-limit);
}

/** Test helper — wipes everything and reseeds the default fixture. */
export function resetMockStore(): void {
  store.reset();
}

// ─── Seed data ────────────────────────────────────────────────────────────

function seedDefault(s: MockStore): void {
  const matterId = 'M-2026-0042';

  s.matters.push({
    id: matterId,
    name: 'In re Acme Corp Securities Litigation',
    client: 'Acme Corp',
    partnerInCharge: 'Eleanor Vance',
    status: 'active',
    numberRange: 'ACME-0000001 to ACME-9999999',
    createdAt: '2026-02-15T09:00:00Z',
  });

  // Five seed custodians.
  const seedCustodians: Custodian[] = [
    { id: 'CUST-001', matterId, name: 'Sarah Chen', email: 'sarah.chen@acme.example', department: 'Engineering', hasLegalHold: true, collectionStatus: 'complete', documentCount: 412 },
    { id: 'CUST-002', matterId, name: 'Marcus Webb', email: 'marcus.webb@acme.example', department: 'Finance', hasLegalHold: true, collectionStatus: 'in-progress', documentCount: 287 },
    { id: 'CUST-003', matterId, name: 'Priya Patel', email: 'priya.patel@acme.example', department: 'Engineering', hasLegalHold: false, collectionStatus: 'pending', documentCount: 0 },
    { id: 'CUST-004', matterId, name: 'James O\'Brien', email: 'james.obrien@acme.example', department: 'Legal', hasLegalHold: true, collectionStatus: 'complete', documentCount: 156 },
    { id: 'CUST-005', matterId, name: 'Linh Nguyen', email: 'linh.nguyen@acme.example', department: 'Product', hasLegalHold: false, collectionStatus: 'pending', documentCount: 0 },
  ];
  s.custodians.push(...seedCustodians);

  // Seed two legal holds so demos of "Show pending hold acknowledgements"
  // and "Show all legal holds" both surface real data.
  //   HOLD-001: acknowledged within hours (the canonical happy-path hold)
  //   HOLD-002: pending — issued recently, custodians haven't ack'd yet
  s.legalHolds.push({
    id: 'HOLD-001',
    matterId,
    custodianIds: ['CUST-001', 'CUST-002', 'CUST-004'],
    scope: 'All emails, documents, and chat messages pertaining to Project Phoenix from 2024-09-01 onward.',
    issuedAt: '2026-02-16T14:00:00Z',
    acknowledgedAt: '2026-02-16T15:42:00Z',
  });
  s.legalHolds.push({
    id: 'HOLD-002',
    matterId,
    custodianIds: ['CUST-003', 'CUST-005'],
    scope: 'All Slack DMs, Jira tickets, and design-doc revisions referencing the Project Phoenix data-plane redesign — calendar window 2024-11-01 to 2025-03-31.',
    issuedAt: '2026-04-22T09:15:00Z',
    // No acknowledgedAt — hold is pending acknowledgement.
  });

  // Sample documents — small set, just enough to make the dashboard non-empty.
  // A real Phase 4 build would generate ~1000.
  s.documents.push(
    {
      id: 'DOC-7891234', matterId, custodianId: 'CUST-001',
      fileName: 'project-phoenix-brief.pdf', fileType: 'application/pdf', fileSize: 245_678,
      hash: 'sha256:a3f8d291…', authoredBy: 'Sarah Chen', authoredAt: '2025-01-15T10:30:00Z',
      contentSnippet: 'Project Phoenix overview and risk assessment for Q1 2025. The proposed architecture changes…',
      tags: ['responsive', 'review-needed'], redactions: [],
    },
    {
      id: 'DOC-7891235', matterId, custodianId: 'CUST-002',
      fileName: 're-projection-discrepancy.eml', fileType: 'message/rfc822', fileSize: 18_234,
      hash: 'sha256:b7e1f482…', authoredBy: 'Marcus Webb', authoredAt: '2025-02-08T16:12:00Z',
      contentSnippet: 'From: Marcus Webb <marcus.webb@acme.example>\nTo: CFO <cfo@acme.example>\nSubject: Re: Projection discrepancy\n\nI\'ve reviewed the variance and it doesn\'t match what we filed…',
      tags: ['responsive', 'hot'], redactions: [],
    },
    {
      id: 'DOC-7891236', matterId, custodianId: 'CUST-004',
      fileName: 'memo-attorney-client.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileSize: 67_890,
      hash: 'sha256:c2d5a193…', authoredBy: "James O'Brien", authoredAt: '2025-03-22T11:00:00Z',
      contentSnippet: 'Privileged & Confidential — Attorney-Client Communication\n\nMemo regarding our analysis of the SEC inquiry…',
      tags: ['privileged', 'review-needed'], privilegeReason: 'attorney-client', redactions: [],
    },
    {
      id: 'DOC-7891237', matterId, custodianId: 'CUST-001',
      fileName: 'phoenix-architecture-q1.pptx', fileType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', fileSize: 412_009,
      hash: 'sha256:d8e2b417…', authoredBy: 'Sarah Chen', authoredAt: '2025-01-22T09:14:00Z',
      contentSnippet: 'Project Phoenix architecture review Q1. Slide deck covering data plane redesign, on-call rotations, and service-level objectives...',
      tags: ['responsive'], redactions: [],
    },
    {
      id: 'DOC-7891238', matterId, custodianId: 'CUST-002',
      fileName: 'cfo-meeting-notes-2025-02-12.eml', fileType: 'message/rfc822', fileSize: 9_421,
      hash: 'sha256:e1c4f309…', authoredBy: 'Marcus Webb', authoredAt: '2025-02-12T18:42:00Z',
      contentSnippet: 'From: Marcus Webb\nTo: CFO\nSubject: Meeting notes — Project Phoenix budget overrun\n\nPer our discussion, we should not file the revised forecast until...',
      tags: ['hot', 'review-needed'], redactions: [],
    },
    {
      id: 'DOC-7891239', matterId, custodianId: 'CUST-001',
      fileName: 'slack-export-engineering-2025-Q1.json', fileType: 'application/json', fileSize: 1_204_500,
      hash: 'sha256:f3a9d827…', authoredBy: 'Sarah Chen', authoredAt: '2025-04-01T08:00:00Z',
      contentSnippet: 'Engineering channel export covering Project Phoenix discussion, code review threads, and incident retrospectives for Jan–Mar 2025.',
      tags: [], redactions: [],
    },
    {
      id: 'DOC-7891240', matterId, custodianId: 'CUST-004',
      fileName: 'litigation-strategy-draft.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileSize: 51_322,
      hash: 'sha256:0a1b2c3d…', authoredBy: "James O'Brien", authoredAt: '2025-04-08T16:55:00Z',
      contentSnippet: 'WORK PRODUCT — DRAFT — DO NOT DISTRIBUTE\n\nLitigation strategy memo prepared in anticipation of SEC enforcement proceedings...',
      tags: ['privileged'], privilegeReason: 'work-product', redactions: [],
    },
    {
      id: 'DOC-7891241', matterId, custodianId: 'CUST-002',
      fileName: 'q4-restatement-workbook.xlsx', fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileSize: 256_780,
      hash: 'sha256:9e8d7c6b…', authoredBy: 'Marcus Webb', authoredAt: '2025-03-03T11:24:00Z',
      contentSnippet: 'Restatement working papers — Q4 2024. Revenue adjustments by region; reconciliation tab covers Project Phoenix bookings.',
      tags: ['responsive', 'review-needed'], redactions: [],
    },
  );

  // Audit-trail history (appended actions create more entries at runtime).
  s.auditLog.push({
    id: 'AUDIT-0001', matterId, actor: 'system', action: 'matter.created',
    target: { type: 'matter', id: matterId }, timestamp: '2026-02-15T09:00:00Z',
  }, {
    id: 'AUDIT-0002', matterId, actor: 'eleanor.vance@firm.example', action: 'hold.issued',
    target: { type: 'legal-hold', id: 'HOLD-001' }, timestamp: '2026-02-16T14:00:00Z',
  });
}
