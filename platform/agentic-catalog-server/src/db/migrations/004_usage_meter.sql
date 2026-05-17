-- Up Migration

-- Per-tenant usage meter. Hosts call POST /usage to record events
-- (LLM tokens, tool invocations, federation manifest pulls); the
-- catalog server stores them as a stream and exposes aggregations
-- over arbitrary time windows. Cost figures are derived in the
-- application layer (the catalog stores units, not currency).
-- See ADR-018.

CREATE TABLE IF NOT EXISTS usage_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Event kind. Free-form, host-defined; canonical examples:
  --   'llm.tokens.input', 'llm.tokens.output'
  --   'tool.invoke', 'mfe.fetch', 'capability.read'
  -- The kind is used for grouping in queries; pick a stable
  -- vocabulary per host.
  kind        TEXT NOT NULL CHECK (length(kind) > 0),
  -- Number of units consumed by this event. Integer for token
  -- counts, request counts, byte counts. Hosts decide units per
  -- kind (and document them).
  quantity    BIGINT NOT NULL CHECK (quantity >= 0),
  -- Optional structured tags for grouping (e.g. {"model":"gpt-4o",
  -- "user":"u-001","matter":"M-2026-0042"}). Indexed via JSONB
  -- functional indexes added per host as needed.
  tags        JSONB NOT NULL DEFAULT '{}'::JSONB,
  -- Idempotency key. Permits hosts to safely retry POSTs after a
  -- network blip without double-counting. NULL means "not idempotent
  -- — accept the duplicate." Unique per tenant when set.
  idempotency_key TEXT NULL
);

CREATE INDEX IF NOT EXISTS usage_events_tenant_time_idx
  ON usage_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_tenant_kind_time_idx
  ON usage_events (tenant_id, kind, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS usage_events_idempotency_idx
  ON usage_events (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usage_events_tenant_isolation ON usage_events;
CREATE POLICY usage_events_tenant_isolation ON usage_events
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Down Migration

DROP TABLE IF EXISTS usage_events;
