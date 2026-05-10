import pg from 'pg';
import type { PolicyBundle, PolicyBundleCreate, PolicyBundleUpdate } from '../domain/policy.js';

interface PolicyBundleRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly name: string;
  readonly rego_source: string;
  readonly description: string | null;
  readonly rule_path: string;
  readonly is_active: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly created_by: string;
}

function rowToBundle(row: PolicyBundleRow): PolicyBundle {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    regoSource: row.rego_source,
    description: row.description,
    rulePath: row.rule_path,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    createdBy: row.created_by,
  };
}

export async function listPolicyBundles(client: pg.PoolClient): Promise<PolicyBundle[]> {
  const result = await client.query<PolicyBundleRow>(
    `SELECT id, tenant_id, name, rego_source, description, rule_path,
            is_active, created_at, updated_at, created_by
       FROM policy_bundles
      ORDER BY name ASC`,
  );
  return result.rows.map(rowToBundle);
}

export async function findPolicyBundleById(client: pg.PoolClient, id: string): Promise<PolicyBundle | null> {
  const result = await client.query<PolicyBundleRow>(
    `SELECT id, tenant_id, name, rego_source, description, rule_path,
            is_active, created_at, updated_at, created_by
       FROM policy_bundles WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? rowToBundle(result.rows[0]) : null;
}

export async function findPolicyBundleByName(client: pg.PoolClient, name: string): Promise<PolicyBundle | null> {
  const result = await client.query<PolicyBundleRow>(
    `SELECT id, tenant_id, name, rego_source, description, rule_path,
            is_active, created_at, updated_at, created_by
       FROM policy_bundles WHERE name = $1`,
    [name],
  );
  return result.rows[0] ? rowToBundle(result.rows[0]) : null;
}

/** Returns the active bundle for the (current-RLS-scoped) tenant, or null. */
export async function findActivePolicyBundle(client: pg.PoolClient): Promise<PolicyBundle | null> {
  const result = await client.query<PolicyBundleRow>(
    `SELECT id, tenant_id, name, rego_source, description, rule_path,
            is_active, created_at, updated_at, created_by
       FROM policy_bundles WHERE is_active = true LIMIT 1`,
  );
  return result.rows[0] ? rowToBundle(result.rows[0]) : null;
}

export async function createPolicyBundle(
  client: pg.PoolClient,
  tenantId: string,
  input: PolicyBundleCreate,
  createdBy: string,
): Promise<PolicyBundle> {
  // If marking active, demote any other active bundle first (the
  // partial unique index would error otherwise).
  if (input.isActive) {
    await client.query(
      `UPDATE policy_bundles SET is_active = false, updated_at = now() WHERE is_active = true`,
    );
  }
  const result = await client.query<PolicyBundleRow>(
    `INSERT INTO policy_bundles
       (tenant_id, name, rego_source, description, rule_path, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, tenant_id, name, rego_source, description, rule_path,
               is_active, created_at, updated_at, created_by`,
    [
      tenantId,
      input.name,
      input.regoSource,
      input.description ?? null,
      input.rulePath ?? 'maverick/allow',
      input.isActive ?? false,
      createdBy,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('INSERT returned no rows — should be impossible');
  return rowToBundle(row);
}

export async function updatePolicyBundle(
  client: pg.PoolClient,
  id: string,
  patch: PolicyBundleUpdate,
): Promise<PolicyBundle | null> {
  // Demote other active bundles BEFORE updating this row to active.
  if (patch.isActive === true) {
    await client.query(
      `UPDATE policy_bundles SET is_active = false, updated_at = now()
        WHERE is_active = true AND id <> $1`,
      [id],
    );
  }

  const set: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (patch.regoSource !== undefined) { set.push(`rego_source = $${idx++}`); params.push(patch.regoSource); }
  if (patch.description !== undefined) { set.push(`description = $${idx++}`); params.push(patch.description); }
  if (patch.rulePath !== undefined) { set.push(`rule_path = $${idx++}`); params.push(patch.rulePath); }
  if (patch.isActive !== undefined) { set.push(`is_active = $${idx++}`); params.push(patch.isActive); }
  if (set.length === 0) return findPolicyBundleById(client, id);
  set.push(`updated_at = now()`);
  params.push(id);

  const result = await client.query<PolicyBundleRow>(
    `UPDATE policy_bundles SET ${set.join(', ')} WHERE id = $${idx}
     RETURNING id, tenant_id, name, rego_source, description, rule_path,
               is_active, created_at, updated_at, created_by`,
    params,
  );
  return result.rows[0] ? rowToBundle(result.rows[0]) : null;
}

export async function deletePolicyBundle(client: pg.PoolClient, id: string): Promise<boolean> {
  const result = await client.query(`DELETE FROM policy_bundles WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
