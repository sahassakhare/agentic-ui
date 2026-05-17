-- Up Migration
-- Safety-net: idempotent re-declaration of `agents` (007) and
-- `policy_bundles` (008). No-op when those migrations applied
-- cleanly. Recovers a stuck deployment when they didn't.
--
-- Why this exists: the broken-pgvector era of migration 006
-- (4a4d2e2 → e672549) caused some Render deploys to abort
-- partway, leaving the `pgmigrations` ledger out of sync with the
-- actual schema. Symptom: catalog server deployed at HEAD, routes
-- mounted, but `SELECT FROM agents` raises "relation does not
-- exist". This file uses CREATE TABLE IF NOT EXISTS / CREATE
-- POLICY-with-DROP-IF-EXISTS so re-running on a healthy DB is a
-- safe no-op.
--
-- Keep parity with 007/008 — any future column added there must
-- also be ALTER TABLE … ADD COLUMN IF NOT EXISTS'd here.

CREATE TABLE IF NOT EXISTS agents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('ag-ui', 'hashbrown', 'a2ui', 'mcp', 'custom')),
  manifest_url    TEXT NOT NULL,
  version         TEXT NULL,
  required_host_version TEXT NULL,
  capabilities    JSONB NOT NULL DEFAULT '[]'::JSONB,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'degraded', 'inactive')),
  last_health_at  TIMESTAMPTZ NULL,
  registered_by   TEXT NOT NULL,
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  soft_deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT agents_tenant_name_unique UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS agents_tenant_idx ON agents (tenant_id);
CREATE INDEX IF NOT EXISTS agents_status_idx ON agents (tenant_id, status);

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agents_tenant_isolation ON agents;
CREATE POLICY agents_tenant_isolation ON agents
  USING (tenant_id = current_setting('app.tenant_id', true)
         OR current_setting('app.tenant_id', true) = '');

CREATE TABLE IF NOT EXISTS policy_bundles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  rego_source   TEXT NOT NULL,
  description   TEXT NULL,
  rule_path     TEXT NOT NULL DEFAULT 'maverick/allow',
  is_active     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT NOT NULL,
  CONSTRAINT policy_bundles_tenant_name_unique UNIQUE (tenant_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS policy_bundles_one_active_per_tenant
  ON policy_bundles (tenant_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS policy_bundles_tenant_idx ON policy_bundles (tenant_id);

ALTER TABLE policy_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_bundles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS policy_bundles_tenant_isolation ON policy_bundles;
CREATE POLICY policy_bundles_tenant_isolation ON policy_bundles
  USING (tenant_id = current_setting('app.tenant_id', true)
         OR current_setting('app.tenant_id', true) = '');
