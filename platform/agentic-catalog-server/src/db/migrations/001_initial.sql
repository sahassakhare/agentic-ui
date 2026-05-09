-- Up Migration

-- Tenant directory. Operator-created via admin API or seed.
CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Capability catalog. RLS-isolated by tenant_id.
-- The `body` column stores the RegistryEntry-shaped blob (kind, name,
-- scopes, requiredHostVersion, tags, owner, lifecycle, plus kind-
-- specific fields). Catalog metadata lives in dedicated columns for
-- indexing + RLS.
CREATE TABLE IF NOT EXISTS capabilities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN (
                    'tool', 'component', 'capability', 'backend', 'mfe',
                    'action', 'intent', 'form', 'datasource',
                    'validation', 'persistence', 'layout',
                    'schema-transformer', 'approval', 'operation'
                  )),
  name            TEXT NOT NULL,
  body            JSONB NOT NULL,
  lifecycle       TEXT NOT NULL DEFAULT 'published'
                  CHECK (lifecycle IN ('draft', 'published', 'deprecated', 'disabled')),
  owner           TEXT NULL,
  tags            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  required_host_version TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT NOT NULL,
  soft_deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT capabilities_tenant_kind_name_unique UNIQUE (tenant_id, kind, name)
);

CREATE INDEX IF NOT EXISTS capabilities_tenant_kind_idx ON capabilities (tenant_id, kind);
CREATE INDEX IF NOT EXISTS capabilities_tenant_lifecycle_idx ON capabilities (tenant_id, lifecycle);
CREATE INDEX IF NOT EXISTS capabilities_tenant_tags_idx ON capabilities USING GIN (tags);
CREATE INDEX IF NOT EXISTS capabilities_active_idx ON capabilities (tenant_id) WHERE soft_deleted_at IS NULL;

ALTER TABLE capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE capabilities FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS capabilities_tenant_isolation ON capabilities;
CREATE POLICY capabilities_tenant_isolation ON capabilities
  USING (tenant_id = current_setting('app.tenant_id', true));

-- MFE registry — federation manifest entries. Read by RestMfeRegistrySource
-- (T1 adapter, future) so federated remotes can be discovered through the
-- catalog instead of static mfes.json.
CREATE TABLE IF NOT EXISTS mfe_remotes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  manifest_url    TEXT NOT NULL,
  version         TEXT NULL,
  required_host_version TEXT NULL,
  exposes         JSONB NOT NULL DEFAULT '{}'::JSONB,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'inactive', 'degraded')),
  last_health_at  TIMESTAMPTZ NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mfe_remotes_tenant_name_unique UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS mfe_remotes_tenant_idx ON mfe_remotes (tenant_id);
CREATE INDEX IF NOT EXISTS mfe_remotes_status_idx ON mfe_remotes (tenant_id, status);

ALTER TABLE mfe_remotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfe_remotes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mfe_remotes_tenant_isolation ON mfe_remotes;
CREATE POLICY mfe_remotes_tenant_isolation ON mfe_remotes
  USING (tenant_id = current_setting('app.tenant_id', true));

-- Append-only audit log. INSERT-only — no UPDATE / DELETE permitted.
-- Retention is operator-owned via a separate sweeper job (typical: 7 yrs
-- for compliance audit trails, copied to S3 / Glacier before sweep).
CREATE TABLE IF NOT EXISTS catalog_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor       TEXT NOT NULL,
  request_id  TEXT NULL,
  operation   TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete', 'restore')),
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  diff        JSONB NULL
);

CREATE INDEX IF NOT EXISTS catalog_audit_tenant_time_idx
  ON catalog_audit (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS catalog_audit_actor_idx
  ON catalog_audit (tenant_id, actor);
CREATE INDEX IF NOT EXISTS catalog_audit_entity_idx
  ON catalog_audit (tenant_id, entity_type, entity_id);

ALTER TABLE catalog_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_audit FORCE ROW LEVEL SECURITY;

-- Audit row tenant must match the connection's tenant. Reading audit
-- across tenants requires the platform-admin role (BYPASSRLS).
DROP POLICY IF EXISTS catalog_audit_tenant_isolation ON catalog_audit;
CREATE POLICY catalog_audit_tenant_isolation ON catalog_audit
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Application-level helper: bumps updated_at on every UPDATE. Pg trigger
-- avoids relying on the application to remember to set it.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenants_touch ON tenants;
CREATE TRIGGER tenants_touch BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS capabilities_touch ON capabilities;
CREATE TRIGGER capabilities_touch BEFORE UPDATE ON capabilities
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS mfe_remotes_touch ON mfe_remotes;
CREATE TRIGGER mfe_remotes_touch BEFORE UPDATE ON mfe_remotes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Down Migration

DROP TRIGGER IF EXISTS mfe_remotes_touch ON mfe_remotes;
DROP TRIGGER IF EXISTS capabilities_touch ON capabilities;
DROP TRIGGER IF EXISTS tenants_touch ON tenants;
DROP FUNCTION IF EXISTS touch_updated_at();
DROP TABLE IF EXISTS catalog_audit;
DROP TABLE IF EXISTS mfe_remotes;
DROP TABLE IF EXISTS capabilities;
DROP TABLE IF EXISTS tenants;
