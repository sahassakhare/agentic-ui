import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  TenantSchema,
  TenantCreateSchema,
  TenantUpdateSchema,
  TenantSuspendSchema,
} from '../domain/tenant.js';
import { auditActor, isPlatformAdmin, type Principal } from '../domain/principal.js';
import { withPlatformScope, type CatalogPool } from '../db/pool.js';
import {
  activateTenant,
  createTenant,
  findTenantById,
  listTenants,
  softDeleteTenant,
  suspendTenant,
  updateTenant,
} from '../repository/tenant-repo.js';
import { appendAudit } from '../repository/audit-repo.js';
import { catalogBus } from '../events/catalog-bus.js';

/**
 * `GET    /v1/tenants`               (platform-admin only)
 * `POST   /v1/tenants`               (platform-admin only)
 * `GET    /v1/tenants/:id`           (platform-admin only)
 * `PATCH  /v1/tenants/:id`           (platform-admin only) — display, quotas
 * `POST   /v1/tenants/:id/suspend`   (platform-admin only)
 * `POST   /v1/tenants/:id/activate`  (platform-admin only)
 * `DELETE /v1/tenants/:id`           (platform-admin only) — soft-delete
 *
 * All mutations append a row to `catalog_audit` scoped to the
 * affected tenant (the audit table is RLS-isolated; we set
 * `app.tenant_id` to the target tenant id for the audit write). See
 * ADR-020.
 *
 * Tenant *id* is immutable once minted — operators rename via
 * clone-and-deprecate, not in-place rename. `status` transitions go
 * through dedicated `/suspend` + `/activate` endpoints so the
 * lifecycle audit captures actor + reason explicitly.
 */
function ensurePlatformAdmin(principal: Principal): void {
  if (!isPlatformAdmin(principal)) {
    throw new HTTPException(403, {
      message: 'Tenant lifecycle endpoints require the platform-admin role',
    });
  }
}

async function auditTenantMutation(
  client: import('pg').PoolClient,
  args: {
    actor: string;
    requestId: string | null;
    operation: 'create' | 'update' | 'delete' | 'restore';
    tenantId: string;
    diff: Record<string, unknown>;
  },
): Promise<void> {
  // Audit rows are RLS-scoped — set the GUC to the target tenant
  // for the write so the policy admits the row.
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [args.tenantId]);
  await appendAudit(client, {
    tenantId: args.tenantId,
    actor: args.actor,
    requestId: args.requestId,
    operation: args.operation,
    entityType: 'tenant',
    entityId: args.tenantId,
    diff: args.diff,
  });
  // Reset so subsequent SQL in the same transaction doesn't carry
  // the wrong scope into another tenant's view.
  await client.query("SELECT set_config('app.tenant_id', '', true)");

  // Push a real-time event to any SSE subscribers of this tenant
  // (ADR-027). Keep the payload minimal — clients use it as a hint
  // to re-fetch, not as a source of truth.
  catalogBus.emit({
    tenantId: args.tenantId,
    entityType: 'tenant',
    operation: args.operation,
    entityId: args.tenantId,
    occurredAt: new Date().toISOString(),
  });
}

