-- Up Migration

-- Extend the tenants table with the lifecycle metadata operators need
-- to onboard / suspend / off-board tenants through the API. The v0.1
-- table already has `id`, `display_name`, `status`, `created_at`,
-- `updated_at` — we add the operational + governance fields. See
-- ADR-020.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS quotas         JSONB       NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS onboarded_by   TEXT        NULL,
  ADD COLUMN IF NOT EXISTS onboarded_at   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS suspended_by   TEXT        NULL,
  ADD COLUMN IF NOT EXISTS suspended_at   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT       NULL,
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ NULL;

-- Status check stays the same shape but we keep it explicit; the
-- column already has a CHECK constraint from migration 001.

CREATE INDEX IF NOT EXISTS tenants_status_idx
  ON tenants (status)
  WHERE deleted_at IS NULL;

-- The tenants table is platform-level (no app.tenant_id scope). RLS
-- is intentionally NOT enabled here — the catalog server only allows
-- platform-admin role to read/write across tenants, enforced at the
-- route layer. The cascade FK from `capabilities`, `mfe_remotes`,
-- `role_mappings`, `usage_events` to `tenants(id)` plus the audit
-- table's tenant_id RLS provide isolation for tenant-scoped data.

-- Down Migration

ALTER TABLE tenants
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS suspended_reason,
  DROP COLUMN IF EXISTS suspended_at,
  DROP COLUMN IF EXISTS suspended_by,
  DROP COLUMN IF EXISTS onboarded_at,
  DROP COLUMN IF EXISTS onboarded_by,
  DROP COLUMN IF EXISTS quotas;

DROP INDEX IF EXISTS tenants_status_idx;
