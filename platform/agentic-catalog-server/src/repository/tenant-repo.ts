import type pg from 'pg';
import type {
  Tenant,
  TenantCreate,
  TenantUpdate,
} from '../domain/tenant.js';

interface TenantRow {
  id: string;
  display_name: string;
  status: 'active' | 'suspended' | 'deleted';
  quotas: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  onboarded_at: Date | null;
  onboarded_by: string | null;
  suspended_at: Date | null;
  suspended_by: string | null;
  suspended_reason: string | null;
  deleted_at: Date | null;
}

function toIso(d: Date | null): string | null {
  return d ? new Date(d).toISOString() : null;
}

function rowToTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    displayName: row.display_name,
    status: row.status,
    quotas: row.quotas ?? {},
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    onboardedAt: toIso(row.onboarded_at),
    onboardedBy: row.onboarded_by,
    suspendedAt: toIso(row.suspended_at),
    suspendedBy: row.suspended_by,
    suspendedReason: row.suspended_reason,
    deletedAt: toIso(row.deleted_at),
  };
}

const SELECT_COLS = `id, display_name, status, quotas,
       created_at, updated_at,
       onboarded_at, onboarded_by,
       suspended_at, suspended_by, suspended_reason,
       deleted_at`;

export async function listTenants(
  client: pg.PoolClient,
  options: { includeDeleted?: boolean } = {},
): Promise<Tenant[]> {
  const where = options.includeDeleted ? '' : 'WHERE deleted_at IS NULL';
  const result = await client.query<TenantRow>(
    `SELECT ${SELECT_COLS}
     FROM tenants
     ${where}
     ORDER BY id ASC`,
  );
  return result.rows.map(rowToTenant);
}

export async function findTenantById(
  client: pg.PoolClient,
  id: string,
): Promise<Tenant | null> {
  const result = await client.query<TenantRow>(
    `SELECT ${SELECT_COLS}
     FROM tenants
     WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? rowToTenant(result.rows[0]) : null;
}

export async function createTenant(
  client: pg.PoolClient,
  input: TenantCreate,
  onboardedBy: string,
): Promise<Tenant> {
  const result = await client.query<TenantRow>(
    `INSERT INTO tenants
       (id, display_name, status, quotas, onboarded_at, onboarded_by)
     VALUES ($1, $2, 'active', $3::JSONB, now(), $4)
     RETURNING ${SELECT_COLS}`,
    [
      input.id,
      input.displayName,
      JSON.stringify(input.quotas ?? {}),
      onboardedBy,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('tenant INSERT returned no rows');
  return rowToTenant(row);
}

export async function updateTenant(
  client: pg.PoolClient,
  id: string,
  patch: TenantUpdate,
): Promise<Tenant | null> {
  const set: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (patch.displayName !== undefined) {
    set.push(`display_name = $${idx++}`);
    params.push(patch.displayName);
  }
  if (patch.quotas !== undefined) {
    set.push(`quotas = $${idx++}::JSONB`);
    params.push(JSON.stringify(patch.quotas));
  }
  if (set.length === 0) return findTenantById(client, id);

  set.push(`updated_at = now()`);
  params.push(id);
  const result = await client.query<TenantRow>(
    `UPDATE tenants
     SET ${set.join(', ')}
     WHERE id = $${idx++} AND deleted_at IS NULL
     RETURNING ${SELECT_COLS}`,
    params,
  );
  return result.rows[0] ? rowToTenant(result.rows[0]) : null;
}

/**
 * Suspend a tenant. Idempotent — a second suspend updates the
 * reason but doesn't reset the timestamp (the original suspension
 * moment matters for audit).
 *
 * Suspended tenants do NOT lose their data. Capabilities, role
 * mappings, audit history, etc. all remain. The status field is
 * the signal hosts should read when deciding whether to admit
 * traffic; the catalog itself does not block reads (audit access
 * during suspension is a feature, not a bug).
 */
export async function suspendTenant(
  client: pg.PoolClient,
  id: string,
  suspendedBy: string,
  reason: string,
): Promise<Tenant | null> {
  const result = await client.query<TenantRow>(
    `UPDATE tenants
     SET status = 'suspended',
         suspended_at = COALESCE(suspended_at, now()),
         suspended_by = $1,
         suspended_reason = $2,
         updated_at = now()
     WHERE id = $3 AND deleted_at IS NULL
     RETURNING ${SELECT_COLS}`,
    [suspendedBy, reason, id],
  );
  return result.rows[0] ? rowToTenant(result.rows[0]) : null;
}

export async function activateTenant(
  client: pg.PoolClient,
  id: string,
): Promise<Tenant | null> {
  const result = await client.query<TenantRow>(
    `UPDATE tenants
     SET status = 'active',
         suspended_at = NULL,
         suspended_by = NULL,
         suspended_reason = NULL,
         updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING ${SELECT_COLS}`,
    [id],
  );
  return result.rows[0] ? rowToTenant(result.rows[0]) : null;
}

/**
 * Soft-delete a tenant. Sets `status='deleted'` and stamps
 * `deleted_at`. The actual rows in `capabilities`,
 * `mfe_remotes`, `role_mappings`, `usage_events` stay in place
 * (FK ON DELETE CASCADE only fires on a hard DELETE). Operators
 * who need a true purge run a separate DELETE through psql with
 * the `BYPASSRLS` role; that path is intentionally out of the API
 * because it's irrecoverable. See ADR-020 D5.
 */
export async function softDeleteTenant(
  client: pg.PoolClient,
  id: string,
): Promise<Tenant | null> {
  const result = await client.query<TenantRow>(
    `UPDATE tenants
     SET status = 'deleted',
         deleted_at = COALESCE(deleted_at, now()),
         updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING ${SELECT_COLS}`,
    [id],
  );
  return result.rows[0] ? rowToTenant(result.rows[0]) : null;
}
