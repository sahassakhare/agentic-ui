import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { withTenantScope, type CatalogPool } from '../db/pool.js';
import {
  listAuditRowsForExport,
  listRecentAuditRows,
  verifyAuditChain,
  type AuditRow,
} from '../repository/audit-repo.js';

/**
 * `GET /v1/catalogs/:tenant/audit/export` — JSONL stream of audit
 *   rows for the tenant. Optional `?from=ISO&to=ISO&limit=N` query
 *   params. Defaults to the most recent 10 000 rows (server-side
 *   bound at 100 000). Stable, line-delimited, parseable by
 *   downstream SIEMs (Splunk, Datadog, ELK).
 *
 * `GET /v1/catalogs/:tenant/audit/verify` — re-walk the chain and
 *   return integrity status. Useful for periodic ops checks; also
 *   the foundation of an alerting hook ("audit chain broke at
 *   position N — investigate"). Reads only; no mutations.
 *
 * Both routes are RLS-isolated per tenant. Cross-tenant export
 * requires the platform-admin role (BYPASSRLS) — same as every
 * other catalog read.
 */

const ExportQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100_000).optional(),
});

const RecentQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export function auditRoutes(pool: CatalogPool): Hono {
  const app = new Hono();

  app.get('/recent', async (c) => {
    const principal = c.get('principal');
    const parsed = RecentQuerySchema.safeParse({ limit: c.req.query('limit') });
    if (!parsed.success) {
      throw new HTTPException(422, { message: 'Invalid query parameters', cause: parsed.error });
    }
    const limit = parsed.data.limit ?? 100;
    const rows = await withTenantScope(pool, principal, (client) =>
      listRecentAuditRows(client, principal.tenantId, limit),
    );
    // Mirrors the SSE CatalogMutationEvent shape with extra
    // audit-log fields (actor, requestId, chainPosition) so the
    // activity feed can render rich rows without a second fetch.
    const items = rows.map((r) => ({
      tenantId: r.tenantId,
      entityType: r.entityType,
      operation: r.operation,
      entityId: r.entityId,
      occurredAt: r.occurredAt,
      actor: r.actor,
      requestId: r.requestId,
      chainPosition: r.chainPosition,
      summary: r.diff ?? undefined,
    }));
    return c.json({ items });
  });

  app.get('/export', async (c) => {
    const principal = c.get('principal');
    const parsed = ExportQuerySchema.safeParse({
      from: c.req.query('from'),
      to: c.req.query('to'),
      limit: c.req.query('limit'),
    });
    if (!parsed.success) {
      throw new HTTPException(422, { message: 'Invalid query parameters', cause: parsed.error });
    }
    const opts: { from?: Date; to?: Date; limit?: number } = {};
    if (parsed.data.from) opts.from = new Date(parsed.data.from);
    if (parsed.data.to) opts.to = new Date(parsed.data.to);
    if (parsed.data.limit !== undefined) opts.limit = parsed.data.limit;

    const rows = await withTenantScope(pool, principal, (client) =>
      listAuditRowsForExport(client, principal.tenantId, opts),
    );

    const body = rows.map(rowToJsonLine).join('\n') + (rows.length > 0 ? '\n' : '');
    c.header('Content-Type', 'application/x-ndjson; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="audit-${principal.tenantId}.jsonl"`);
    return c.body(body);
  });

  app.get('/verify', async (c) => {
    const principal = c.get('principal');
    const result = await withTenantScope(pool, principal, (client) =>
      verifyAuditChain(client, principal.tenantId),
    );
    return c.json(result);
  });

  return app;
}

function rowToJsonLine(row: AuditRow): string {
  // Stable key order matches the canonical fields used in chain
  // hashing — verifiers can reproduce the hash from this line
  // alone (paired with the prevHash from the previous line).
  return JSON.stringify({
    id: row.id,
    tenantId: row.tenantId,
    occurredAt: row.occurredAt,
    actor: row.actor,
    requestId: row.requestId,
    operation: row.operation,
    entityType: row.entityType,
    entityId: row.entityId,
    diff: row.diff,
    chainPosition: row.chainPosition,
    prevHash: row.prevHash,
    entryHash: row.entryHash,
  });
}
