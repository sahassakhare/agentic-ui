-- Up Migration
-- Slice AGT — agent auto-registration. ADR-039.
--
-- Tracks per-tenant AgenticBackend deployments. Distinct from MFE
-- remotes: agents have heartbeat-driven status (alive/dead) where MFEs
-- have manifest-driven status (URL reachability). One agent server
-- corresponds to one row; tools[] is the inventory it advertised on
-- registration.

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
