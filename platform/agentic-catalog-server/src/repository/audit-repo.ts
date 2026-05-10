import type pg from 'pg';
import { createHash } from 'node:crypto';

export type AuditOperation = 'create' | 'update' | 'delete' | 'restore';

export interface AuditAppendInput {
  readonly tenantId: string;
  readonly actor: string;
  readonly requestId: string | null;
  readonly operation: AuditOperation;
  readonly entityType: string;
  readonly entityId: string;
  readonly diff: Record<string, unknown> | null;
}

export interface AuditRow {
  readonly id: string;
  readonly tenantId: string;
  readonly occurredAt: string;
  readonly actor: string;
  readonly requestId: string | null;
  readonly operation: AuditOperation;
  readonly entityType: string;
  readonly entityId: string;
  readonly diff: Record<string, unknown> | null;
  readonly chainPosition: number | null;
  readonly prevHash: string | null;
  readonly entryHash: string | null;
}

/**
 * Genesis hash — the `prev_hash` value of the first chain entry per
 * tenant. Distinct from the literal NULL stored on pre-chain rows
 * (which is what we use to mean "this row was inserted before the
 * chain was introduced and is not chained at all"). The genesis
 * value is folded into the first hash so that an attacker cannot
 * trivially forge a chain head by emitting a row with `prev_hash =
 * NULL`.
 */
export const AUDIT_GENESIS_HASH =
  '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Append an audit event with hash-chain integrity. Inside the same
 * transaction as the data write that prompted the audit:
 *
 * 1. Read the latest chain row for the tenant (FOR UPDATE) to lock
 *    the chain head against concurrent appenders.
 * 2. Compute `entry_hash = sha256(canonical || prev_hash)`.
 * 3. INSERT the new row with `prev_hash`, `entry_hash`, and the
 *    next dense `chain_position`.
 *
 * The `FOR UPDATE` lock serialises concurrent appenders within a
 * tenant — the volume is bounded (audit-grade writes, not hot-path
 * traffic) so this is acceptable. Outside-of-transaction inserts
 * are not supported; callers must pass the same `pg.PoolClient`
 * that owns the data write.
 *
 * @param client `pg.PoolClient` already enrolled in a tenant-scoped
 *   transaction (`SET LOCAL app.tenant_id`).
 * @param input Audit fields. `tenantId` should equal the
 *   `app.tenant_id` GUC; mismatch is rejected by RLS.
 */
export async function appendAudit(
  client: pg.PoolClient,
  input: AuditAppendInput,
): Promise<AuditRow> {
  // Lock the chain head for this tenant. RLS already restricts
  // visibility to the connection's tenant — we still pass tenant_id
  // explicitly so a misconfigured connection (RLS off) does NOT
  // accidentally reach across tenants.
  const headResult = await client.query<{
    chain_position: string | null;
    entry_hash: string | null;
  }>(
    `SELECT chain_position, entry_hash
     FROM catalog_audit
     WHERE tenant_id = $1
       AND chain_position IS NOT NULL
     ORDER BY chain_position DESC
     LIMIT 1
     FOR UPDATE`,
    [input.tenantId],
  );
  const head = headResult.rows[0];
  const prevHash = head?.entry_hash ?? AUDIT_GENESIS_HASH;
  const nextPosition = head ? Number(head.chain_position) + 1 : 1;

  // Canonical encoding: stable JSON over the auditable fields.
  // `occurred_at` and `id` are NOT included — they're set by Postgres
  // (now() / gen_random_uuid()) and would force us to read them back
  // before hashing. Operators verifying the chain re-derive the hash
  // from the in-DB row's `occurred_at` / `id` columns. To make THAT
  // verifiable we include the `id` and `occurredAt` of the ROW WE'RE
  // ABOUT TO INSERT — meaning we must mint them in the application
  // layer rather than letting the DB defaults run.
  // For now we accept the simpler trade-off: the hash covers only
  // application-supplied fields + prevHash. `occurred_at` is reported
  // separately and verifiers cross-reference it but do not feed it
  // into the hash. ADR-017 documents this trade-off.
  const canonical = canonicalize({
    tenantId: input.tenantId,
    actor: input.actor,
    requestId: input.requestId,
    operation: input.operation,
    entityType: input.entityType,
    entityId: input.entityId,
    diff: input.diff,
  });
  const entryHash = sha256Hex(`${prevHash}|${canonical}`);

  const insert = await client.query<{
    id: string;
    tenant_id: string;
    occurred_at: Date;
    actor: string;
    request_id: string | null;
    operation: AuditOperation;
    entity_type: string;
    entity_id: string;
    diff: Record<string, unknown> | null;
    chain_position: string;
    prev_hash: string;
    entry_hash: string;
  }>(
    `INSERT INTO catalog_audit
       (tenant_id, actor, request_id, operation, entity_type, entity_id,
        diff, chain_position, prev_hash, entry_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7::JSONB, $8, $9, $10)
     RETURNING id, tenant_id, occurred_at, actor, request_id, operation,
               entity_type, entity_id, diff, chain_position, prev_hash,
               entry_hash`,
    [
      input.tenantId,
      input.actor,
      input.requestId,
      input.operation,
      input.entityType,
      input.entityId,
      input.diff === null ? null : JSON.stringify(input.diff),
      nextPosition,
      prevHash,
      entryHash,
    ],
  );
  const row = insert.rows[0];
  if (!row) throw new Error('audit INSERT returned no rows');
  return rowToAudit(row);
}

