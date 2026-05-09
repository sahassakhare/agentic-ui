# ADR-017 · Audit chain — tamper-evident catalog audit log

**Status:** Accepted

**Date:** 2026-05-09

**Related:** [ADR-009](./0009-approval-intercept-and-audit-hook.md) · [ADR-015](./0015-catalog-server-design.md) · [ADR-016](./0016-iam-role-mapping.md)

---

## Context

The v0.1 catalog server already wrote every mutation to `catalog_audit`
inside the same transaction as the data write. That gave us atomic,
per-tenant, RLS-isolated, append-only-by-convention history.

What it did **not** give us:

1. **Tamper-evidence.** A DBA with `UPDATE catalog_audit` can edit a
   row and nothing in the schema notices.
2. **Verifiable export.** An auditor downloading 10 000 rows has no
   way to prove the export wasn't filtered or modified in transit.
3. **Cross-system anchoring.** Compliance frameworks (SOC 2 CC7.2,
   ISO 27001 A.12.4) increasingly want either signed logs or a
   demonstrable integrity check.

This ADR codifies the **hash-linked chain** added in M3 C4.

---

## Decision

### D1 — Per-tenant chain, not a global chain

Each tenant has its own chain head. Tampering with tenant A's history
does not invalidate tenant B's verification. Operationally this also
matches the RLS boundary — operators do not need cross-tenant reads
to verify a single tenant.

A global chain would require visibility across all tenants for the
verifier and would couple multi-tenant blast radius (one tampered
row per tenant invalidates everything). The per-tenant chain is the
right unit.

### D2 — `prev_hash` + `entry_hash` columns + dense `chain_position`

Schema (migration `003_audit_chain.sql`):

```sql
ALTER TABLE catalog_audit
  ADD COLUMN chain_position BIGINT NULL,
  ADD COLUMN prev_hash      CHAR(64) NULL,
  ADD COLUMN entry_hash     CHAR(64) NULL;

CREATE UNIQUE INDEX catalog_audit_chain_position_idx
  ON catalog_audit (tenant_id, chain_position)
  WHERE chain_position IS NOT NULL;
```

`chain_position` is **dense** (1, 2, 3, …) per tenant. Gaps would
indicate dropped or reordered rows; verifiers fail-fast on a gap.

The columns are **NULL-able** to accommodate the v0.1 rows that
existed before this migration — they cannot be retroactively chained
without forging signatures, so we leave them NULL and the verifier
explicitly skips them. Operators who care about pre-chain coverage
should snapshot pre-chain rows to an archive before applying this
migration.

### D3 — `entry_hash = sha256(prev_hash || canonical_row)`

`canonical_row` is a stable JSON encoding of:

- `tenantId`
- `actor`
- `requestId`
- `operation`
- `entityType`
- `entityId`
- `diff`

Keys are emitted lexicographically at every level; arrays preserve
order; `null` is preserved.

Why these fields and not `id` / `occurred_at`:

- `id` is `gen_random_uuid()` — re-derivable from the row, but its
  inclusion makes the hash dependent on a server-side default that's
  hard to reason about during verification.
- `occurred_at` is `now()` — same problem, with an extra wrinkle:
  Postgres's `now()` has microsecond precision and would couple the
  hash to the exact wall-clock time of the insert.

The trade-off is intentional: **`occurred_at` is reported alongside
the row but is not part of the hash**. A verifier therefore proves
"someone performed `operation` on `entityId` with this `diff`" but
not "at this exact wall-clock time." For SOC 2 / ISO 27001
attestations this is sufficient — the wall-clock claim is
witnessable separately by infrastructure logs.

### D4 — Genesis hash sentinel

The first row's `prev_hash` is a fixed all-zeros 64-character
string (`AUDIT_GENESIS_HASH`). Without this sentinel, an attacker
could rewrite history by emitting a row with `prev_hash = NULL` and
have it appear to be a valid chain head. The sentinel makes "no
prev row" a witnessable fact in the hash, not a missing field.

### D5 — Canonicalisation is application-side, not Postgres-side

We canonicalise in Node, not in SQL. Reasons:

- **Trust boundary.** The application already controls what goes
  into the row; doing the hash in the same trust zone means a
  single component owns integrity.
- **Postgres JSON ordering.** `jsonb` does not preserve insertion
  order; serialising back to text would not be deterministic without
  an extension or stored procedure. Doing it in Node with a tiny
  recursive sort is simpler and portable.

### D6 — Insert is serialised per tenant via `FOR UPDATE` on the chain head

