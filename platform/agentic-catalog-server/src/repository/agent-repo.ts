import pg from 'pg';
import type { Agent, AgentCreate, AgentUpdate } from '../domain/agent.js';

interface AgentRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly name: string;
  readonly kind: 'ag-ui' | 'hashbrown' | 'a2ui' | 'mcp' | 'custom';
  readonly manifest_url: string;
  readonly version: string | null;
  readonly required_host_version: string | null;
  readonly capabilities: string[];
  readonly status: 'active' | 'degraded' | 'inactive';
  readonly last_health_at: Date | null;
  readonly registered_by: string;
  readonly registered_at: Date;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly soft_deleted_at: Date | null;
}

function rowToAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    kind: row.kind,
    manifestUrl: row.manifest_url,
    version: row.version,
    requiredHostVersion: row.required_host_version,
    capabilities: row.capabilities,
    status: row.status,
    lastHealthAt: row.last_health_at?.toISOString() ?? null,
    registeredBy: row.registered_by,
    registeredAt: row.registered_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    softDeletedAt: row.soft_deleted_at?.toISOString() ?? null,
  };
}

export async function listAgents(client: pg.PoolClient): Promise<Agent[]> {
  const result = await client.query<AgentRow>(
    `SELECT id, tenant_id, name, kind, manifest_url, version, required_host_version,
            capabilities, status, last_health_at, registered_by, registered_at,
            created_at, updated_at, soft_deleted_at
       FROM agents
      WHERE soft_deleted_at IS NULL
      ORDER BY name ASC`,
  );
  return result.rows.map(rowToAgent);
}

export async function findAgentById(client: pg.PoolClient, id: string): Promise<Agent | null> {
  const result = await client.query<AgentRow>(
    `SELECT id, tenant_id, name, kind, manifest_url, version, required_host_version,
            capabilities, status, last_health_at, registered_by, registered_at,
            created_at, updated_at, soft_deleted_at
       FROM agents
      WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? rowToAgent(result.rows[0]) : null;
}

export async function findAgentByName(client: pg.PoolClient, name: string): Promise<Agent | null> {
  const result = await client.query<AgentRow>(
    `SELECT id, tenant_id, name, kind, manifest_url, version, required_host_version,
            capabilities, status, last_health_at, registered_by, registered_at,
            created_at, updated_at, soft_deleted_at
       FROM agents
      WHERE name = $1`,
    [name],
  );
  return result.rows[0] ? rowToAgent(result.rows[0]) : null;
}

export async function createAgent(
  client: pg.PoolClient,
  tenantId: string,
  input: AgentCreate,
  registeredBy: string,
): Promise<Agent> {
  const result = await client.query<AgentRow>(
    `INSERT INTO agents
       (tenant_id, name, kind, manifest_url, version, required_host_version,
        capabilities, registered_by, last_health_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::JSONB, $8, now())
     RETURNING id, tenant_id, name, kind, manifest_url, version, required_host_version,
               capabilities, status, last_health_at, registered_by, registered_at,
               created_at, updated_at, soft_deleted_at`,
    [
      tenantId,
      input.name,
      input.kind,
      input.manifestUrl,
      input.version ?? null,
      input.requiredHostVersion ?? null,
      JSON.stringify(input.capabilities),
      registeredBy,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('INSERT returned no rows — should be impossible');
  return rowToAgent(row);
}

export async function updateAgent(
  client: pg.PoolClient,
  id: string,
  patch: AgentUpdate,
): Promise<Agent | null> {
  const set: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (patch.manifestUrl !== undefined) { set.push(`manifest_url = $${idx++}`); params.push(patch.manifestUrl); }
  if (patch.version !== undefined) { set.push(`version = $${idx++}`); params.push(patch.version); }
  if (patch.requiredHostVersion !== undefined) { set.push(`required_host_version = $${idx++}`); params.push(patch.requiredHostVersion); }
  if (patch.capabilities !== undefined) { set.push(`capabilities = $${idx++}::JSONB`); params.push(JSON.stringify(patch.capabilities)); }
  if (patch.status !== undefined) { set.push(`status = $${idx++}`); params.push(patch.status); }
  if (set.length === 0) {
    return findAgentById(client, id);
  }
  set.push(`updated_at = now()`);
  params.push(id);

  const result = await client.query<AgentRow>(
    `UPDATE agents SET ${set.join(', ')}
      WHERE id = $${idx} AND soft_deleted_at IS NULL
     RETURNING id, tenant_id, name, kind, manifest_url, version, required_host_version,
               capabilities, status, last_health_at, registered_by, registered_at,
               created_at, updated_at, soft_deleted_at`,
    params,
  );
  return result.rows[0] ? rowToAgent(result.rows[0]) : null;
}

/**
 * Heartbeat: stamps `last_health_at = now()` and optionally updates
 * `status`. Lighter than a full PATCH — the route appends no audit
 * row (heartbeats are too frequent), and the response is minimal.
 */
export async function recordAgentHeartbeat(
  client: pg.PoolClient,
  id: string,
  status?: 'active' | 'degraded' | 'inactive',
): Promise<Agent | null> {
  const sql = status
    ? `UPDATE agents SET last_health_at = now(), status = $2, updated_at = now()
        WHERE id = $1 AND soft_deleted_at IS NULL
        RETURNING id, tenant_id, name, kind, manifest_url, version, required_host_version,
                  capabilities, status, last_health_at, registered_by, registered_at,
                  created_at, updated_at, soft_deleted_at`
    : `UPDATE agents SET last_health_at = now(), updated_at = now()
        WHERE id = $1 AND soft_deleted_at IS NULL
        RETURNING id, tenant_id, name, kind, manifest_url, version, required_host_version,
                  capabilities, status, last_health_at, registered_by, registered_at,
                  created_at, updated_at, soft_deleted_at`;
  const result = await client.query<AgentRow>(sql, status ? [id, status] : [id]);
  return result.rows[0] ? rowToAgent(result.rows[0]) : null;
}

export async function softDeleteAgent(client: pg.PoolClient, id: string): Promise<Agent | null> {
  const result = await client.query<AgentRow>(
    `UPDATE agents SET soft_deleted_at = now(), status = 'inactive'
      WHERE id = $1 AND soft_deleted_at IS NULL
     RETURNING id, tenant_id, name, kind, manifest_url, version, required_host_version,
               capabilities, status, last_health_at, registered_by, registered_at,
               created_at, updated_at, soft_deleted_at`,
    [id],
  );
  return result.rows[0] ? rowToAgent(result.rows[0]) : null;
}
