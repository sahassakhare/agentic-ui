import type pg from 'pg';
import {
  type Capability,
  type CapabilityCreate,
  type CapabilityListQuery,
  type CapabilityUpdate,
} from '../domain/capability.js';

/**
 * Capability repository. All queries assume the connection has been
 * scoped to the active tenant via `withTenantScope` — RLS policies on
 * `capabilities` enforce isolation, so SQL here doesn't repeat
 * `WHERE tenant_id = ...` predicates. The `client` argument is a
 * pooled connection inside an open transaction.
 *
 * Returned rows are mapped to camelCase + ISO-8601 strings so they
 * match the Zod schemas in `domain/capability.ts`.
 */

interface CapabilityRow {
  id: string;
  tenant_id: string;
  kind: string;
  name: string;
  body: Record<string, unknown>;
  lifecycle: string;
  owner: string | null;
  tags: string[];
  required_host_version: string | null;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  soft_deleted_at: Date | null;
}

function rowToCapability(row: CapabilityRow): Capability {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind as Capability['kind'],
    name: row.name,
    body: row.body,
    lifecycle: row.lifecycle as Capability['lifecycle'],
    owner: row.owner,
    tags: row.tags,
    requiredHostVersion: row.required_host_version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    createdBy: row.created_by,
    softDeletedAt: row.soft_deleted_at?.toISOString() ?? null,
  };
}

export async function findCapabilityById(
  client: pg.PoolClient,
  id: string,
): Promise<Capability | null> {
  const result = await client.query<CapabilityRow>(
    `SELECT id, tenant_id, kind, name, body, lifecycle, owner, tags,
            required_host_version, created_at, updated_at, created_by,
            soft_deleted_at
     FROM capabilities
     WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? rowToCapability(result.rows[0]) : null;
}

export async function findCapabilityByName(
  client: pg.PoolClient,
  kind: string,
  name: string,
): Promise<Capability | null> {
  const result = await client.query<CapabilityRow>(
    `SELECT id, tenant_id, kind, name, body, lifecycle, owner, tags,
            required_host_version, created_at, updated_at, created_by,
            soft_deleted_at
     FROM capabilities
     WHERE kind = $1 AND name = $2`,
    [kind, name],
  );
  return result.rows[0] ? rowToCapability(result.rows[0]) : null;
}

export async function listCapabilities(
  client: pg.PoolClient,
  query: CapabilityListQuery,
): Promise<{ items: Capability[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (!query.includeDeleted) {
    where.push('soft_deleted_at IS NULL');
  }
  if (query.kind) {
    where.push(`kind = $${idx++}`);
    params.push(query.kind);
  }
  if (query.lifecycle) {
    where.push(`lifecycle = $${idx++}`);
    params.push(query.lifecycle);
  }
  if (query.owner) {
    where.push(`owner = $${idx++}`);
    params.push(query.owner);
  }
  if (query.tag) {
    where.push(`$${idx++} = ANY(tags)`);
    params.push(query.tag);
  }
  if (query.q) {
    where.push(`name ILIKE $${idx++}`);
    params.push(`%${query.q}%`);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const countResult = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM capabilities ${whereClause}`,
    params,
  );
  const total = Number(countResult.rows[0]?.count ?? '0');

  params.push(query.limit, query.offset);
  const result = await client.query<CapabilityRow>(
    `SELECT id, tenant_id, kind, name, body, lifecycle, owner, tags,
            required_host_version, created_at, updated_at, created_by,
            soft_deleted_at
     FROM capabilities
     ${whereClause}
     ORDER BY kind, name
     LIMIT $${idx++} OFFSET $${idx++}`,
    params,
  );

  return {
    items: result.rows.map(rowToCapability),
    total,
  };
}

