-- Up Migration
-- AEP Seam F — Experience catalog. Stores business-intent Experiences
-- (goal + declared capability requirements) decoupled from
-- implementation. Mirrors the runtime `ExperienceRegistry`
-- (projects/agentic-ui/src/lib/experience). RLS-isolated by tenant_id,
-- same shape conventions as `capabilities` / `agents`.
--
-- `body` is the ExperienceDef-shaped JSONB payload (intents, requires,
-- produces, defaultLayout, policies, personas, scopes, …). Workflow
-- state lives in `approval_state` + the `approval_chain` audit array,
-- driven by the same draft→review→approved state machine as the
-- layout/dashboard template catalogs (ADR-046 D6).

CREATE TABLE IF NOT EXISTS experiences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  title           TEXT NOT NULL,
  goal            TEXT NOT NULL,
  body            JSONB NOT NULL DEFAULT '{}'::JSONB,
  approval_state  TEXT NOT NULL DEFAULT 'draft'
                  CHECK (approval_state IN ('draft', 'review', 'approved', 'rejected', 'deprecated')),
  approval_chain  JSONB NOT NULL DEFAULT '[]'::JSONB,
  owner           TEXT NULL,
  tags            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  version         TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT NOT NULL,
  soft_deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT experiences_tenant_name_unique UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS experiences_tenant_idx ON experiences (tenant_id);
CREATE INDEX IF NOT EXISTS experiences_tenant_state_idx ON experiences (tenant_id, approval_state);
CREATE INDEX IF NOT EXISTS experiences_tenant_tags_idx ON experiences USING GIN (tags);
CREATE INDEX IF NOT EXISTS experiences_active_idx ON experiences (tenant_id) WHERE soft_deleted_at IS NULL;

ALTER TABLE experiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS experiences_tenant_isolation ON experiences;
CREATE POLICY experiences_tenant_isolation ON experiences
  USING (tenant_id = current_setting('app.tenant_id', true)
         OR current_setting('app.tenant_id', true) = '');

-- Down Migration
DROP TABLE IF EXISTS experiences;
