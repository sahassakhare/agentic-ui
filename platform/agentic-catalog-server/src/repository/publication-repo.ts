import type pg from 'pg';
import type { Experience } from '../domain/experience.js';
import type { ManifestWidget, Publication, PublishedBundle, WorkflowStepJson } from '../domain/publication.js';
import type { BundleSources } from '../publication/bundle.js';

/**
 * Publication repository. Like every catalog repo, queries assume the connection
 * is tenant-scoped via `withTenantScope` — RLS on `experience_publications`
 * enforces isolation, so no `WHERE tenant_id = …` is repeated (the embed read
 * path additionally filters key_hash + tenant_id in SQL as defence-in-depth).
 */

interface PublicationRow {
  id: string;
  tenant_id: string;
  experience_id: string;
  experience_name: string;
  published_version_no: number;
  key_hash: string;
  key_prefix: string;
  allowed_origins: string[];
  bundle: PublishedBundle;
  status: 'active' | 'revoked';
  published_at: Date;
  published_by: string;
  revoked_at: Date | null;
}

/** Full row incl. secrets/bundle — internal to the embed read path. */
export interface PublicationRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly experienceId: string;
  readonly experienceName: string;
  readonly publishedVersionNo: number;
  readonly keyHash: string;
  readonly keyPrefix: string;
  readonly allowedOrigins: string[];
  readonly bundle: PublishedBundle;
  readonly status: 'active' | 'revoked';
  readonly publishedAt: string;
  readonly publishedBy: string;
  readonly revokedAt: string | null;
}

function rowToRecord(row: PublicationRow): PublicationRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    experienceId: row.experience_id,
    experienceName: row.experience_name,
    publishedVersionNo: row.published_version_no,
    keyHash: row.key_hash,
    keyPrefix: row.key_prefix,
    allowedOrigins: row.allowed_origins ?? [],
    bundle: row.bundle,
    status: row.status,
    publishedAt: row.published_at.toISOString(),
    publishedBy: row.published_by,
    revokedAt: row.revoked_at?.toISOString() ?? null,
  };
}

/** Public projection returned to the writer — never leaks key_hash or the bundle. */
export function toPublication(rec: PublicationRecord): Publication {
  return {
    id: rec.id,
    experienceId: rec.experienceId,
    experienceName: rec.experienceName,
    publishedVersionNo: rec.publishedVersionNo,
    keyPrefix: rec.keyPrefix,
    allowedOrigins: rec.allowedOrigins,
    status: rec.status,
    publishedAt: rec.publishedAt,
    publishedBy: rec.publishedBy,
  };
}

const COLUMNS = `id, tenant_id, experience_id, experience_name, published_version_no,
                 key_hash, key_prefix, allowed_origins, bundle, status,
                 published_at, published_by, revoked_at`;

