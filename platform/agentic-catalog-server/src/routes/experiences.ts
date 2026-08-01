import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  ExperienceCreateSchema,
  ExperienceListQuerySchema,
  ExperienceSchema,
  ExperienceTransitionSchema,
  ExperienceUpdateSchema,
  nextApprovalState,
  ApprovalTransitionError,
  type ApprovalEvent,
} from '../domain/experience.js';
import { auditActor } from '../domain/principal.js';
import { withTenantScope, type CatalogPool } from '../db/pool.js';
import {
  applyExperienceTransition,
  appendExperienceVersion,
  createExperience,
  findExperienceById,
  findExperienceByName,
  getExperienceVersion,
  listExperiences,
  listExperienceVersions,
  resolveExperienceRequirements,
  softDeleteExperience,
  updateExperience,
} from '../repository/experience-repo.js';
import { appendAudit } from '../repository/audit-repo.js';
import { publishCatalogEvent } from '../events/publisher.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string): boolean => UUID_RE.test(s);

/** Parse a JSON body, mapping a malformed/empty body to 400 (not an unhandled 500). */
async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HTTPException(400, { message: 'Request body must be valid JSON' });
  }
}

/**
 * Experience catalog routes (AEP Seam F).
 *
 * `GET    /v1/catalogs/:tenant/experiences`
 * `GET    /v1/catalogs/:tenant/experiences/:id`
 * `POST   /v1/catalogs/:tenant/experiences`
 * `PATCH  /v1/catalogs/:tenant/experiences/:id`
 * `POST   /v1/catalogs/:tenant/experiences/:id/transition`   (approval action)
 * `POST   /v1/catalogs/:tenant/experiences/:id/plan`         (direct-requirement dry-run)
 * `DELETE /v1/catalogs/:tenant/experiences/:id`              (soft-delete)
 *
 * RLS + tenant-scope mounted by the bootstrap. Every write appends a
 * `catalog_audit` row inside the same transaction and publishes an SSE event.
 */
