/**
 * Domain models for the eDiscovery example application.
 *
 * @remarks
 * Framework-agnostic — these types are consumed by:
 *  - `demo-ediscovery-server` (Node — agent server, tool handlers)
 *  - `demo-ediscovery-shell` (Angular — chat host, dashboards)
 *  - `demo-ediscovery-mcp` (Node — MCP server for analyst workstations)
 *
 * Sharing one type definition across all three consumers is the
 * "one handler, multiple surfaces" pattern from ADR-006: a tool's
 * domain shape is portable.
 *
 * **Library-grade vs deployable**: this is a *demo* domain model. A
 * real eDiscovery vendor would model far more — file-format-specific
 * metadata (eml / msg / pst), processing pipeline state (OCR, dedupe,
 * near-duplicate clustering), retention schedules, etc. The types here
 * are deliberately scoped to what the library demos need to exercise.
 */

/** A legal matter — the top-level container for all eDiscovery work. */
export interface Matter {
  readonly id: string;                     // 'M-2026-0042'
  readonly name: string;                   // 'In re Acme Corp Securities Litigation'
  readonly client: string;
  readonly partnerInCharge: string;
  readonly status: 'active' | 'closed' | 'on-hold';
  /** Reserved Bates range, e.g. 'ACME-0000001 to ACME-9999999'. */
  readonly numberRange: string;
  readonly createdAt: string;              // ISO 8601
}

/** A person (or system) whose documents are being collected. */
export interface Custodian {
  readonly id: string;                     // 'CUST-4321'
  readonly matterId: string;
  readonly name: string;
  readonly email: string;
  readonly department: string;
  readonly hasLegalHold: boolean;
  readonly collectionStatus: 'pending' | 'in-progress' | 'complete';
  readonly documentCount: number;
}

/** A single electronic document in a matter. */
export interface Document {
  readonly id: string;                     // 'DOC-7891234'
  readonly matterId: string;
  readonly custodianId: string;
  /** Bates number assigned at production time (omitted while in review). */
  readonly bates?: string;                 // 'ACME-0001234'
  readonly fileName: string;
  readonly fileType: string;
  readonly fileSize: number;
  /** sha256 — chain-of-custody hash. */
  readonly hash: string;
  readonly authoredBy?: string;
  readonly authoredAt?: string;            // ISO 8601
  readonly modifiedAt?: string;            // ISO 8601
  /** First ~500 chars of extracted text — what the chat shell shows in previews. */
  readonly contentSnippet: string;
  readonly tags: readonly DocumentTag[];
  readonly privilegeReason?: PrivilegeReason;
  readonly redactions: readonly RedactionSpan[];
  readonly productionSet?: string;         // production-set id
}

export type DocumentTag = 'responsive' | 'non-responsive' | 'privileged' | 'hot' | 'redact' | 'review-needed';

export type PrivilegeReason = 'attorney-client' | 'work-product' | 'common-interest';

export interface RedactionSpan {
  readonly page: number;
  readonly bbox: readonly [number, number, number, number];   // x, y, w, h
  readonly reason: 'pii' | 'privilege' | 'confidential';
  readonly appliedBy: string;
  readonly appliedAt: string;
}

/** A grouping of documents prepared for delivery to opposing counsel. */
export interface ProductionSet {
  readonly id: string;                     // 'PROD-001'
  readonly matterId: string;
  readonly name: string;
  readonly format: 'native' | 'tiff' | 'pdf' | 'load-file';
  /** Bates pattern with `{seq}` placeholder, e.g. 'ACME-{seq:07d}'. */
  readonly batesPattern: string;
  readonly documents: readonly string[];
  readonly status: 'draft' | 'review' | 'finalized' | 'delivered';
  readonly createdAt: string;
  readonly finalisedAt?: string;
}

/** A legal hold issued to one or more custodians. */
export interface LegalHold {
  readonly id: string;                     // 'HOLD-001'
  readonly matterId: string;
  readonly custodianIds: readonly string[];
  /** Free-text scope description sent in the hold notice. */
  readonly scope: string;
  readonly issuedAt: string;
  readonly acknowledgedAt?: string;
  readonly releasedAt?: string;
}

/** One immutable audit-trail entry — chain of custody / defensibility. */
export interface AuditEvent {
  readonly id: string;
  readonly matterId: string;
  /** Actor identifier — user id, agent id, or 'system'. */
  readonly actor: string;
  /** Verb-form action name, e.g. 'document.tag', 'production.finalise'. */
  readonly action: string;
  readonly target: { readonly type: string; readonly id: string };
  /** Optional state diff for changes consumers want to render. */
  readonly before?: unknown;
  readonly after?: unknown;
  /** User-provided justification — required for sensitive actions in real deployments. */
  readonly reason?: string;
  readonly timestamp: string;
  /**
   * Tamper-evident chain hash — computed from the previous event's hash
   * plus this event's content. Phase 5 adds this; older entries seeded
   * before the chain was wired carry `undefined` and are flagged in the
   * chain-of-custody report.
   */
  readonly chainHash?: string;
  /** Hash of the previous event in the matter's chain, if any. */
  readonly prevHash?: string;
}