/** Highest version_no captured for an experience (0 if none yet). */
export async function getLatestExperienceVersionNo(
  client: pg.PoolClient,
  experienceId: string,
): Promise<number> {
  const r = await client.query<{ n: string }>(
    `SELECT COALESCE(MAX(version_no), 0) AS n FROM experience_versions WHERE experience_id = $1`,
    [experienceId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * Insert a new active publication, revoking any prior active row for the same
 * experience first (the partial-unique index guarantees at most one active).
 */
export async function insertPublication(
  client: pg.PoolClient,
  tenantId: string,
  input: {
    experienceId: string;
    experienceName: string;
    publishedVersionNo: number;
    keyHash: string;
    keyPrefix: string;
    allowedOrigins: string[];
    bundle: PublishedBundle;
    publishedBy: string;
  },
): Promise<PublicationRecord> {
  await revokeActivePublication(client, input.experienceId);
  const result = await client.query<PublicationRow>(
    `INSERT INTO experience_publications
       (tenant_id, experience_id, experience_name, published_version_no,
        key_hash, key_prefix, allowed_origins, bundle, published_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::JSONB, $9)
     RETURNING ${COLUMNS}`,
    [
      tenantId,
      input.experienceId,
      input.experienceName,
      input.publishedVersionNo,
      input.keyHash,
      input.keyPrefix,
      input.allowedOrigins,
      JSON.stringify(input.bundle),
      input.publishedBy,
    ],
  );
  return rowToRecord(result.rows[0]!);
}

/** Revoke the active publication for an experience (no-op if none). */
export async function revokeActivePublication(
  client: pg.PoolClient,
  experienceId: string,
): Promise<PublicationRecord | null> {
  const result = await client.query<PublicationRow>(
    `UPDATE experience_publications
        SET status = 'revoked', revoked_at = now()
      WHERE experience_id = $1 AND status = 'active'
     RETURNING ${COLUMNS}`,
    [experienceId],
  );
  return result.rows[0] ? rowToRecord(result.rows[0]) : null;
}

/** Rotate the key on the active publication; old key stops working immediately. */
export async function rotatePublicationKey(
  client: pg.PoolClient,
  experienceId: string,
  keyHash: string,
  keyPrefix: string,
): Promise<PublicationRecord | null> {
  const result = await client.query<PublicationRow>(
    `UPDATE experience_publications
        SET key_hash = $2, key_prefix = $3
      WHERE experience_id = $1 AND status = 'active'
     RETURNING ${COLUMNS}`,
    [experienceId, keyHash, keyPrefix],
  );
  return result.rows[0] ? rowToRecord(result.rows[0]) : null;
}

/** Active publication for an experience id (writer-side lookup). */
export async function findActivePublicationByExperienceId(
  client: pg.PoolClient,
  experienceId: string,
): Promise<PublicationRecord | null> {
  const result = await client.query<PublicationRow>(
    `SELECT ${COLUMNS} FROM experience_publications
      WHERE experience_id = $1 AND status = 'active'`,
    [experienceId],
  );
  return result.rows[0] ? rowToRecord(result.rows[0]) : null;
}

/** Active publication by experience name (used by the embed CORS preflight,
 * which has no key header). Scoped to the path tenant via RLS. */
export async function findActivePublicationByName(
  client: pg.PoolClient,
  experienceName: string,
): Promise<PublicationRecord | null> {
  const result = await client.query<PublicationRow>(
    `SELECT ${COLUMNS} FROM experience_publications
      WHERE experience_name = $1 AND status = 'active'`,
    [experienceName],
  );
  return result.rows[0] ? rowToRecord(result.rows[0]) : null;
}

/** Active publication by embed key hash, pinned to the path tenant (embed read). */
export async function findActivePublicationByKeyHash(
  client: pg.PoolClient,
  keyHash: string,
  tenantId: string,
): Promise<PublicationRecord | null> {
  const result = await client.query<PublicationRow>(
    `SELECT ${COLUMNS} FROM experience_publications
      WHERE key_hash = $1 AND tenant_id = $2 AND status = 'active'`,
    [keyHash, tenantId],
  );
  return result.rows[0] ? rowToRecord(result.rows[0]) : null;
}

/**
 * Gather everything the bundle needs from the live catalog: the workflow steps
 * (from the experience's referenced `workflow` capability, if any) and the
 * widget metadata each step needs. Tolerates the two authored shapes
 * (`body.workflow.steps` and legacy `body.steps`) and normalizes terminal `''`
 * transitions to `null`.
 */
export async function resolveCapabilityBodiesForExperience(
  client: pg.PoolClient,
  experience: Experience,
): Promise<BundleSources> {
  const requires = experience.body.requires ?? [];
  const workflowReq = requires.find((r) => r.kind.toLowerCase() === 'workflow' && r.name);

  let workflow: { steps: WorkflowStepJson[] } | null = null;
  if (workflowReq?.name) {
    const cap = await client.query<{ body: Record<string, unknown> }>(
      `SELECT body FROM capabilities
        WHERE lower(kind) = 'workflow' AND name = $1 AND soft_deleted_at IS NULL LIMIT 1`,
      [workflowReq.name],
    );
    const body = cap.rows[0]?.body as { workflow?: { steps?: unknown[] }; steps?: unknown[] } | undefined;
    const rawSteps = body?.workflow?.steps ?? body?.steps;
    if (Array.isArray(rawSteps)) {
      workflow = { steps: rawSteps.map(normalizeStep).filter((s): s is WorkflowStepJson => s !== null) };
    }
  }

  // Widget set = distinct widget names referenced by the workflow steps.
  const widgetNames = workflow ? [...new Set(workflow.steps.map((s) => s.widget))] : [];
  const widgets: ManifestWidget[] = [];
  for (const name of widgetNames) {
    const cap = await client.query<{ kind: string; body: Record<string, unknown> }>(
      `SELECT kind, body FROM capabilities WHERE name = $1 AND soft_deleted_at IS NULL LIMIT 1`,
      [name],
    );
    const found = cap.rows[0];
    widgets.push({
      name,
      kind: found?.kind ?? 'component',
      ...(found && 'propsSchema' in found.body ? { propsSchema: found.body['propsSchema'] } : {}),
    });
  }

  return { experience, workflow, widgets };
}

/** Coerce one stored step into the manifest shape; drop rows missing id/widget. */
function normalizeStep(raw: unknown): WorkflowStepJson | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (typeof s['id'] !== 'string' || typeof s['widget'] !== 'string') return null;
  const rawNext = s['next'];
  const next =
    rawNext === '' || rawNext === undefined ? null
    : (typeof rawNext === 'string' || rawNext === null) ? rawNext
    : (rawNext as WorkflowStepJson['next']); // ConditionalNext object, passed through
  return {
    id: s['id'],
    widget: s['widget'],
    ...(typeof s['section'] === 'string' ? { section: s['section'] } : {}),
    next,
  };
}
