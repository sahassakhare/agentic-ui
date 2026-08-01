-- Up Migration
-- Headless publishing (orthogonal to approval): pins an APPROVED experience's
-- version + a self-contained render bundle behind a hashed, origin-pinned embed
-- key so external enterprise portals can consume it anonymously. Publish is a
-- SEPARATE axis from the approval state machine — an experience must be
-- `approved` to publish, but publishing never mutates approval_state. Tenant-
-- isolated via RLS like every other catalog table.

CREATE TABLE IF NOT EXISTS experience_publications (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            TEXT NOT NULL,
  experience_id        UUID NOT NULL,
  -- Denormalized: the experience name is immutable, and the embed read path
  -- looks up by (tenant, name) so a portal URL stays stable across re-publishes.
  experience_name      TEXT NOT NULL,
  -- Pins experience_versions.version_no captured at publish time.
  published_version_no INTEGER NOT NULL,
  -- SHA-256 hex of the raw embed key; the raw key is returned once and never stored.
  key_hash             TEXT NOT NULL,
  -- Non-secret display prefix (e.g. 'emb_ab12…') so the UI can show which key is live.
  key_prefix           TEXT NOT NULL,
  allowed_origins      TEXT[] NOT NULL DEFAULT '{}',
  -- Frozen, self-contained render manifest snapshot — decoupled from later edits
  -- to experiences/capabilities.
  bundle               JSONB NOT NULL,
  status               TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'revoked')),
  published_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by         TEXT NOT NULL,
  revoked_at           TIMESTAMPTZ,
  CONSTRAINT experience_publications_keyhash_unique UNIQUE (key_hash)
);

-- At most one ACTIVE publication per experience — re-publishing revokes the
-- prior active row first (see publication-repo.insertPublication).
CREATE UNIQUE INDEX IF NOT EXISTS experience_publications_active_uniq
  ON experience_publications (tenant_id, experience_id) WHERE status = 'active';

-- Embed read lookup path (tenant + name + active); the key path uses the
-- key_hash UNIQUE index above.
CREATE INDEX IF NOT EXISTS experience_publications_name_idx
  ON experience_publications (tenant_id, experience_name, status);

ALTER TABLE experience_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE experience_publications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS experience_publications_tenant_isolation ON experience_publications;
CREATE POLICY experience_publications_tenant_isolation ON experience_publications
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Down Migration
DROP TABLE IF EXISTS experience_publications;
