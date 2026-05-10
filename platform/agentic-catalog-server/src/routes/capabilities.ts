import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  CapabilityCreateSchema,
  CapabilityListQuerySchema,
  CapabilitySchema,
  CapabilityUpdateSchema,
} from '../domain/capability.js';
import { auditActor } from '../domain/principal.js';
import { withTenantScope, type CatalogPool } from '../db/pool.js';
import {
  createCapability,
  findCapabilityById,
  listCapabilities,
  softDeleteCapability,
  updateCapability,
} from '../repository/capability-repo.js';
import { appendAudit } from '../repository/audit-repo.js';
import { publishCatalogEvent } from '../events/publisher.js';

/**
 * `GET    /v1/catalogs/:tenant/capabilities`
 * `GET    /v1/catalogs/:tenant/capabilities/:id`
 * `POST   /v1/catalogs/:tenant/capabilities`
 * `PATCH  /v1/catalogs/:tenant/capabilities/:id`
 * `DELETE /v1/catalogs/:tenant/capabilities/:id`
 *
 * Every route requires bearer-auth + tenant scope (mounted by the
 * server bootstrap). RLS in the DB layer is the second gate; the
 * tenant param check above is the first.
 *
 * All write paths append a `catalog_audit` row inside the same
 * transaction as the data write — atomic by construction.
 */
export function capabilitiesRoutes(pool: CatalogPool): Hono {
  const app = new Hono();

  // ── LIST ────────────────────────────────────────────────────────
  app.get('/', async (c) => {
    const principal = c.get('principal');
    const query = CapabilityListQuerySchema.parse(c.req.query());

    const result = await withTenantScope(pool, principal, (client) =>
      listCapabilities(client, query),
    );

    return c.json({
      items: result.items.map((row) => CapabilitySchema.parse(row)),
      total: result.total,
      limit: query.limit,
      offset: query.offset,
    });
  });

  // ── READ ONE ────────────────────────────────────────────────────
  app.get('/:id', async (c) => {
    const principal = c.get('principal');
    const id = c.req.param('id');
    if (!isUuid(id)) {
      throw new HTTPException(404, { message: 'Capability not found' });
    }
    const row = await withTenantScope(pool, principal, (client) =>
      findCapabilityById(client, id),
    );
    if (!row) throw new HTTPException(404, { message: 'Capability not found' });
    return c.json(CapabilitySchema.parse(row));
  });

  // ── CREATE ──────────────────────────────────────────────────────
  app.post('/', async (c) => {
    const principal = c.get('principal');
    const requestId = c.get('requestId');
    const tenantId = principal.tenantId;
    const body = CapabilityCreateSchema.parse(await c.req.json());

    const created = await withTenantScope(pool, principal, async (client) => {
      const row = await createCapability(
        client,
        tenantId,
        body,
        auditActor(principal),
      );
      await appendAudit(client, {
        tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'create',
        entityType: 'capability',
        entityId: row.id,
        diff: { after: row },
      });
      return row;
    });

    publishCatalogEvent({
      tenantId: created.tenantId,
      entityType: 'capability',
      operation: 'create',
      entityId: created.id,
      occurredAt: new Date().toISOString(),
      summary: { kind: created.kind, name: created.name },
    });
    c.status(201);
    c.header('Location', `${c.req.path}/${created.id}`);
    return c.json(CapabilitySchema.parse(created));
  });

  // ── UPDATE ──────────────────────────────────────────────────────
  app.patch('/:id', async (c) => {
    const principal = c.get('principal');
    const requestId = c.get('requestId');
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HTTPException(404, { message: 'Capability not found' });
    const patch = CapabilityUpdateSchema.parse(await c.req.json());

    const updated = await withTenantScope(pool, principal, async (client) => {
      const before = await findCapabilityById(client, id);
      if (!before) return null;
      const after = await updateCapability(client, id, patch);
      if (!after) return null;
      await appendAudit(client, {
        tenantId: principal.tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'update',
        entityType: 'capability',
        entityId: id,
        diff: { before, after },
      });
      return after;
    });

    if (!updated) throw new HTTPException(404, { message: 'Capability not found' });
    publishCatalogEvent({
      tenantId: updated.tenantId,
      entityType: 'capability',
      operation: 'update',
      entityId: updated.id,
      occurredAt: new Date().toISOString(),
      summary: { lifecycle: updated.lifecycle },
    });
    return c.json(CapabilitySchema.parse(updated));
  });

  // ── SOFT-DELETE ─────────────────────────────────────────────────
  app.delete('/:id', async (c) => {
    const principal = c.get('principal');
    const requestId = c.get('requestId');
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HTTPException(404, { message: 'Capability not found' });

    const deleted = await withTenantScope(pool, principal, async (client) => {
      const before = await findCapabilityById(client, id);
      if (!before || before.softDeletedAt !== null) return null;
      const after = await softDeleteCapability(client, id);
      if (!after) return null;
      await appendAudit(client, {
        tenantId: principal.tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'delete',
        entityType: 'capability',
        entityId: id,
        diff: { before, after },
      });
      return after;
    });

    if (!deleted) throw new HTTPException(404, { message: 'Capability not found' });
    publishCatalogEvent({
      tenantId: deleted.tenantId,
      entityType: 'capability',
      operation: 'delete',
      entityId: deleted.id,
      occurredAt: new Date().toISOString(),
    });
    c.status(204);
    return c.body(null);
  });

  return app;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}
