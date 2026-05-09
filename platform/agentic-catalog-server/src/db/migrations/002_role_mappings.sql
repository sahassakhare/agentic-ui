-- Up Migration

-- Maps IdP groups (and other claim values) to runtime personas
-- per tenant. Resolution: the runtime adapter sends a list of
-- groups extracted from the principal's JWT; the catalog returns
-- the highest-priority matching persona. See ADR-016.
CREATE TABLE IF NOT EXISTS role_mappings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- The claim path within the JWT to read. Default `groups` covers
  -- the dominant case (Okta groups, Azure AD groups, Auth0 roles
  -- all land in array claims). Future: other paths via dotted
  -- syntax (`https://my.domain/claims.groups`).
  claim_path      TEXT NOT NULL DEFAULT 'groups',
  -- The literal claim value to match (case-sensitive). Examples:
  --   'engineering@acme.com'  (Google Workspace group)
  --   'CN=Counsel,OU=...'     (Azure AD group DN)
  --   'lead-counsel'          (Auth0 role)
  claim_value     TEXT NOT NULL,
  -- The runtime persona to grant. Must be a non-empty string —
  -- meaningful values are app-specific ('lead-counsel', 'paralegal',
  -- etc., for the eDiscovery flagship; varies per host).
  runtime_persona TEXT NOT NULL CHECK (length(runtime_persona) > 0),
  -- Resolution priority. When multiple mappings match (principal
  -- belongs to multiple IdP groups), the highest priority wins.
  -- Ties broken by created_at ASC (older wins) — deterministic
  -- across replays.
  priority        INTEGER NOT NULL DEFAULT 100,
  -- Lifecycle. Disabled mappings are kept for audit but excluded
  -- from resolution.
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  description     TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT NOT NULL,
  CONSTRAINT role_mappings_tenant_path_value_unique
    UNIQUE (tenant_id, claim_path, claim_value)
);

CREATE INDEX IF NOT EXISTS role_mappings_tenant_idx
  ON role_mappings (tenant_id);
CREATE INDEX IF NOT EXISTS role_mappings_resolve_idx
  ON role_mappings (tenant_id, claim_path, enabled, priority DESC);

ALTER TABLE role_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_mappings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_mappings_tenant_isolation ON role_mappings;
CREATE POLICY role_mappings_tenant_isolation ON role_mappings
  USING (tenant_id = current_setting('app.tenant_id', true));

DROP TRIGGER IF EXISTS role_mappings_touch ON role_mappings;
CREATE TRIGGER role_mappings_touch BEFORE UPDATE ON role_mappings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Down Migration

DROP TRIGGER IF EXISTS role_mappings_touch ON role_mappings;
DROP TABLE IF EXISTS role_mappings;
