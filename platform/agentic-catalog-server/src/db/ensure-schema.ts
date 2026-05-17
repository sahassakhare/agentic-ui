import type { CatalogPool } from './pool.js';
import { logger } from '../logger.js';

/**
 * Bootstrap-time defensive DDL for tables that have been observed to
 * go missing on Render in production. node-pg-migrate is the
 * authoritative migration runner (driven by Render's
 * preDeployCommand), but in practice some Render deploys have shipped
 * the new catalog code without the corresponding `agents` /
 * `policy_bundles` tables — preDeployCommand silently skipping recent
 * migrations is the most likely culprit, but it's been hard to
 * reproduce. Until that's understood, we bring the schema up to date
 * on every container start: idempotent, no destructive ops, ~5ms on a
 * healthy DB. Real Postgres only — pg-mem tests use the migrations
 * directly.
 *
 * If you add a new table, add its DDL here. Match the migration
 * exactly so the bootstrap and the migration agree on schema shape.
 */
export async function ensureCriticalSchema(pool: CatalogPool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(AGENTS_DDL);
    await client.query(POLICY_BUNDLES_DDL);
    logger.info({}, 'critical schema verified (agents + policy_bundles)');
  } catch (err) {
    // Don't crash the server on schema-ensure failures — log loudly
    // and continue. The relevant route handlers will surface 500s
    // for missing tables, which is no worse than the status quo.
    logger.error({ err }, 'ensureCriticalSchema failed; continuing startup');
  } finally {
    client.release();
  }
}

const AGENTS_DDL = `
DO $ensure_agents$
BEGIN
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

  EXECUTE 'ALTER TABLE agents ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE agents FORCE ROW LEVEL SECURITY';

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'agents' AND policyname = 'agents_tenant_isolation'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY agents_tenant_isolation ON agents
      USING (tenant_id = current_setting('app.tenant_id', true)
             OR current_setting('app.tenant_id', true) = '')
    $policy$;
  END IF;
END
$ensure_agents$;
`;

const POLICY_BUNDLES_DDL = `
DO $ensure_policy_bundles$
BEGIN
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

  EXECUTE 'ALTER TABLE policy_bundles ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE policy_bundles FORCE ROW LEVEL SECURITY';

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'policy_bundles' AND policyname = 'policy_bundles_tenant_isolation'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY policy_bundles_tenant_isolation ON policy_bundles
      USING (tenant_id = current_setting('app.tenant_id', true)
             OR current_setting('app.tenant_id', true) = '')
    $policy$;
  END IF;
END
$ensure_policy_bundles$;
`;
