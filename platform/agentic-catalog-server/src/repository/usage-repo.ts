import type pg from 'pg';
import type {
  UsageEvent,
  UsageEventCreate,
  UsageQuery,
  UsageAggregate,
} from '../domain/usage.js';

interface UsageRow {
  id: string;
  tenant_id: string;
  occurred_at: Date;
  kind: string;
  quantity: string | number;
  tags: Record<string, unknown>;
  idempotency_key: string | null;
}

function rowToEvent(row: UsageRow): UsageEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : new Date(row.occurred_at).toISOString(),
    kind: row.kind,
    quantity: Number(row.quantity),
    tags: row.tags ?? {},
    idempotencyKey: row.idempotency_key,
  };
}

/**
 * Append a usage event. Honours the optional idempotency key —
 * repeated POSTs with the same `(tenant_id, idempotency_key)` resolve
 * to the original row (the second call's `kind` / `quantity` / `tags`
 * are silently ignored). This matches Stripe's idempotency semantics
 * and keeps the host retry path safe.
 */
export async function appendUsage(
  client: pg.PoolClient,
  tenantId: string,
  input: UsageEventCreate,
): Promise<UsageEvent> {
  // Idempotent path: look up first; insert if absent. The unique
  // partial index `usage_events_idempotency_idx` is the durable
  // guard — a race produces a unique-violation that we recover
  // from by re-reading. We split into separate queries instead of
  // a single `INSERT ... ON CONFLICT DO NOTHING` because pg-mem
  // does not parse `ON CONFLICT (cols) WHERE ... DO NOTHING`.
  // Real Postgres handles either form correctly.
  if (input.idempotencyKey) {
    const existing = await client.query<UsageRow>(
      `SELECT id, tenant_id, occurred_at, kind, quantity, tags, idempotency_key
       FROM usage_events
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, input.idempotencyKey],
    );
    if (existing.rows[0]) return rowToEvent(existing.rows[0]);

    try {
      const insert = await client.query<UsageRow>(
        `INSERT INTO usage_events
           (tenant_id, kind, quantity, tags, idempotency_key, occurred_at)
         VALUES ($1, $2, $3, $4::JSONB, $5, COALESCE($6::TIMESTAMPTZ, now()))
         RETURNING id, tenant_id, occurred_at, kind, quantity, tags, idempotency_key`,
        [
          tenantId,
          input.kind,
          input.quantity,
          JSON.stringify(input.tags),
          input.idempotencyKey,
          input.occurredAt ?? null,
        ],
      );
      const row = insert.rows[0];
      if (!row) throw new Error('usage INSERT returned no rows');
      return rowToEvent(row);
    } catch (err) {
      // Race lost — another caller inserted between our SELECT and
      // INSERT. Re-read and return that row.
      const isUniqueViolation =
        err instanceof Error
        && /(duplicate key|unique constraint|usage_events_idempotency_idx)/i
          .test(err.message);
      if (!isUniqueViolation) throw err;
      const reread = await client.query<UsageRow>(
        `SELECT id, tenant_id, occurred_at, kind, quantity, tags, idempotency_key
         FROM usage_events
         WHERE tenant_id = $1 AND idempotency_key = $2`,
        [tenantId, input.idempotencyKey],
      );
      const row = reread.rows[0];
      if (!row) throw err;
      return rowToEvent(row);
    }
  }

  const insert = await client.query<UsageRow>(
    `INSERT INTO usage_events
       (tenant_id, kind, quantity, tags, occurred_at)
     VALUES ($1, $2, $3, $4::JSONB, COALESCE($5::TIMESTAMPTZ, now()))
     RETURNING id, tenant_id, occurred_at, kind, quantity, tags, idempotency_key`,
    [
      tenantId,
      input.kind,
      input.quantity,
      JSON.stringify(input.tags),
      input.occurredAt ?? null,
    ],
  );
  const row = insert.rows[0];
  if (!row) throw new Error('usage INSERT returned no rows');
  return rowToEvent(row);
}

/**
 * Aggregate usage over an arbitrary window. Returns `{from, to,
 * byKind, totalEvents, totalQuantity}`. Hosts use `byKind` to drive
 * dashboards and bill-back calculations; we intentionally do not
 * compute money here (see ADR-018 D2).
 */
export async function aggregateUsage(
  client: pg.PoolClient,
  tenantId: string,
  query: UsageQuery,
): Promise<UsageAggregate> {
  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;
  if (query.from) {
    conditions.push(`occurred_at >= $${idx++}`);
    params.push(new Date(query.from));
  }
  if (query.to) {
    conditions.push(`occurred_at < $${idx++}`);
    params.push(new Date(query.to));
  }
  if (query.kind) {
    conditions.push(`kind = $${idx++}`);
    params.push(query.kind);
  }
  const result = await client.query<{
    kind: string;
    sum_quantity: string | null;
    event_count: string;
  }>(
    `SELECT kind,
            SUM(quantity)::TEXT AS sum_quantity,
            COUNT(*)::TEXT      AS event_count
     FROM usage_events
     WHERE ${conditions.join(' AND ')}
     GROUP BY kind
     ORDER BY kind`,
    params,
  );

  const byKind: Record<string, number> = {};
  let totalEvents = 0;
  let totalQuantity = 0;
  for (const row of result.rows) {
    const q = Number(row.sum_quantity ?? 0);
    byKind[row.kind] = q;
    totalQuantity += q;
    totalEvents += Number(row.event_count);
  }

  return {
    from: query.from ?? null,
    to: query.to ?? null,
    byKind,
    totalEvents,
    totalQuantity,
  };
}

export async function listRecentUsage(
  client: pg.PoolClient,
  tenantId: string,
  limit = 100,
): Promise<UsageEvent[]> {
  const bounded = Math.max(1, Math.min(1000, limit));
  const result = await client.query<UsageRow>(
    `SELECT id, tenant_id, occurred_at, kind, quantity, tags, idempotency_key
     FROM usage_events
     WHERE tenant_id = $1
     ORDER BY occurred_at DESC
     LIMIT ${bounded}`,
    [tenantId],
  );
  return result.rows.map(rowToEvent);
}
