-- Up Migration
-- Change management for Experiences (audit finding A4): immutable version
-- history + rollback. Every create/update/transition appends a snapshot;
-- rollback re-applies a prior snapshot as a new update (and records a new
-- version), so history is append-only and never rewritten. Tenant-isolated
-- via RLS like every other catalog table.

CREATE TABLE IF NOT EXISTS experience_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      TEXT NOT NULL,
  experience_id  UUID NOT NULL,
  version_no     INTEGER NOT NULL,
  -- Full snapshot of the mutable experience shape at this version.
  snapshot       JSONB NOT NULL,
  reason         TEXT NOT NULL,          -- 'create' | 'update' | 'transition:<action>' | 'rollback:v<n>'
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     TEXT NOT NULL,
  CONSTRAINT experience_versions_unique UNIQUE (tenant_id, experience_id, version_no)
);

CREATE INDEX IF NOT EXISTS experience_versions_lookup_idx
  ON experience_versions (tenant_id, experience_id, version_no DESC);

ALTER TABLE experience_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE experience_versions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS experience_versions_tenant_isolation ON experience_versions;
CREATE POLICY experience_versions_tenant_isolation ON experience_versions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Down Migration
DROP TABLE IF EXISTS experience_versions;
