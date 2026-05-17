import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  AgentCreateSchema,
  AgentHeartbeatSchema,
  AgentSchema,
  AgentUpdateSchema,
} from '../domain/agent.js';
import { auditActor } from '../domain/principal.js';
import { withTenantScope, type CatalogPool } from '../db/pool.js';
import {
  createAgent,
  findAgentById,
  findAgentByName,
  listAgents,
  recordAgentHeartbeat,
  softDeleteAgent,
  updateAgent,
} from '../repository/agent-repo.js';
import { appendAudit } from '../repository/audit-repo.js';
import { publishCatalogEvent } from '../events/publisher.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string): boolean => UUID_RE.test(s);

/**
 * `GET    /v1/catalogs/:tenant/agents`
 * `GET    /v1/catalogs/:tenant/agents/:id`
 * `POST   /v1/catalogs/:tenant/agents`
 * `PATCH  /v1/catalogs/:tenant/agents/:id`
 * `POST   /v1/catalogs/:tenant/agents/:id/heartbeat`
 * `DELETE /v1/catalogs/:tenant/agents/:id`
 *
 * Slice AGT — ADR-039.
 * RLS + tenant-scope mounted by the bootstrap. Heartbeat skips
 * audit (too frequent). All other writes append a `catalog_audit`
 * row inside the same transaction.
 */
export function agentsRoutes(pool: CatalogPool): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const principal = c.get('principal');
    const items = await withTenantScope(pool, principal, (client) => listAgents(client));
    return c.json({ items: items.map((a) => AgentSchema.parse(a)) });
  });

  app.get('/:id', async (c) => {
    const principal = c.get('principal');
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HTTPException(404, { message: 'Agent not found' });
    const row = await withTenantScope(pool, principal, (client) => findAgentById(client, id));
    if (!row) throw new HTTPException(404, { message: 'Agent not found' });
    return c.json(AgentSchema.parse(row));
  });

  app.post('/', async (c) => {
    const principal = c.get('principal');
    const requestId = c.get('requestId');
    const tenantId = principal.tenantId;
    const body = AgentCreateSchema.parse(await c.req.json());

    const created = await withTenantScope(pool, principal, async (client) => {
      // Idempotent registrar pattern (mirrors capabilities + tenants):
      // pre-check for the name and return 409 instead of letting the
      // unique-violation propagate as 500. Lets the server-registrar
      // package treat 409 as "already registered, success" on
      // re-deploy.
      const existing = await findAgentByName(client, body.name);
      if (existing) {
        throw new HTTPException(409, {
          message: `Agent "${body.name}" already exists`,
        });
      }
      const row = await createAgent(client, tenantId, body, auditActor(principal));
      await appendAudit(client, {
        tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'create',
        entityType: 'agent',
        entityId: row.id,
        diff: { after: row },
      });
      return row;
    });

    publishCatalogEvent({
      tenantId: created.tenantId,
      entityType: 'agent',
      operation: 'create',
      entityId: created.id,
      occurredAt: new Date().toISOString(),
      summary: { name: created.name, kind: created.kind },
    });
    c.status(201);
    c.header('Location', `${c.req.path}/${created.id}`);
    return c.json(AgentSchema.parse(created));
  });

  app.patch('/:id', async (c) => {
    const principal = c.get('principal');
    const requestId = c.get('requestId');
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HTTPException(404, { message: 'Agent not found' });
    const patch = AgentUpdateSchema.parse(await c.req.json());

    const updated = await withTenantScope(pool, principal, async (client) => {
      const before = await findAgentById(client, id);
      if (!before) return null;
      const after = await updateAgent(client, id, patch);
      if (!after) return null;
      await appendAudit(client, {
        tenantId: principal.tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'update',
        entityType: 'agent',
        entityId: id,
        diff: { before, after },
      });
      return after;
    });
    if (!updated) throw new HTTPException(404, { message: 'Agent not found' });
    publishCatalogEvent({
      tenantId: updated.tenantId,
      entityType: 'agent',
      operation: 'update',
      entityId: updated.id,
      occurredAt: new Date().toISOString(),
      summary: { status: updated.status },
    });
    return c.json(AgentSchema.parse(updated));
  });

  // Heartbeat: lightweight ping. Skips audit (too frequent) but
  // still publishes the SSE event so live consumers (topology graph)
  // see status changes immediately.
  app.post('/:id/heartbeat', async (c) => {
    const principal = c.get('principal');
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HTTPException(404, { message: 'Agent not found' });
    const body = AgentHeartbeatSchema.parse(await c.req.json().catch(() => ({})));

    const updated = await withTenantScope(pool, principal, (client) =>
      recordAgentHeartbeat(client, id, body.status),
    );
    if (!updated) throw new HTTPException(404, { message: 'Agent not found' });
    publishCatalogEvent({
      tenantId: updated.tenantId,
      entityType: 'agent',
      operation: 'update',
      entityId: updated.id,
      occurredAt: new Date().toISOString(),
      summary: { heartbeat: true, status: updated.status },
    });
    return c.json(AgentSchema.parse(updated));
  });

  app.delete('/:id', async (c) => {
    const principal = c.get('principal');
    const requestId = c.get('requestId');
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HTTPException(404, { message: 'Agent not found' });

    const deleted = await withTenantScope(pool, principal, async (client) => {
      const before = await findAgentById(client, id);
      if (!before || before.softDeletedAt !== null) return null;
      const after = await softDeleteAgent(client, id);
      if (!after) return null;
      await appendAudit(client, {
        tenantId: principal.tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'delete',
        entityType: 'agent',
        entityId: id,
        diff: { before, after },
      });
      return after;
    });
    if (!deleted) throw new HTTPException(404, { message: 'Agent not found' });
    publishCatalogEvent({
      tenantId: deleted.tenantId,
      entityType: 'agent',
      operation: 'delete',
      entityId: deleted.id,
      occurredAt: new Date().toISOString(),
    });
    c.status(204);
    return c.body(null);
  });

  return app;
}
