import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  MfeRemoteCreateSchema,
  MfeRemoteSchema,
  MfeRemoteUpdateSchema,
} from '../domain/mfe.js';
import { auditActor } from '../domain/principal.js';
import { withTenantScope, type CatalogPool } from '../db/pool.js';
import {
  createMfeRemote,
  deleteMfeRemote,
  findMfeByName,
  listMfeRemotes,
  recordHealth,
  updateMfeRemote,
} from '../repository/mfe-repo.js';
import { appendAudit } from '../repository/audit-repo.js';
import { publishCatalogEvent } from '../events/publisher.js';
import { z } from 'zod';

const HealthRecordSchema = z.object({
  status: z.enum(['active', 'inactive', 'degraded']),
});

export function mfesRoutes(pool: CatalogPool): Hono {
  const app = new Hono();

  // List federation manifest entries.
  app.get('/', async (c) => {
    const principal = c.get('principal');
    const items = await withTenantScope(pool, principal, listMfeRemotes);
    return c.json({ items: items.map((row) => MfeRemoteSchema.parse(row)) });
  });

  // Get one by name.
  app.get('/:name', async (c) => {
    const principal = c.get('principal');
    const name = c.req.param('name');
    const row = await withTenantScope(pool, principal, (client) =>
      findMfeByName(client, name),
    );
    if (!row) throw new HTTPException(404, { message: 'MFE remote not found' });
    return c.json(MfeRemoteSchema.parse(row));
  });

  // Create.
  app.post('/', async (c) => {
    const principal = c.get('principal');
    const requestId = c.get('requestId');
    const body = MfeRemoteCreateSchema.parse(await c.req.json());

    const created = await withTenantScope(pool, principal, async (client) => {
      const row = await createMfeRemote(client, principal.tenantId, body);
      await appendAudit(client, {
        tenantId: principal.tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'create',
        entityType: 'mfe',
        entityId: row.name,
        diff: { after: row },
      });
      return row;
    });

    publishCatalogEvent({
      tenantId: created.tenantId,
      entityType: 'mfe',
      operation: 'create',
      entityId: created.name,
      occurredAt: new Date().toISOString(),
    });
    c.status(201);
    c.header('Location', `${c.req.path}/${created.name}`);
    return c.json(MfeRemoteSchema.parse(created));
  });

  // Update.
  app.patch('/:name', async (c) => {
    const principal = c.get('principal');
    const requestId = c.get('requestId');
    const name = c.req.param('name');
    const patch = MfeRemoteUpdateSchema.parse(await c.req.json());

    const updated = await withTenantScope(pool, principal, async (client) => {
      const before = await findMfeByName(client, name);
      if (!before) return null;
      const after = await updateMfeRemote(client, name, patch);
      if (!after) return null;
      await appendAudit(client, {
        tenantId: principal.tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'update',
        entityType: 'mfe',
        entityId: name,
        diff: { before, after },
      });
      return after;
    });

    if (!updated) throw new HTTPException(404, { message: 'MFE remote not found' });
    publishCatalogEvent({
      tenantId: updated.tenantId,
      entityType: 'mfe',
      operation: 'update',
      entityId: updated.name,
      occurredAt: new Date().toISOString(),
    });
    return c.json(MfeRemoteSchema.parse(updated));
  });

  // Delete (hard delete — federation manifest entries don't carry
  // historical value the way capabilities do; a deleted remote is
  // simply unreachable, the audit row records the fact).
  app.delete('/:name', async (c) => {
    const principal = c.get('principal');
    const requestId = c.get('requestId');
    const name = c.req.param('name');

    const ok = await withTenantScope(pool, principal, async (client) => {
      const before = await findMfeByName(client, name);
      if (!before) return false;
      const deleted = await deleteMfeRemote(client, name);
      if (!deleted) return false;
      await appendAudit(client, {
        tenantId: principal.tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'delete',
        entityType: 'mfe',
        entityId: name,
        diff: { before },
      });
      return true;
    });

    if (!ok) throw new HTTPException(404, { message: 'MFE remote not found' });
    publishCatalogEvent({
      tenantId: principal.tenantId,
      entityType: 'mfe',
      operation: 'delete',
      entityId: name,
      occurredAt: new Date().toISOString(),
    });
    c.status(204);
    return c.body(null);
  });

  // Record a health probe result. Internal-callers (cron / k8s probe
  // / external monitor) hit this with a service-account JWT.
  app.post('/:name/health', async (c) => {
    const principal = c.get('principal');
    const name = c.req.param('name');
    const body = HealthRecordSchema.parse(await c.req.json());

    await withTenantScope(pool, principal, async (client) => {
      const existing = await findMfeByName(client, name);
      if (!existing) throw new HTTPException(404, { message: 'MFE remote not found' });
      await recordHealth(client, name, body.status);
    });

    c.status(204);
    return c.body(null);
  });

  return app;
}
