import type pg from 'pg';
import {
  type MfeRemote,
  type MfeRemoteCreate,
  type MfeRemoteUpdate,
} from '../domain/mfe.js';

interface MfeRow {
  id: string;
  tenant_id: string;
  name: string;
  manifest_url: string;
  version: string | null;
  required_host_version: string | null;
  exposes: Record<string, string[]>;
  status: string;
  last_health_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function rowToMfe(row: MfeRow): MfeRemote {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    manifestUrl: row.manifest_url,
    version: row.version,
    requiredHostVersion: row.required_host_version,
    exposes: row.exposes,
    status: row.status as MfeRemote['status'],
    lastHealthAt: row.last_health_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listMfeRemotes(client: pg.PoolClient): Promise<MfeRemote[]> {
  const result = await client.query<MfeRow>(
    `SELECT id, tenant_id, name, manifest_url, version, required_host_version,
            exposes, status, last_health_at, created_at, updated_at
     FROM mfe_remotes
     ORDER BY name`,
  );
  return result.rows.map(rowToMfe);
}

export async function findMfeByName(
  client: pg.PoolClient,
  name: string,
): Promise<MfeRemote | null> {
  const result = await client.query<MfeRow>(
    `SELECT id, tenant_id, name, manifest_url, version, required_host_version,
            exposes, status, last_health_at, created_at, updated_at
     FROM mfe_remotes
     WHERE name = $1`,
    [name],
  );
  return result.rows[0] ? rowToMfe(result.rows[0]) : null;
}

export async function createMfeRemote(
  client: pg.PoolClient,
  tenantId: string,
  input: MfeRemoteCreate,
): Promise<MfeRemote> {
  const result = await client.query<MfeRow>(
    `INSERT INTO mfe_remotes
       (tenant_id, name, manifest_url, version, required_host_version, exposes, status)
     VALUES ($1, $2, $3, $4, $5, $6::JSONB, $7)
     RETURNING id, tenant_id, name, manifest_url, version, required_host_version,
               exposes, status, last_health_at, created_at, updated_at`,
    [
      tenantId,
      input.name,
      input.manifestUrl,
      input.version ?? null,
      input.requiredHostVersion ?? null,
      JSON.stringify(input.exposes),
      input.status,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('INSERT returned no rows');
  return rowToMfe(row);
}

export async function updateMfeRemote(
  client: pg.PoolClient,
  name: string,
  patch: MfeRemoteUpdate,
): Promise<MfeRemote | null> {
  const set: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (patch.manifestUrl !== undefined) {
    set.push(`manifest_url = $${idx++}`);
    params.push(patch.manifestUrl);
  }
  if (patch.version !== undefined) {
    set.push(`version = $${idx++}`);
    params.push(patch.version);
  }
  if (patch.requiredHostVersion !== undefined) {
    set.push(`required_host_version = $${idx++}`);
    params.push(patch.requiredHostVersion);
  }
  if (patch.exposes !== undefined) {
    set.push(`exposes = $${idx++}::JSONB`);
    params.push(JSON.stringify(patch.exposes));
  }
  if (patch.status !== undefined) {
    set.push(`status = $${idx++}`);
    params.push(patch.status);
  }
  if (set.length === 0) return findMfeByName(client, name);

  params.push(name);
  const result = await client.query<MfeRow>(
    `UPDATE mfe_remotes
     SET ${set.join(', ')}
     WHERE name = $${idx++}
     RETURNING id, tenant_id, name, manifest_url, version, required_host_version,
               exposes, status, last_health_at, created_at, updated_at`,
    params,
  );
  return result.rows[0] ? rowToMfe(result.rows[0]) : null;
}

export async function deleteMfeRemote(
  client: pg.PoolClient,
  name: string,
): Promise<boolean> {
  const result = await client.query(
    `DELETE FROM mfe_remotes WHERE name = $1`,
    [name],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Record a health probe result. The probe itself is run by an
 * external scheduler (cron / k8s probe / external monitor) — the
 * catalog server is the durable record-of-last-health, not the
 * prober.
 */
export async function recordHealth(
  client: pg.PoolClient,
  name: string,
  status: MfeRemote['status'],
): Promise<void> {
  await client.query(
    `UPDATE mfe_remotes
     SET status = $1,
         last_health_at = now()
     WHERE name = $2`,
    [status, name],
  );
}