To avoid two concurrent appenders racing for the same
`chain_position`, the insert path:

1. `SELECT … ORDER BY chain_position DESC LIMIT 1 FOR UPDATE` to
   lock the current chain head.
2. Compute the new hash.
3. INSERT with `chain_position = head.chain_position + 1`.

Audit volume is bounded (catalog mutations, not hot-path traffic)
so this lock is acceptable. If volume ever justifies it, a per-tenant
sequence would be a drop-in replacement — but `FOR UPDATE` is the
simpler thing first.

### D7 — Two operator-facing endpoints

- **`GET /v1/catalogs/{tenant}/audit/export`** — JSONL stream of
  rows in chronological order. `Content-Type:
  application/x-ndjson`. Optional `from` / `to` / `limit` query
  params. Per-line shape includes `chainPosition`, `prevHash`,
  `entryHash` so an external verifier can re-walk the chain
  end-to-end without database access.
- **`GET /v1/catalogs/{tenant}/audit/verify`** — server-side
  re-walk that returns
  `{valid, checkedRows, chainHead, brokenAt}`.
  Use cases: periodic ops health check; alerting hook
  (`brokenAt != null` ⇒ page oncall).

Both are RLS-scoped per tenant and require Bearer auth.

---

## Consequences

### Positive

- **Tamper-evident.** Editing a `diff` field in place breaks the
  chain at that position; the verifier surfaces it deterministically.
- **Auditable export.** Auditors download the JSONL file and an
  external script (we ship a 50-line Node example in the README)
  re-derives every `entry_hash`. No DB access needed.
- **Standards-aligned.** Aligns with the integrity expectations of
  SOC 2 CC7.2, ISO 27001 A.12.4. Self-hosters reuse the OSS
  primitive in their own SOC 2 controls.
- **Backwards-compatible.** Existing v0.1 rows stay in place; the
  chain begins on first append after migration.

### Negative / risks

- **`occurred_at` not in hash.** An attacker who edits *only* the
  `occurred_at` value but leaves the auditable fields intact does
  not break the chain. Documented and accepted (see D3); operators
  who need wall-clock integrity should ship infrastructure log
  forwarding to an immutable store (S3 Object Lock, GCS retention
  bucket) and cross-reference.
- **Per-tenant FOR UPDATE serialisation.** Audit append latency is
  O(catalog mutation rate). At demonstrated volumes (≪ 100 RPS for
  catalog mutations even in F500 deployments) this is fine. If a
  workload pushes through this we'll move to per-tenant sequences.
- **Canonicalisation drift.** Future schema additions (new
  auditable fields) MUST be added to the canonicaliser to be
  hash-covered. Not adding them is silent — they appear in the
  `diff` blob and the hash does cover that, but at-the-row level
  fields would leak. Mitigated by keeping the canonicaliser's
  field list co-located with the audit row's TypeScript shape; a
  reviewer notices on diff.
- **No retroactive chaining.** Pre-migration rows cannot be
  retroactively signed without forging history. Operators who care
  must archive separately before migration.

### Out of scope (deferred)

- **Sigstore / external anchoring.** Periodically anchor the chain
  head to a public log (Sigstore Rekor, Bitcoin block, Ethereum
  contract). Useful for "we cannot tamper even if we wanted to"
  claims. Deferred to M5+ when SOC 2 Type II observation begins.
- **Streaming export over chunked transfer.** Today the export
  endpoint buffers up to 100 000 rows; for tenants with millions
  of rows we'd want chunked-transfer streaming. Deferred until a
  real adopter hits the limit.
- **Audit replication / WAL forwarding.** Out-of-band durability
  beyond Postgres backups. Deferred to operator infra; we provide
  the JSONL export as the primitive.

---

## Implementation summary

- Migration: `platform/agentic-catalog-server/src/db/migrations/003_audit_chain.sql`
- Repository: `platform/agentic-catalog-server/src/repository/audit-repo.ts`
  — `appendAudit` (now returns the chained row), `verifyAuditChain`,
  `listAuditRowsForExport`, `AUDIT_GENESIS_HASH`
- Routes: `platform/agentic-catalog-server/src/routes/audit.ts`
  — `GET /audit/export`, `GET /audit/verify`
- Tests:
  - 7 new repository unit tests (genesis, link, verify clean, tamper
    detection, injection detection, key-order canonical stability,
    export ordering)
  - 5 routes integration tests (auth, export shape, verify, query
    validation, limit param)
- No changes required to existing call sites of `appendAudit` —
  callers ignore the return value, which is now `AuditRow` instead
  of `void`.