export async function createCapability(
  client: pg.PoolClient,
  tenantId: string,
  input: CapabilityCreate,
  createdBy: string,
  embedding: readonly number[] | null = null,
): Promise<Capability> {
  // Only reference the embedding column when we actually have one to
  // store. The column defaults to NULL in the migration; omitting it
  // from the INSERT keeps the SQL portable across pg-mem (test
  // harness — no `vector` type) and real pgvector-enabled Postgres.
  if (embedding) {
    const result = await client.query<CapabilityRow>(
      `INSERT INTO capabilities
         (tenant_id, kind, name, body, lifecycle, owner, tags, required_host_version, created_by, embedding)
       VALUES ($1, $2, $3, $4::JSONB, $5, $6, $7, $8, $9, $10::vector)
       RETURNING id, tenant_id, kind, name, body, lifecycle, owner, tags,
                 required_host_version, created_at, updated_at, created_by,
                 soft_deleted_at`,
      [
        tenantId,
        input.kind,
        input.name,
        JSON.stringify(input.body),
        input.lifecycle,
        input.owner ?? null,
        input.tags,
        input.requiredHostVersion ?? null,
        createdBy,
        formatVector(embedding),
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('INSERT returned no rows — should be impossible');
    return rowToCapability(row);
  }
  const result = await client.query<CapabilityRow>(
    `INSERT INTO capabilities
       (tenant_id, kind, name, body, lifecycle, owner, tags, required_host_version, created_by)
     VALUES ($1, $2, $3, $4::JSONB, $5, $6, $7, $8, $9)
     RETURNING id, tenant_id, kind, name, body, lifecycle, owner, tags,
               required_host_version, created_at, updated_at, created_by,
               soft_deleted_at`,
    [
      tenantId,
      input.kind,
      input.name,
      JSON.stringify(input.body),
      input.lifecycle,
      input.owner ?? null,
      input.tags,
      input.requiredHostVersion ?? null,
      createdBy,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('INSERT returned no rows — should be impossible');
  return rowToCapability(row);
}

/**
 * Update a capability's embedding column. Used by the backfill CLI
 * + by re-embedding after PATCH on body/tags/name fields. No-op
 * when embedding is null (we never write NULL via this helper —
 * NULL is the column default and only set via INSERT-without-column).
 */
export async function updateCapabilityEmbedding(
  client: pg.PoolClient,
  id: string,
  embedding: readonly number[],
): Promise<void> {
  await client.query(
    `UPDATE capabilities SET embedding = $2::vector WHERE id = $1`,
    [id, formatVector(embedding)],
  );
}

/**
 * Semantic-search query result: capability + cosine similarity score
 * (1.0 = identical, 0.0 = orthogonal). Higher is better.
 */
export interface CapabilitySearchHit {
  readonly capability: Capability;
  readonly score: number;
}

export async function searchCapabilitiesByEmbedding(
  client: pg.PoolClient,
  query: {
    readonly embedding: readonly number[];
    readonly kind?: string;
    readonly topK: number;
  },
): Promise<CapabilitySearchHit[]> {
  const where: string[] = ['embedding IS NOT NULL', 'soft_deleted_at IS NULL'];
  const params: unknown[] = [formatVector(query.embedding)];
  let idx = 2;
  if (query.kind) {
    where.push(`kind = $${idx++}`);
    params.push(query.kind);
  }
  params.push(query.topK);
  const result = await client.query<CapabilityRow & { score: string }>(
    `SELECT id, tenant_id, kind, name, body, lifecycle, owner, tags,
            required_host_version, created_at, updated_at, created_by,
            soft_deleted_at,
            (1 - (embedding <=> $1::vector))::float8 AS score
       FROM capabilities
      WHERE ${where.join(' AND ')}
      ORDER BY embedding <=> $1::vector
      LIMIT $${idx}`,
    params,
  );
  return result.rows.map((row) => ({
    capability: rowToCapability(row),
    score: Number(row.score),
  }));
}

/**
 * pgvector accepts vectors in literal form `[v1,v2,v3]`. We format
 * here so callers don't need to think about it.
 */
function formatVector(v: readonly number[]): string {
  return `[${v.join(',')}]`;
}

export async function updateCapability(
  client: pg.PoolClient,
  id: string,
  patch: CapabilityUpdate,
): Promise<Capability | null> {
  const set: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (patch.body !== undefined) {
    set.push(`body = $${idx++}::JSONB`);
    params.push(JSON.stringify(patch.body));
  }
  if (patch.lifecycle !== undefined) {
    set.push(`lifecycle = $${idx++}`);
    params.push(patch.lifecycle);
  }
  if (patch.owner !== undefined) {
    set.push(`owner = $${idx++}`);
    params.push(patch.owner);
  }
  if (patch.tags !== undefined) {
    set.push(`tags = $${idx++}`);
    params.push(patch.tags);
  }
  if (patch.requiredHostVersion !== undefined) {
    set.push(`required_host_version = $${idx++}`);
    params.push(patch.requiredHostVersion);
  }
  if (set.length === 0) {
    // Empty patch — re-read the existing row.
    return findCapabilityById(client, id);
  }
  params.push(id);
  const result = await client.query<CapabilityRow>(
    `UPDATE capabilities
     SET ${set.join(', ')}
     WHERE id = $${idx++}
     RETURNING id, tenant_id, kind, name, body, lifecycle, owner, tags,
               required_host_version, created_at, updated_at, created_by,
               soft_deleted_at`,
    params,
  );
  return result.rows[0] ? rowToCapability(result.rows[0]) : null;
}

/**
 * Soft-delete: mark `soft_deleted_at = now()`. Lifecycle moves to
 * `'disabled'` so default list queries (which filter by `lifecycle
 * IN ('published')` typically) drop it. Hard-delete via DELETE is
 * intentionally NOT exposed — capability deletes need an audit
 * trail and a recovery window.
 */
export async function softDeleteCapability(
  client: pg.PoolClient,
  id: string,
): Promise<Capability | null> {
  const result = await client.query<CapabilityRow>(
    `UPDATE capabilities
     SET soft_deleted_at = now(),
         lifecycle = 'disabled'
     WHERE id = $1 AND soft_deleted_at IS NULL
     RETURNING id, tenant_id, kind, name, body, lifecycle, owner, tags,
               required_host_version, created_at, updated_at, created_by,
               soft_deleted_at`,
    [id],
  );
  return result.rows[0] ? rowToCapability(result.rows[0]) : null;
}

/**
 * Reverse a soft-delete. Restores `soft_deleted_at` to NULL; the
 * caller decides what `lifecycle` the restored entry should land at
 * (typically the value before the delete — passed in as a patch).
 */
export async function restoreCapability(
  client: pg.PoolClient,
  id: string,
): Promise<Capability | null> {
  const result = await client.query<CapabilityRow>(
    `UPDATE capabilities
     SET soft_deleted_at = NULL
     WHERE id = $1 AND soft_deleted_at IS NOT NULL
     RETURNING id, tenant_id, kind, name, body, lifecycle, owner, tags,
               required_host_version, created_at, updated_at, created_by,
               soft_deleted_at`,
    [id],
  );
  return result.rows[0] ? rowToCapability(result.rows[0]) : null;
}
