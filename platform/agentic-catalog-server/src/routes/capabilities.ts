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
  findCapabilityByName,
  listCapabilities,
  searchCapabilitiesByEmbedding,
  softDeleteCapability,
  updateCapability,
  updateCapabilityEmbedding,
} from '../repository/capability-repo.js';
import { appendAudit } from '../repository/audit-repo.js';
import { publishCatalogEvent } from '../events/publisher.js';
import {
  buildEmbeddingText,
  type EmbeddingProvider,
} from '../embeddings/provider.js';

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
export function capabilitiesRoutes(
  pool: CatalogPool,
  embeddings?: EmbeddingProvider,
): Hono {
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

  // ── SEARCH (semantic — slice SEM-A / ADR-038) ───────────────────
  // GET /v1/catalogs/{tenant}/capabilities/search?q=<query>&kind=<k>&topK=20
  // Returns capabilities ranked by cosine similarity of their stored
  // embedding to the query embedding. When no embedding provider is
  // configured (EMBEDDING_PROVIDER=noop, the default), returns 422
  // problem+json so adopters know to flip the env var. Note: this
  // route MUST come before `/:id` so the literal path doesn't match
  // the UUID matcher.
  app.get('/search', async (c) => {
    // Input validation runs first so client errors take precedence
    // over server-config errors: callers get actionable 422s on bad
    // q/topK regardless of whether semantic search is wired.
    const q = c.req.query('q')?.trim();
    if (!q) {
      throw new HTTPException(422, { message: '`q` query parameter is required' });
    }
    const kind = c.req.query('kind') ?? undefined;
    const topKRaw = c.req.query('topK');
    const topK = topKRaw ? Number.parseInt(topKRaw, 10) : 20;
    if (Number.isNaN(topK) || topK < 1 || topK > 100) {
      throw new HTTPException(422, { message: '`topK` must be an integer between 1 and 100' });
    }
    if (!embeddings?.enabled) {
      throw new HTTPException(422, {
        message: 'Semantic search is not configured. Set EMBEDDING_PROVIDER=openai|cohere|ollama (with the matching API key) and re-deploy. See ADR-038.',
      });
    }

    const queryEmbedding = await embeddings.embed(q);
    if (!queryEmbedding) {
      throw new HTTPException(503, {
        message: 'Embedding provider unreachable; semantic search temporarily unavailable. Falling back to ?q= keyword filter is the suggested workaround.',
      });
    }

    const principal = c.get('principal');
    const hits = await withTenantScope(pool, principal, (client) =>
      searchCapabilitiesByEmbedding(client, { embedding: queryEmbedding, kind, topK }),
    );
    return c.json({
      items: hits.map((h) => ({
        ...CapabilitySchema.parse(h.capability),
        _score: h.score,
      })),
      query: q,
      kind: kind ?? null,
      topK,
      provider: embeddings.name,
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

    // Compute the embedding BEFORE we open the transaction so a slow
    // upstream embedding API doesn't hold the DB connection. The
    // provider returns null on `noop` mode and on errors; null
    // embeddings are stored as NULL and the row is searchable only
    // by the keyword filter until the backfill CLI runs.
    let embedding: readonly number[] | null = null;
    if (embeddings?.enabled) {
      embedding = await embeddings.embed(buildEmbeddingText({
        kind: body.kind,
        name: body.name,
        tags: body.tags,
        body: body.body,
      }));
    }

    const created = await withTenantScope(pool, principal, async (client) => {
      // Pre-check duplicate (tenant, kind, name) — surface 409 instead
      // of letting the unique-violation propagate as a 500. Matches
      // tenants.ts pattern. Important for idempotent registrars (the
      // runtime's provideCatalogCapabilityRegistrar treats 409 as
      // "already exists, success").
      const existing = await findCapabilityByName(client, body.kind, body.name);
      if (existing) {
        throw new HTTPException(409, {
          message: `Capability "${body.kind}/${body.name}" already exists`,
        });
      }
      const row = await createCapability(
        client,
        tenantId,
        body,
        auditActor(principal),
        embedding,
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