export function experiencesRoutes(pool: CatalogPool): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const principal = c.get('principal');
    const query = ExperienceListQuerySchema.parse(
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    const { items, total } = await withTenantScope(pool, principal, (client) =>
      listExperiences(client, query),
    );
    return c.json({
      items: items.map((e) => ExperienceSchema.parse(e)),
      total,
      limit: query.limit,
      offset: query.offset,
    });
  });

  app.get('/:id', async (c) => {
    const principal = c.get('principal');
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HTTPException(404, { message: 'Experience not found' });
    const row = await withTenantScope(pool, principal, (client) => findExperienceById(client, id));
    if (!row) throw new HTTPException(404, { message: 'Experience not found' });
    return c.json(ExperienceSchema.parse(row));
  });

  app.post('/', async (c) => {
    const principal = c.get('principal');
    const requestId = c.get('requestId');
    const tenantId = principal.tenantId;
    const body = ExperienceCreateSchema.parse(await readJson(c));

    const created = await withTenantScope(pool, principal, async (client) => {
      const existing = await findExperienceByName(client, body.name);
      if (existing) throw new HTTPException(409, { message: `Experience "${body.name}" already exists` });
      const row = await createExperience(client, tenantId, body, auditActor(principal));
      await appendAudit(client, {
        tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'create',
        entityType: 'experience',
        entityId: row.id,
        diff: { after: row },
      });
      await appendExperienceVersion(client, tenantId, row.id, row, 'create', auditActor(principal));
      return row;
    });

    publishCatalogEvent({
      tenantId: created.tenantId,
      entityType: 'experience',
      operation: 'create',
      entityId: created.id,
      occurredAt: new Date().toISOString(),
      summary: { name: created.name, approvalState: created.approvalState },
    });
    c.status(201);
    c.header('Location', `${c.req.path}/${created.id}`);
    return c.json(ExperienceSchema.parse(created));
  });

  app.patch('/:id', async (c) => {
    const principal = c.get('principal');
    const requestId = c.get('requestId');
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HTTPException(404, { message: 'Experience not found' });
    const patch = ExperienceUpdateSchema.parse(await readJson(c));

    const updated = await withTenantScope(pool, principal, async (client) => {
      const before = await findExperienceById(client, id);
      if (!before) return null;
      const after = await updateExperience(client, id, patch);
      if (!after) return null;
      await appendAudit(client, {
        tenantId: principal.tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'update',
        entityType: 'experience',
        entityId: id,
        diff: { before, after },
      });
      await appendExperienceVersion(client, principal.tenantId, id, after, 'update', auditActor(principal));
      return after;
    });
    if (!updated) throw new HTTPException(404, { message: 'Experience not found' });
    publishCatalogEvent({
      tenantId: updated.tenantId,
      entityType: 'experience',
      operation: 'update',
      entityId: updated.id,
      occurredAt: new Date().toISOString(),
      summary: { name: updated.name },
    });
    return c.json(ExperienceSchema.parse(updated));
  });

  // Approval transition — submit / approve / reject / deprecate / revoke.
  app.post('/:id/transition', async (c) => {
    const principal = c.get('principal');
    const requestId = c.get('requestId');
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HTTPException(404, { message: 'Experience not found' });
    const { action, comment } = ExperienceTransitionSchema.parse(await readJson(c));

    const updated = await withTenantScope(pool, principal, async (client) => {
      const before = await findExperienceById(client, id);
      if (!before) return null;

      let toState;
      try {
        toState = nextApprovalState(before.approvalState, action);
      } catch (err) {
        if (err instanceof ApprovalTransitionError) {
          throw new HTTPException(409, { message: err.message });
        }
        throw err;
      }

      const event: ApprovalEvent = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        actor: { userId: principal.subject, displayName: principal.displayName },
        action,
        fromState: before.approvalState,
        toState,
        comment,
      };
      const after = await applyExperienceTransition(client, id, before.approvalState, toState, [...before.approvalChain, event]);
      // Zero rows despite a confirmed `before` = a concurrent transition moved
      // the state first (optimistic-concurrency guard). Fail loudly, don't drop.
      if (!after) throw new HTTPException(409, { message: 'Experience was modified concurrently; retry the transition.' });
      await appendAudit(client, {
        tenantId: principal.tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'update',
        entityType: 'experience',
        entityId: id,
        diff: { before: { approvalState: before.approvalState }, after: { approvalState: after.approvalState }, action },
      });
      await appendExperienceVersion(client, principal.tenantId, id, after, `transition:${action}`, auditActor(principal));
      return after;
    });
    if (!updated) throw new HTTPException(404, { message: 'Experience not found' });
    publishCatalogEvent({
      tenantId: updated.tenantId,
      entityType: 'experience',
      operation: 'update',
      entityId: updated.id,
      occurredAt: new Date().toISOString(),
      summary: { name: updated.name, approvalState: updated.approvalState },
    });
    return c.json(ExperienceSchema.parse(updated));
  });

  // Version history — immutable snapshots appended on every create/update/
  // transition (change management, ADR gap A4).
  app.get('/:id/versions', async (c) => {
    const principal = c.get('principal');
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HTTPException(404, { message: 'Experience not found' });
    const versions = await withTenantScope(pool, principal, async (client) => {
      const exists = await findExperienceById(client, id);
      if (!exists) return null;
      return listExperienceVersions(client, id);
    });
    if (versions === null) throw new HTTPException(404, { message: 'Experience not found' });
    return c.json({ items: versions });
  });

  // Roll an experience's content back to a prior version. This is itself an
  // update — it re-applies the snapshot and records a NEW version, so history
  // stays append-only. Approval state is workflow-managed and NOT rolled back.
  app.post('/:id/rollback/:versionNo', async (c) => {
    const principal = c.get('principal');
    const requestId = c.get('requestId');
    const id = c.req.param('id');
    const versionNo = Number(c.req.param('versionNo'));
    if (!isUuid(id)) throw new HTTPException(404, { message: 'Experience not found' });
    if (!Number.isInteger(versionNo) || versionNo < 1) throw new HTTPException(400, { message: 'versionNo must be a positive integer' });

    const restored = await withTenantScope(pool, principal, async (client) => {
      const current = await findExperienceById(client, id);
      if (!current) return null;
      const version = await getExperienceVersion(client, id, versionNo);
      if (!version) throw new HTTPException(404, { message: `Version ${versionNo} not found` });
      const s = version.snapshot as { title?: string; goal?: string; body?: unknown; tags?: string[]; owner?: string | null; version?: string | null };
      const after = await updateExperience(client, id, {
        title: s.title, goal: s.goal, body: s.body as never,
        tags: s.tags, owner: s.owner ?? null, version: s.version ?? null,
      });
      if (!after) return null;
      await appendAudit(client, {
        tenantId: principal.tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'update',
        entityType: 'experience',
        entityId: id,
        diff: { rollbackTo: versionNo, before: { title: current.title, goal: current.goal }, after: { title: after.title, goal: after.goal } },
      });
      await appendExperienceVersion(client, principal.tenantId, id, after, `rollback:v${versionNo}`, auditActor(principal));
      return after;
    });
    if (!restored) throw new HTTPException(404, { message: 'Experience not found' });
    publishCatalogEvent({
      tenantId: restored.tenantId, entityType: 'experience', operation: 'update',
      entityId: restored.id, occurredAt: new Date().toISOString(),
      summary: { name: restored.name, rolledBackTo: versionNo },
    });
    return c.json(ExperienceSchema.parse(restored));
  });

  // Server-side plan dry-run: resolve the experience's DIRECT requirements
  // against the tenant catalog. Full transitive graph planning is the
  // runtime ExperiencePlanner's job (projects/agentic-ui/src/lib/experience).
  app.post('/:id/plan', async (c) => {
    const principal = c.get('principal');
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HTTPException(404, { message: 'Experience not found' });

    const result = await withTenantScope(pool, principal, async (client) => {
      const experience = await findExperienceById(client, id);
      // Don't plan a tombstone — a soft-deleted experience is gone for planning.
      if (!experience || experience.softDeletedAt !== null) return null;
      const resolution = await resolveExperienceRequirements(client, experience);
      return { experience, resolution };
    });
    if (!result) throw new HTTPException(404, { message: 'Experience not found' });

    return c.json({
      id: result.experience.id,
      experienceId: result.experience.name,   // the runtime plan keys on name
      name: result.experience.name,
      goal: result.experience.goal,
      approvalState: result.experience.approvalState,
      matched: result.resolution.matched,
      unmet: result.resolution.unmet,
      complete: result.resolution.unmet.length === 0,
    });
  });

  app.delete('/:id', async (c) => {
    const principal = c.get('principal');
    const requestId = c.get('requestId');
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HTTPException(404, { message: 'Experience not found' });

    const deleted = await withTenantScope(pool, principal, async (client) => {
      const before = await findExperienceById(client, id);
      if (!before || before.softDeletedAt !== null) return null;
      const after = await softDeleteExperience(client, id);
      if (!after) return null;
      await appendAudit(client, {
        tenantId: principal.tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'delete',
        entityType: 'experience',
        entityId: id,
        diff: { before, after },
      });
      return after;
    });
    if (!deleted) throw new HTTPException(404, { message: 'Experience not found' });
    publishCatalogEvent({
      tenantId: deleted.tenantId,
      entityType: 'experience',
      operation: 'delete',
      entityId: deleted.id,
      occurredAt: new Date().toISOString(),
    });
    c.status(204);
    return c.body(null);
  });

  return app;
}