function rowToAudit(row: {
  id: string;
  tenant_id: string;
  occurred_at: Date | string;
  actor: string;
  request_id: string | null;
  operation: AuditOperation;
  entity_type: string;
  entity_id: string;
  diff: Record<string, unknown> | null;
  chain_position: string | number | null;
  prev_hash: string | null;
  entry_hash: string | null;
}): AuditRow {
  const occurredAt = row.occurred_at instanceof Date
    ? row.occurred_at.toISOString()
    : new Date(row.occurred_at).toISOString();
  return {
    id: row.id,
    tenantId: row.tenant_id,
    occurredAt,
    actor: row.actor,
    requestId: row.request_id,
    operation: row.operation,
    entityType: row.entity_type,
    entityId: row.entity_id,
    diff: row.diff,
    chainPosition: row.chain_position == null ? null : Number(row.chain_position),
    prevHash: row.prev_hash,
    entryHash: row.entry_hash,
  };
}

/**
 * Fetch the most recent audit rows for the tenant, newest first.
 * Used by the ops-console activity feed to backfill the buffer on
 * page load, before the SSE stream starts emitting live events.
 * Bounded at 500 rows; default 100.
 */
export async function listRecentAuditRows(
  client: pg.PoolClient,
  tenantId: string,
  limit: number,
): Promise<AuditRow[]> {
  const bounded = Math.max(1, Math.min(500, Math.floor(limit) || 100));
  const result = await client.query(
    `SELECT id, tenant_id, occurred_at, actor, request_id, operation,
            entity_type, entity_id, diff, chain_position, prev_hash,
            entry_hash
     FROM catalog_audit
     WHERE tenant_id = $1
     ORDER BY occurred_at DESC, chain_position DESC
     LIMIT ${bounded}`,
    [tenantId],
  );
  return result.rows.map(rowToAudit);
}

export async function listAuditRowsForExport(
  client: pg.PoolClient,
  tenantId: string,
  options: { from?: Date; to?: Date; limit?: number } = {},
): Promise<AuditRow[]> {
  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;
  if (options.from) {
    conditions.push(`occurred_at >= $${idx++}`);
    params.push(options.from);
  }
  if (options.to) {
    conditions.push(`occurred_at < $${idx++}`);
    params.push(options.to);
  }
  const limit = Math.max(1, Math.min(100_000, options.limit ?? 10_000));
  const result = await client.query(
    `SELECT id, tenant_id, occurred_at, actor, request_id, operation,
            entity_type, entity_id, diff, chain_position, prev_hash,
            entry_hash
     FROM catalog_audit
     WHERE ${conditions.join(' AND ')}
     ORDER BY occurred_at ASC, chain_position ASC
     LIMIT ${limit}`,
    params,
  );
  return result.rows.map(rowToAudit);
}

export interface AuditChainVerifyResult {
  readonly valid: boolean;
  readonly checkedRows: number;
  readonly chainHead: { chainPosition: number; entryHash: string } | null;
  /** First broken row's chainPosition + reason, when invalid. */
  readonly brokenAt: { chainPosition: number; reason: string } | null;
}

/**
 * Re-walk the per-tenant audit chain and verify each row's
 * `entry_hash`. Stops at the first inconsistency.
 *
 * Returns `{valid: true, checkedRows, chainHead}` on success.
 * Returns `{valid: false, brokenAt: {...}}` on the first row whose
 * computed hash does not match its stored `entry_hash`.
 *
 * Pre-chain rows (chain_position IS NULL) are skipped — they were
 * inserted before the chain extension and are out of scope.
 */
export async function verifyAuditChain(
  client: pg.PoolClient,
  tenantId: string,
): Promise<AuditChainVerifyResult> {
  const result = await client.query<{
    chain_position: string;
    actor: string;
    request_id: string | null;
    operation: AuditOperation;
    entity_type: string;
    entity_id: string;
    diff: Record<string, unknown> | null;
    prev_hash: string;
    entry_hash: string;
  }>(
    `SELECT chain_position, actor, request_id, operation, entity_type,
            entity_id, diff, prev_hash, entry_hash
     FROM catalog_audit
     WHERE tenant_id = $1 AND chain_position IS NOT NULL
     ORDER BY chain_position ASC`,
    [tenantId],
  );

  let expectedPrev = AUDIT_GENESIS_HASH;
  let lastPosition = 0;
  let lastHash = '';

  for (const row of result.rows) {
    const pos = Number(row.chain_position);
    if (row.prev_hash !== expectedPrev) {
      return {
        valid: false,
        checkedRows: lastPosition,
        chainHead: null,
        brokenAt: { chainPosition: pos, reason: 'prev_hash mismatch' },
      };
    }
    const canonical = canonicalize({
      tenantId,
      actor: row.actor,
      requestId: row.request_id,
      operation: row.operation,
      entityType: row.entity_type,
      entityId: row.entity_id,
      diff: row.diff,
    });
    const computed = sha256Hex(`${row.prev_hash}|${canonical}`);
    if (computed !== row.entry_hash) {
      return {
        valid: false,
        checkedRows: lastPosition,
        chainHead: null,
        brokenAt: { chainPosition: pos, reason: 'entry_hash mismatch' },
      };
    }
    expectedPrev = row.entry_hash;
    lastPosition = pos;
    lastHash = row.entry_hash;
  }

  return {
    valid: true,
    checkedRows: result.rows.length,
    chainHead: lastPosition > 0
      ? { chainPosition: lastPosition, entryHash: lastHash }
      : null,
    brokenAt: null,
  };
}

/**
 * Stable JSON over an object: keys sorted lexicographically at every
 * level; arrays kept in order; null preserved. `JSON.stringify`'s
 * key order is implementation-defined for non-integer keys, so a
 * canonical pass is required for hash stability across Node
 * versions.
 */
function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`);
    return `{${parts.join(',')}}`;
  }
  return 'null';
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
