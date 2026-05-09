import type pg from 'pg';
import {
  type RoleMapping,
  type RoleMappingCreate,
  type RoleMappingUpdate,
  type ResolveRequest,
  type ResolveResponse,
} from '../domain/role-mapping.js';

interface RoleMappingRow {
  id: string;
  tenant_id: string;
  claim_path: string;
  claim_value: string;
  runtime_persona: string;
  priority: number;
  enabled: boolean;
  description: string | null;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

function rowToMapping(row: RoleMappingRow): RoleMapping {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    claimPath: row.claim_path,
    claimValue: row.claim_value,
    runtimePersona: row.runtime_persona,
    priority: row.priority,
    enabled: row.enabled,
    description: row.description,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    createdBy: row.created_by,
  };
}

export async function listRoleMappings(client: pg.PoolClient): Promise<RoleMapping[]> {
  const result = await client.query<RoleMappingRow>(
    `SELECT id, tenant_id, claim_path, claim_value, runtime_persona,
            priority, enabled, description, created_at, updated_at,
            created_by
     FROM role_mappings
     ORDER BY priority DESC, created_at ASC`,
  );
  return result.rows.map(rowToMapping);
}

export async function findRoleMappingById(
  client: pg.PoolClient,
  id: string,
): Promise<RoleMapping | null> {
  const result = await client.query<RoleMappingRow>(
    `SELECT id, tenant_id, claim_path, claim_value, runtime_persona,
            priority, enabled, description, created_at, updated_at,
            created_by
     FROM role_mappings
     WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? rowToMapping(result.rows[0]) : null;
}

export async function createRoleMapping(
  client: pg.PoolClient,
  tenantId: string,
  input: RoleMappingCreate,
  createdBy: string,
): Promise<RoleMapping> {
  const result = await client.query<RoleMappingRow>(
    `INSERT INTO role_mappings
       (tenant_id, claim_path, claim_value, runtime_persona, priority, enabled, description, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, tenant_id, claim_path, claim_value, runtime_persona,
               priority, enabled, description, created_at, updated_at,
               created_by`,
    [
      tenantId,
      input.claimPath,
      input.claimValue,
      input.runtimePersona,
      input.priority,
      input.enabled,
      input.description ?? null,
      createdBy,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('INSERT returned no rows');
  return rowToMapping(row);
}

export async function updateRoleMapping(
  client: pg.PoolClient,
  id: string,
  patch: RoleMappingUpdate,
): Promise<RoleMapping | null> {
  const set: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (patch.runtimePersona !== undefined) {
    set.push(`runtime_persona = $${idx++}`);
    params.push(patch.runtimePersona);
  }
  if (patch.priority !== undefined) {
    set.push(`priority = $${idx++}`);
    params.push(patch.priority);
  }
  if (patch.enabled !== undefined) {
    set.push(`enabled = $${idx++}`);
    params.push(patch.enabled);
  }
  if (patch.description !== undefined) {
    set.push(`description = $${idx++}`);
    params.push(patch.description);
  }
  if (set.length === 0) return findRoleMappingById(client, id);

  params.push(id);
  const result = await client.query<RoleMappingRow>(
    `UPDATE role_mappings
     SET ${set.join(', ')}
     WHERE id = $${idx++}
     RETURNING id, tenant_id, claim_path, claim_value, runtime_persona,
               priority, enabled, description, created_at, updated_at,
               created_by`,
    params,
  );
  return result.rows[0] ? rowToMapping(result.rows[0]) : null;
}

export async function deleteRoleMapping(
  client: pg.PoolClient,
  id: string,
): Promise<boolean> {
  const result = await client.query(
    `DELETE FROM role_mappings WHERE id = $1`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Resolve a list of claim values to a runtime persona. Highest-
 * priority enabled mapping wins; ties broken by `created_at ASC`
 * (older mapping wins, deterministic across replays).
 *
 * Returns `runtimePersona = null` when no enabled mapping matches.
 *
 * The query returns *all* matching rows and lets the application
 * pick the winner — this is preferable to ORDER BY + LIMIT 1 in
 * Postgres because we want the `matchedClaimValues` set for the
 * winning priority (which is the diagnostic ops teams will want).
 */
export async function resolveByClaimValues(
  client: pg.PoolClient,
  request: ResolveRequest,
): Promise<ResolveResponse> {
  if (request.claimValues.length === 0) {
    return { runtimePersona: null, matchedClaimValues: [], mappingId: null, priority: null };
  }

  const result = await client.query<RoleMappingRow>(
    `SELECT id, tenant_id, claim_path, claim_value, runtime_persona,
            priority, enabled, description, created_at, updated_at,
            created_by
     FROM role_mappings
     WHERE claim_path = $1
       AND enabled = TRUE
       AND claim_value = ANY($2::TEXT[])
     ORDER BY priority DESC, created_at ASC`,
    [request.claimPath, request.claimValues],
  );

  if (result.rows.length === 0) {
    return { runtimePersona: null, matchedClaimValues: [], mappingId: null, priority: null };
  }

  // Winner is the first row (priority DESC, created_at ASC).
  const winner = result.rows[0]!;

  // Collect every claim_value that produced the SAME priority +
  // SAME runtime_persona — that's the set the ops dashboard will
  // surface as "these are the groups that granted this persona".
  // Different runtime_personas at the same priority are flagged
  // here for the resolve handler to decide on (currently: take
  // the first, log telemetry).
  const matchedClaimValues = result.rows
    .filter((r) =>
      r.priority === winner.priority
      && r.runtime_persona === winner.runtime_persona,
    )
    .map((r) => r.claim_value);

  return {
    runtimePersona: winner.runtime_persona,
    matchedClaimValues,
    mappingId: winner.id,
    priority: winner.priority,
  };
}
