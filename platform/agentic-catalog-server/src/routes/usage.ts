import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  UsageEventCreateSchema,
  UsageEventSchema,
  UsageQuerySchema,
  UsageAggregateSchema,
} from '../domain/usage.js';
import { withTenantScope, type CatalogPool } from '../db/pool.js';
import {
  aggregateUsage,
  appendUsage,
  listRecentUsage,
} from '../repository/usage-repo.js';
import { publishCatalogEvent } from '../events/publisher.js';

/**
 * `POST /v1/catalogs/:tenant/usage` — append a usage event.
 *   Idempotent when `idempotencyKey` is supplied.
 *
 * `GET  /v1/catalogs/:tenant/usage` — aggregate over `?from&to&kind`.
 *   Returns `{from, to, byKind, totalEvents, totalQuantity}`.
 *
 * `GET  /v1/catalogs/:tenant/usage/recent` — recent N events for the
 *   ops console / debugging.
 *
 * Pricing is intentionally NOT computed here — the catalog stores
 * units, hosts compute currency. See ADR-018 §D2.
 */
export function usageRoutes(pool: CatalogPool): Hono {
  const app = new Hono();

  app.post('/', async (c) => {
    const principal = c.get('principal');
    const body = UsageEventCreateSchema.parse(await c.req.json());
    const event = await withTenantScope(pool, principal, (client) =>
      appendUsage(client, principal.tenantId, body),
    );
    publishCatalogEvent({
      tenantId: event.tenantId,
      entityType: 'usage',
      operation: 'create',
      entityId: event.id,
      occurredAt: event.occurredAt,
      summary: { kind: event.kind, quantity: event.quantity },
    });
    c.status(201);
    return c.json(UsageEventSchema.parse(event));
  });

  app.get('/', async (c) => {
    const principal = c.get('principal');
    const parsed = UsageQuerySchema.safeParse({
      from: c.req.query('from'),
      to: c.req.query('to'),
      kind: c.req.query('kind'),
    });
    if (!parsed.success) {
      throw new HTTPException(422, { message: 'Invalid query parameters', cause: parsed.error });
    }
    const result = await withTenantScope(pool, principal, (client) =>
      aggregateUsage(client, principal.tenantId, parsed.data),
    );
    return c.json(UsageAggregateSchema.parse(result));
  });

  app.get('/recent', async (c) => {
    const principal = c.get('principal');
    const limitParam = c.req.query('limit');
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 100;
    if (Number.isNaN(limit) || limit < 1 || limit > 1000) {
      throw new HTTPException(422, { message: '`limit` must be an integer between 1 and 1000' });
    }
    const events = await withTenantScope(pool, principal, (client) =>
      listRecentUsage(client, principal.tenantId, limit),
    );
    return c.json({ items: events.map((e) => UsageEventSchema.parse(e)) });
  });

  return app;
}
