import pg from 'pg';
import type {
  ApprovalEvent,
  ApprovalState,
  Experience,
  ExperienceBody,
  ExperienceCreate,
  ExperienceListQuery,
  ExperienceUpdate,
} from '../domain/experience.js';

interface ExperienceRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly name: string;
  readonly title: string;
  readonly goal: string;
  readonly body: ExperienceBody;
  readonly approval_state: ApprovalState;
  readonly approval_chain: ApprovalEvent[];
  readonly owner: string | null;
  readonly tags: string[];
  readonly version: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly created_by: string;
  readonly soft_deleted_at: Date | null;
}

const COLUMNS = `id, tenant_id, name, title, goal, body, approval_state, approval_chain,
                 owner, tags, version, created_at, updated_at, created_by, soft_deleted_at`;

function rowToExperience(row: ExperienceRow): Experience {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    title: row.title,
    goal: row.goal,
    body: row.body ?? {},
    approvalState: row.approval_state,
    approvalChain: row.approval_chain ?? [],
    owner: row.owner,
    tags: row.tags ?? [],
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    createdBy: row.created_by,
    softDeletedAt: row.soft_deleted_at?.toISOString() ?? null,
  };
}

export async function listExperiences(
  client: pg.PoolClient,
  query: ExperienceListQuery,
): Promise<{ items: Experience[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (!query.includeDeleted) where.push('soft_deleted_at IS NULL');
  if (query.approvalState) { where.push(`approval_state = $${idx++}`); params.push(query.approvalState); }
  if (query.owner) { where.push(`owner = $${idx++}`); params.push(query.owner); }
  if (query.tag) { where.push(`$${idx++} = ANY(tags)`); params.push(query.tag); }
  if (query.q) { where.push(`(name ILIKE $${idx} OR title ILIKE $${idx})`); idx++; params.push(`%${query.q}%`); }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const countResult = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM experiences ${whereClause}`,
    params,
  );
  const total = Number(countResult.rows[0]?.count ?? '0');

  params.push(query.limit, query.offset);
  const result = await client.query<ExperienceRow>(
    `SELECT ${COLUMNS} FROM experiences ${whereClause}
      ORDER BY name LIMIT $${idx++} OFFSET $${idx++}`,
    params,
  );
  return { items: result.rows.map(rowToExperience), total };
}

export async function findExperienceById(client: pg.PoolClient, id: string): Promise<Experience | null> {
  const result = await client.query<ExperienceRow>(
    `SELECT ${COLUMNS} FROM experiences WHERE id = $1`, [id],
  );
  return result.rows[0] ? rowToExperience(result.rows[0]) : null;
}

export async function findExperienceByName(client: pg.PoolClient, name: string): Promise<Experience | null> {
  const result = await client.query<ExperienceRow>(
    `SELECT ${COLUMNS} FROM experiences WHERE name = $1`, [name],
  );
  return result.rows[0] ? rowToExperience(result.rows[0]) : null;
}

export async function createExperience(
  client: pg.PoolClient,
  tenantId: string,
  input: ExperienceCreate,
  createdBy: string,
): Promise<Experience> {
  const result = await client.query<ExperienceRow>(
    `INSERT INTO experiences
       (tenant_id, name, title, goal, body, approval_state, owner, tags, version, created_by)
     VALUES ($1, $2, $3, $4, $5::JSONB, $6, $7, $8, $9, $10)
     RETURNING ${COLUMNS}`,
    [
      tenantId,
      input.name,
      input.title,
      input.goal,
      JSON.stringify(input.body),
      input.approvalState,
      input.owner ?? null,
      input.tags,
      input.version ?? null,
      createdBy,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('INSERT returned no rows — should be impossible');
  return rowToExperience(row);
}

export async function updateExperience(
  client: pg.PoolClient,
  id: string,
  patch: ExperienceUpdate,
): Promise<Experience | null> {
  const set: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (patch.title !== undefined) { set.push(`title = $${idx++}`); params.push(patch.title); }
  if (patch.goal !== undefined) { set.push(`goal = $${idx++}`); params.push(patch.goal); }
  if (patch.body !== undefined) { set.push(`body = $${idx++}::JSONB`); params.push(JSON.stringify(patch.body)); }
  if (patch.owner !== undefined) { set.push(`owner = $${idx++}`); params.push(patch.owner); }
  if (patch.tags !== undefined) { set.push(`tags = $${idx++}`); params.push(patch.tags); }
  if (patch.version !== undefined) { set.push(`version = $${idx++}`); params.push(patch.version); }
  if (set.length === 0) return findExperienceById(client, id);

  set.push(`updated_at = now()`);
  params.push(id);
  const result = await client.query<ExperienceRow>(
    `UPDATE experiences SET ${set.join(', ')}
      WHERE id = $${idx} AND soft_deleted_at IS NULL
     RETURNING ${COLUMNS}`,
    params,
  );
  return result.rows[0] ? rowToExperience(result.rows[0]) : null;
}

/**
 * Apply an approval transition: swap `approval_state` and persist the full
 * `approval_chain`, atomically. The caller validated the transition via
 * `nextApprovalState`, appended the event, and passes the complete new chain
 * (avoids the `jsonb || jsonb` operator, which pg-mem doesn't implement).
 */
export async function applyExperienceTransition(
  client: pg.PoolClient,
  id: string,
  toState: ApprovalState,
  chain: readonly ApprovalEvent[],
): Promise<Experience | null> {
  const result = await client.query<ExperienceRow>(
    `UPDATE experiences
        SET approval_state = $2,
            approval_chain = $3::JSONB,
            updated_at = now()
      WHERE id = $1 AND soft_deleted_at IS NULL
     RETURNING ${COLUMNS}`,
    [id, toState, JSON.stringify(chain)],
  );
  return result.rows[0] ? rowToExperience(result.rows[0]) : null;
}

export async function softDeleteExperience(client: pg.PoolClient, id: string): Promise<Experience | null> {
  const result = await client.query<ExperienceRow>(
    `UPDATE experiences SET soft_deleted_at = now()
      WHERE id = $1 AND soft_deleted_at IS NULL
     RETURNING ${COLUMNS}`,
    [id],
  );
  return result.rows[0] ? rowToExperience(result.rows[0]) : null;
}

/**
 * Server-side direct-requirement resolution (the `/plan` dry-run). Checks each
 * declared requirement against the tenant's non-deleted capabilities, matching
 * on BOTH kind and name/tag (the runtime planner owns full transitive graph
 * traversal). Kind is compared case-insensitively so runtime camelCase kinds
 * (`dataSource`) match the catalog's lowercase storage (`datasource`). Returns
 * matched + unmet (non-optional misses).
 */
export async function resolveExperienceRequirements(
  client: pg.PoolClient,
  experience: Experience,
): Promise<{ matched: { kind: string; name: string }[]; unmet: { kind: string; name?: string; tag?: string }[] }> {
  const requires = experience.body.requires ?? [];
  const matched: { kind: string; name: string }[] = [];
  const unmet: { kind: string; name?: string; tag?: string }[] = [];

  for (const req of requires) {
    if (req.name) {
      const hit = await client.query<{ name: string }>(
        `SELECT name FROM capabilities
          WHERE lower(kind) = lower($1) AND name = $2 AND soft_deleted_at IS NULL LIMIT 1`,
        [req.kind, req.name],
      );
      if (hit.rows[0]) matched.push({ kind: req.kind, name: req.name });
      else if (!req.optional) unmet.push({ kind: req.kind, name: req.name });
    } else if (req.tag) {
      const hit = await client.query<{ name: string }>(
        `SELECT name FROM capabilities
          WHERE lower(kind) = lower($1) AND $2 = ANY(tags) AND soft_deleted_at IS NULL`,
        [req.kind, req.tag],
      );
      if (hit.rows.length > 0) hit.rows.forEach((r) => matched.push({ kind: req.kind, name: r.name }));
      else if (!req.optional) unmet.push({ kind: req.kind, tag: req.tag });
    } else if (!req.optional) {
      unmet.push({ kind: req.kind });
    }
  }
  return { matched, unmet };
}
