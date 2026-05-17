-- Up Migration
-- Slice OPA-A — policy bundle storage + decision endpoint. ADR-040.
--
-- The catalog stores rego bundles per tenant; an OPA sidecar
-- (configured via OPA_URL env) does the actual evaluation. One
-- bundle per (tenant, name); `is_active` flips which bundle the
-- decision endpoint hits — there's at most one active bundle per
-- tenant at a time.

CREATE TABLE IF NOT EXISTS policy_bundles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  rego_source   TEXT NOT NULL,
  description   TEXT NULL,
  -- Default OPA rule path; the decision endpoint POSTs to
  -- {OPA_URL}/v1/data/{rule_path}. Examples: 'maverick/allow',
  -- 'authz/capabilities/decision'.
  rule_path     TEXT NOT NULL DEFAULT 'maverick/allow',
  is_active     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT NOT NULL,
  CONSTRAINT policy_bundles_tenant_name_unique UNIQUE (tenant_id, name)
);

-- At most one active bundle per tenant. Partial unique index — only
-- enforces uniqueness on rows where is_active = true.
CREATE UNIQUE INDEX IF NOT EXISTS policy_bundles_one_active_per_tenant
  ON policy_bundles (tenant_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS policy_bundles_tenant_idx ON policy_bundles (tenant_id);

ALTER TABLE policy_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_bundles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS policy_bundles_tenant_isolation ON policy_bundles;
CREATE POLICY policy_bundles_tenant_isolation ON policy_bundles
  USING (tenant_id = current_setting('app.tenant_id', true)
         OR current_setting('app.tenant_id', true) = '');