export function tenantsRoutes(pool: CatalogPool): Hono {
  const app = new Hono();

  // ── LIST ────────────────────────────────────────────────────────
  app.get('/', async (c) => {
    ensurePlatformAdmin(c.get('principal'));
    const includeDeleted = c.req.query('includeDeleted') === 'true';
    const items = await withPlatformScope(pool, (client) =>
      listTenants(client, { includeDeleted }),
    );
    return c.json({ items: items.map((row) => TenantSchema.parse(row)) });
  });

  // ── READ ONE ────────────────────────────────────────────────────
  app.get('/:id', async (c) => {
    ensurePlatformAdmin(c.get('principal'));
    const id = c.req.param('id');
    const row = await withPlatformScope(pool, (client) => findTenantById(client, id));
    if (!row) throw new HTTPException(404, { message: 'Tenant not found' });
    return c.json(TenantSchema.parse(row));
  });

  // ── CREATE ──────────────────────────────────────────────────────
  app.post('/', async (c) => {
    ensurePlatformAdmin(c.get('principal'));
    const principal = c.get('principal');
    const requestId = c.get('requestId') ?? null;
    const body = TenantCreateSchema.parse(await c.req.json());

    const created = await withPlatformScope(pool, async (client) => {
      // Pre-check duplicate to give a 409 instead of 500 on the
      // unique-violation. Cheaper than swallowing the error from
      // the INSERT.
      const existing = await findTenantById(client, body.id);
      if (existing) {
        throw new HTTPException(409, {
          message: `Tenant "${body.id}" already exists`,
        });
      }
      const row = await createTenant(client, body, auditActor(principal));
      await auditTenantMutation(client, {
        actor: auditActor(principal),
        requestId,
        operation: 'create',
        tenantId: row.id,
        diff: { after: row },
      });
      return row;
    });

    c.status(201);
    c.header('Location', `${c.req.path}/${created.id}`);
    return c.json(TenantSchema.parse(created));
  });

  // ── UPDATE (display + quotas) ───────────────────────────────────
  app.patch('/:id', async (c) => {
    ensurePlatformAdmin(c.get('principal'));
    const principal = c.get('principal');
    const requestId = c.get('requestId') ?? null;
    const id = c.req.param('id');
    const patch = TenantUpdateSchema.parse(await c.req.json());

    const updated = await withPlatformScope(pool, async (client) => {
      const before = await findTenantById(client, id);
      if (!before) return null;
      const after = await updateTenant(client, id, patch);
      if (!after) return null;
      await auditTenantMutation(client, {
        actor: auditActor(principal),
        requestId,
        operation: 'update',
        tenantId: id,
        diff: { before, after },
      });
      return after;
    });

    if (!updated) throw new HTTPException(404, { message: 'Tenant not found' });
    return c.json(TenantSchema.parse(updated));
  });

  // ── SUSPEND ─────────────────────────────────────────────────────
  app.post('/:id/suspend', async (c) => {
    ensurePlatformAdmin(c.get('principal'));
    const principal = c.get('principal');
    const requestId = c.get('requestId') ?? null;
    const id = c.req.param('id');
    const body = TenantSuspendSchema.parse(await c.req.json());

    const updated = await withPlatformScope(pool, async (client) => {
      const before = await findTenantById(client, id);
      if (!before) return null;
      const after = await suspendTenant(client, id, auditActor(principal), body.reason);
      if (!after) return null;
      await auditTenantMutation(client, {
        actor: auditActor(principal),
        requestId,
        operation: 'update',
        tenantId: id,
        diff: { before, after, reason: body.reason },
      });
      return after;
    });

    if (!updated) throw new HTTPException(404, { message: 'Tenant not found' });
    return c.json(TenantSchema.parse(updated));
  });

  // ── ACTIVATE ────────────────────────────────────────────────────
  app.post('/:id/activate', async (c) => {
    ensurePlatformAdmin(c.get('principal'));
    const principal = c.get('principal');
    const requestId = c.get('requestId') ?? null;
    const id = c.req.param('id');

    const updated = await withPlatformScope(pool, async (client) => {
      const before = await findTenantById(client, id);
      if (!before) return null;
      const after = await activateTenant(client, id);
      if (!after) return null;
      await auditTenantMutation(client, {
        actor: auditActor(principal),
        requestId,
        operation: 'restore',
        tenantId: id,
        diff: { before, after },
      });
      return after;
    });

    if (!updated) throw new HTTPException(404, { message: 'Tenant not found' });
    return c.json(TenantSchema.parse(updated));
  });

  // ── DELETE (soft) ───────────────────────────────────────────────
  app.delete('/:id', async (c) => {
    ensurePlatformAdmin(c.get('principal'));
    const principal = c.get('principal');
    const requestId = c.get('requestId') ?? null;
    const id = c.req.param('id');

    const ok = await withPlatformScope(pool, async (client) => {
      const before = await findTenantById(client, id);
      if (!before) return false;
      const after = await softDeleteTenant(client, id);
      if (!after) return false;
      await auditTenantMutation(client, {
        actor: auditActor(principal),
        requestId,
        operation: 'delete',
        tenantId: id,
        diff: { before, after },
      });
      return true;
    });

    if (!ok) throw new HTTPException(404, { message: 'Tenant not found' });
    c.status(204);
    return c.body(null);
  });

  return app;
}
