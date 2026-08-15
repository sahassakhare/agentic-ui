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
 * Apply an approval transition with OPTIMISTIC CONCURRENCY: the UPDATE only
 * fires when `approval_state` still equals `fromState` the caller read. If a
 * concurrent transition already moved the row, zero rows come back and the
 * caller returns 409 instead of silently dropping an approval event / losing
 * the appended chain (the read-modify-write race under READ COMMITTED).
 *
 * The full chain is passed (not `jsonb || jsonb`, which pg-mem lacks); the
 * `fromState` guard makes the whole read-compute-write sequence safe without a
 * row lock.
 */
export async function applyExperienceTransition(
  client: pg.PoolClient,
  id: string,
  fromState: ApprovalState,
  toState: ApprovalState,
  chain: readonly ApprovalEvent[],
): Promise<Experience | null> {
  const result = await client.query<ExperienceRow>(
    `UPDATE experiences
        SET approval_state = $3,
            approval_chain = $4::JSONB,
            updated_at = now()
      WHERE id = $1 AND approval_state = $2 AND soft_deleted_at IS NULL
     RETURNING ${COLUMNS}`,
    [id, fromState, toState, JSON.stringify(chain)],
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

// ── Version history (change management, ADR gap A4) ─────────────────────────

export interface ExperienceVersion {
  readonly versionNo: number;
  readonly snapshot: Record<string, unknown>;
  readonly reason: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

/** The mutable, roll-back-able shape of an experience captured per version. */
function snapshotOf(e: Experience): Record<string, unknown> {
  return {
    title: e.title, goal: e.goal, body: e.body, tags: e.tags,
    owner: e.owner, version: e.version, approvalState: e.approvalState,
  };
}

/**
 * Append an immutable version snapshot. The per-experience version counter is
 * serialised with a transaction-scoped advisory lock (same pattern as the audit
 * chain) so concurrent writers never collide on `version_no`. Guarded so the
 * pg-mem unit harness (no advisory locks) no-ops the lock.
 */
export async function appendExperienceVersion(
  client: pg.PoolClient,
  tenantId: string,
  experienceId: string,
  experience: Experience,
  reason: string,
  actor: string,
): Promise<number> {
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`exp-ver:${experienceId}`]);
  } catch (err) {
    const msg = (err as Error)?.message ?? '';
    if (!/does not exist|not supported|advisory|hashtextextended|function/i.test(msg)) throw err;
  }
  const next = await client.query<{ n: string }>(
    `SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM experience_versions WHERE experience_id = $1`,
    [experienceId],
  );
  const versionNo = Number(next.rows[0]?.n ?? 1);
  await client.query(
    `INSERT INTO experience_versions (tenant_id, experience_id, version_no, snapshot, reason, created_by)
     VALUES ($1, $2, $3, $4::JSONB, $5, $6)`,
    [tenantId, experienceId, versionNo, JSON.stringify(snapshotOf(experience)), reason, actor],
  );
  return versionNo;
}

export async function listExperienceVersions(
  client: pg.PoolClient,
  experienceId: string,
): Promise<ExperienceVersion[]> {
  const r = await client.query<{ version_no: number; snapshot: Record<string, unknown>; reason: string; created_at: Date; created_by: string }>(
    `SELECT version_no, snapshot, reason, created_at, created_by
       FROM experience_versions WHERE experience_id = $1 ORDER BY version_no DESC`,
    [experienceId],
  );
  return r.rows.map((x) => ({
    versionNo: x.version_no, snapshot: x.snapshot, reason: x.reason,
    createdAt: x.created_at.toISOString(), createdBy: x.created_by,
  }));
}

export async function getExperienceVersion(
  client: pg.PoolClient,
  experienceId: string,
  versionNo: number,
): Promise<ExperienceVersion | null> {
  const r = await client.query<{ version_no: number; snapshot: Record<string, unknown>; reason: string; created_at: Date; created_by: string }>(
    `SELECT version_no, snapshot, reason, created_at, created_by
       FROM experience_versions WHERE experience_id = $1 AND version_no = $2`,
    [experienceId, versionNo],
  );
  const x = r.rows[0];
  return x ? { versionNo: x.version_no, snapshot: x.snapshot, reason: x.reason, createdAt: x.created_at.toISOString(), createdBy: x.created_by } : null;
}

interface MatchedRef { kind: string; name: string; via?: string }
interface UnmetRef { kind: string; name?: string; tag?: string; via?: string }

