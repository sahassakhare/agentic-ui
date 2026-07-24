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
  createExperience,
  findExperienceById,
  findExperienceByName,
  listExperiences,
  resolveExperienceRequirements,
  softDeleteExperience,
  updateExperience,
} from '../repository/experience-repo.js';
import { appendAudit } from '../repository/audit-repo.js';
import { publishCatalogEvent } from '../events/publisher.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string): boolean => UUID_RE.test(s);

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
    const body = ExperienceCreateSchema.parse(await c.req.json());

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
    const patch = ExperienceUpdateSchema.parse(await c.req.json());

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
    const { action, comment } = ExperienceTransitionSchema.parse(await c.req.json());

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
      const after = await applyExperienceTransition(client, id, toState, [...before.approvalChain, event]);
      if (!after) return null;
      await appendAudit(client, {
        tenantId: principal.tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'update',
        entityType: 'experience',
        entityId: id,
        diff: { before: { approvalState: before.approvalState }, after: { approvalState: after.approvalState }, action },
      });
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

  // Server-side plan dry-run: resolve the experience's DIRECT requirements
  // against the tenant catalog. Full transitive graph planning is the
  // runtime ExperiencePlanner's job (projects/agentic-ui/src/lib/experience).
  app.post('/:id/plan', async (c) => {
    const principal = c.get('principal');
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HTTPException(404, { message: 'Experience not found' });

    const result = await withTenantScope(pool, principal, async (client) => {
      const experience = await findExperienceById(client, id);
      if (!experience) return null;
      const resolution = await resolveExperienceRequirements(client, experience);
      return { experience, resolution };
    });
    if (!result) throw new HTTPException(404, { message: 'Experience not found' });

    return c.json({
      experienceId: result.experience.name,
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
