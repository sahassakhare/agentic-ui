-- Up Migration

-- Tamper-evident hash chain over the catalog_audit table. Each row
-- carries a hash of (canonical row data || prev_hash); operators
-- can verify the chain end-to-end by re-walking it with the same
-- canonicalisation. See ADR-017.
--
-- The chain is per-tenant: tampering with one tenant's history does
-- not invalidate another tenant's. `chain_position` is dense
-- (1, 2, 3, ...) within a tenant, assigned at insert time.
--
-- Existing audit rows from the v0.1 release are not retroactively
-- chained — their hash columns stay NULL. The chain head is the
-- first row inserted after this migration. A one-shot backfill is
-- intentionally NOT included: signing rows that pre-date the chain
-- would defeat its tamper-evidence guarantee. Operators that want
-- coverage from day one should re-export their pre-chain audit
-- rows to a separate archive before running this migration.

ALTER TABLE catalog_audit
  ADD COLUMN IF NOT EXISTS chain_position BIGINT NULL;

ALTER TABLE catalog_audit
  ADD COLUMN IF NOT EXISTS prev_hash CHAR(64) NULL;

ALTER TABLE catalog_audit
  ADD COLUMN IF NOT EXISTS entry_hash CHAR(64) NULL;

-- Per-tenant chain position uniqueness. Partial index ignores rows
-- with NULL position (the pre-chain rows from v0.1).
CREATE UNIQUE INDEX IF NOT EXISTS catalog_audit_chain_position_idx
  ON catalog_audit (tenant_id, chain_position)
  WHERE chain_position IS NOT NULL;

CREATE INDEX IF NOT EXISTS catalog_audit_entry_hash_idx
  ON catalog_audit (entry_hash)
  WHERE entry_hash IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS catalog_audit_entry_hash_idx;
DROP INDEX IF EXISTS catalog_audit_chain_position_idx;
ALTER TABLE catalog_audit DROP COLUMN IF EXISTS entry_hash;
ALTER TABLE catalog_audit DROP COLUMN IF EXISTS prev_hash;
ALTER TABLE catalog_audit DROP COLUMN IF EXISTS chain_position;