/**
 * Server-side requirement resolution (the `/plan` dry-run). Resolves each
 * declared requirement against the tenant's non-deleted capabilities (kind
 * compared case-insensitively so runtime `dataSource` matches stored
 * `datasource`), THEN traverses one level of transitive references so an
 * experience's forms/workflows surface their field bindings as dependencies:
 *   form   → schema.fields[].widget / .source / .validators[]
 *   workflow → steps[].widget
 * Transitive refs carry `via` (the form/workflow that introduced them) and are
 * de-duped against the direct requires. The runtime planner owns the full graph;
 * this is the governance-time bill of materials.
 */
export async function resolveExperienceRequirements(
  client: pg.PoolClient,
  experience: Experience,
): Promise<{ matched: MatchedRef[]; unmet: UnmetRef[] }> {
  const requires = experience.body.requires ?? [];
  const matched: MatchedRef[] = [];
  const unmet: UnmetRef[] = [];
  const seen = new Set<string>();
  const key = (kind: string, name: string) => `${kind.toLowerCase()}:${name}`;

  const existsInKinds = async (kinds: string[], name: string): Promise<string | null> => {
    const r = await client.query<{ kind: string }>(
      `SELECT kind FROM capabilities WHERE lower(kind) = ANY($1) AND name = $2 AND soft_deleted_at IS NULL LIMIT 1`,
      [kinds.map((k) => k.toLowerCase()), name],
    );
    return r.rows[0]?.kind ?? null;
  };
  /** Resolve a single transitive ref (of one of `kinds`), de-duped, tagged `via`. */
  const addRef = async (kinds: string[], name: string | undefined, via: string): Promise<void> => {
    if (!name) return;
    const k = key(kinds[0]!, name);
    if (seen.has(k) || seen.has(`${name}`) || [...seen].some((s) => s.endsWith(`:${name}`))) return;
    seen.add(k);
    const found = await existsInKinds(kinds, name);
    if (found) matched.push({ kind: found, name, via });
    else unmet.push({ kind: kinds[0]!, name, via });
  };

  // ── direct requires ─────────────────────────────────────────────────────────
  for (const req of requires) {
    if (req.name) {
      seen.add(key(req.kind, req.name));
      const hit = await client.query<{ name: string }>(
        `SELECT name FROM capabilities WHERE lower(kind) = lower($1) AND name = $2 AND soft_deleted_at IS NULL LIMIT 1`,
        [req.kind, req.name],
      );
      if (hit.rows[0]) matched.push({ kind: req.kind, name: req.name });
      else if (!req.optional) unmet.push({ kind: req.kind, name: req.name });
    } else if (req.tag) {
      const hit = await client.query<{ name: string }>(
        `SELECT name FROM capabilities WHERE lower(kind) = lower($1) AND $2 = ANY(tags) AND soft_deleted_at IS NULL`,
        [req.kind, req.tag],
      );
      if (hit.rows.length > 0) hit.rows.forEach((r) => matched.push({ kind: req.kind, name: r.name }));
      else if (!req.optional) unmet.push({ kind: req.kind, tag: req.tag });
    } else if (!req.optional) {
      unmet.push({ kind: req.kind });
    }
  }

  // ── one level of transitive refs (form fields + workflow steps) ──────────────
  for (const req of requires) {
    if (!req.name) continue;
    const kind = req.kind.toLowerCase();
    if (kind === 'form') {
      const cap = await client.query<{ body: { schema?: { fields?: Array<{ widget?: string; source?: string; validators?: string[] }> } } }>(
        `SELECT body FROM capabilities WHERE lower(kind) = 'form' AND name = $1 AND soft_deleted_at IS NULL LIMIT 1`,
        [req.name],
      );
      for (const f of cap.rows[0]?.body?.schema?.fields ?? []) {
        await addRef(['component'], f.widget, req.name);
        await addRef(['datasource', 'tool'], f.source, req.name);
        for (const v of f.validators ?? []) await addRef(['validation'], v, req.name);
      }
    } else if (kind === 'workflow') {
      const cap = await client.query<{ body: { workflow?: { steps?: Array<{ widget?: string }> }; steps?: Array<{ widget?: string }> } }>(
        `SELECT body FROM capabilities WHERE lower(kind) = 'workflow' AND name = $1 AND soft_deleted_at IS NULL LIMIT 1`,
        [req.name],
      );
      const steps = cap.rows[0]?.body?.workflow?.steps ?? cap.rows[0]?.body?.steps ?? [];
      for (const s of steps) await addRef(['component'], s.widget, req.name);
    }
  }

  return { matched, unmet };
}
