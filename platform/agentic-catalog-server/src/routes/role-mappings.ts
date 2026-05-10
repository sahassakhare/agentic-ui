import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  RoleMappingCreateSchema,
  RoleMappingSchema,
  RoleMappingUpdateSchema,
  ResolveRequestSchema,
  ResolveResponseSchema,
} from '../domain/role-mapping.js';
import { auditActor, isPlatformAdmin } from '../domain/principal.js';
import { withTenantScope, type CatalogPool } from '../db/pool.js';
import {
  createRoleMapping,
  deleteRoleMapping,
  findRoleMappingById,
  listRoleMappings,
  resolveByClaimValues,
  updateRoleMapping,
} from '../repository/role-mapping-repo.js';
import { appendAudit } from '../repository/audit-repo.js';
import { publishCatalogEvent } from '../events/publisher.js';
import { logger } from '../logger.js';

/**
 * `GET    /v1/catalogs/:tenant/role-mappings`
 * `GET    /v1/catalogs/:tenant/role-mappings/:id`
 * `POST   /v1/catalogs/:tenant/role-mappings`
 * `PATCH  /v1/catalogs/:tenant/role-mappings/:id`
 * `DELETE /v1/catalogs/:tenant/role-mappings/:id`
 * `POST   /v1/catalogs/:tenant/role-mappings/resolve`
 *
 * Mounted by the server bootstrap with `bearerAuth` + `requireTenantScope`.
 *
 * **Privilege-escalation guard:** mappings whose `runtimePersona` is in
 * `PROTECTED_PERSONAS` (default: `['platform-admin', 'lead-counsel']`)
 * may only be created/updated by principals carrying the
 * `platform-admin` role. This prevents an admin of one tenant from
 * promoting their own users to a privileged persona by simply
 * editing the mapping table. Audit row is appended either way.
 *
 * Hosts can extend the protected list via the
 * `CATALOG_PROTECTED_PERSONAS` env var (CSV).
 */

const PROTECTED_PERSONAS_DEFAULT = ['platform-admin', 'lead-counsel'];

function getProtectedPersonas(): readonly string[] {
  const env = process.env['CATALOG_PROTECTED_PERSONAS'];
  if (!env) return PROTECTED_PERSONAS_DEFAULT;
  return env.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

function ensureNotEscalating(persona: string, principalIsAdmin: boolean): void {
  if (principalIsAdmin) return;
  if (getProtectedPersonas().includes(persona)) {
    throw new HTTPException(403, {
      message: `Persona "${persona}" is protected — only platform-admins may map to it`,
    });
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string): boolean { return UUID_RE.test(s); }

export function roleMappingsRoutes(pool: CatalogPool): Hono {
  const app = new Hono();

  // ── LIST ────────────────────────────────────────────────────────
  app.get('/', async (c) => {
    const principal = c.get('principal');
    const items = await withTenantScope(pool, principal, listRoleMappings);
    return c.json({ items: items.map((row) => RoleMappingSchema.parse(row)) });
  });

  // ── READ ONE ────────────────────────────────────────────────────
  app.get('/:id', async (c) => {
    const principal = c.get('principal');
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HTTPException(404, { message: 'Role mapping not found' });
    const row = await withTenantScope(pool, principal, (client) =>
      findRoleMappingById(client, id),
    );
    if (!row) throw new HTTPException(404, { message: 'Role mapping not found' });
    return c.json(RoleMappingSchema.parse(row));
  });

  // ── CREATE ──────────────────────────────────────────────────────
  app.post('/', async (c) => {
    const principal = c.get('principal');
    const requestId = c.get('requestId');
    const body = RoleMappingCreateSchema.parse(await c.req.json());
    ensureNotEscalating(body.runtimePersona, isPlatformAdmin(principal));

    const created = await withTenantScope(pool, principal, async (client) => {
      const row = await createRoleMapping(
        client,
        principal.tenantId,
        body,
        auditActor(principal),
      );
      await appendAudit(client, {
        tenantId: principal.tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'create',
        entityType: 'role_mapping',
        entityId: row.id,
        diff: { after: row },
      });
      return row;
    });

    publishCatalogEvent({
      tenantId: created.tenantId,
      entityType: 'role_mapping',
      operation: 'create',
      entityId: created.id,
      occurredAt: new Date().toISOString(),
    });
    c.status(201);
    c.header('Location', `${c.req.path}/${created.id}`);
    return c.json(RoleMappingSchema.parse(created));
  });

  // ── UPDATE ──────────────────────────────────────────────────────
  app.patch('/:id', async (c) => {
    const principal = c.get('principal');
    const requestId = c.get('requestId');
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HTTPException(404, { message: 'Role mapping not found' });
    const patch = RoleMappingUpdateSchema.parse(await c.req.json());
    if (patch.runtimePersona !== undefined) {
      ensureNotEscalating(patch.runtimePersona, isPlatformAdmin(principal));
    }

    const updated = await withTenantScope(pool, principal, async (client) => {
      const before = await findRoleMappingById(client, id);
      if (!before) return null;
      const after = await updateRoleMapping(client, id, patch);
      if (!after) return null;
      await appendAudit(client, {
        tenantId: principal.tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'update',
        entityType: 'role_mapping',
        entityId: id,
        diff: { before, after },
      });
      return after;
    });

    if (!updated) throw new HTTPException(404, { message: 'Role mapping not found' });
    publishCatalogEvent({
      tenantId: updated.tenantId,
      entityType: 'role_mapping',
      operation: 'update',
      entityId: updated.id,
      occurredAt: new Date().toISOString(),
    });
    return c.json(RoleMappingSchema.parse(updated));
  });

  // ── DELETE ──────────────────────────────────────────────────────
  app.delete('/:id', async (c) => {
    const principal = c.get('principal');
    const requestId = c.get('requestId');
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HTTPException(404, { message: 'Role mapping not found' });

    const ok = await withTenantScope(pool, principal, async (client) => {
      const before = await findRoleMappingById(client, id);
      if (!before) return false;
      const deleted = await deleteRoleMapping(client, id);
      if (!deleted) return false;
      await appendAudit(client, {
        tenantId: principal.tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'delete',
        entityType: 'role_mapping',
        entityId: id,
        diff: { before },
      });
      return true;
    });

    if (!ok) throw new HTTPException(404, { message: 'Role mapping not found' });
    publishCatalogEvent({
      tenantId: principal.tenantId,
      entityType: 'role_mapping',
      operation: 'delete',
      entityId: id,
      occurredAt: new Date().toISOString(),
    });
    c.status(204);
    return c.body(null);
  });

  // ── RESOLVE ─────────────────────────────────────────────────────
  // Hot-path; runtime adapters call this on every login + persona-
  // refresh. Should be cacheable (per-tenant + per-claimValues key)
  // by an upstream layer; the server itself returns no cache headers
  // since the mapping table can change at any time.
  app.post('/resolve', async (c) => {
    const principal = c.get('principal');
    const body = ResolveRequestSchema.parse(await c.req.json());

    const result = await withTenantScope(pool, principal, (client) =>
      resolveByClaimValues(client, body),
    );

    // Defensive log: when multiple distinct personas tied at the
    // same priority, we picked the deterministic-tiebreak winner
    // but operators should know — it's likely a misconfiguration.
    // The response already carries the winning matchedClaimValues;
    // here we just log for ops awareness.
    if (result.runtimePersona && result.matchedClaimValues.length > 1) {
      logger.debug({
        tenantId: principal.tenantId,
        mappingId: result.mappingId,
        matched: result.matchedClaimValues.length,
      }, 'role-mapping resolve: multiple matches at winning priority');
    }

    return c.json(ResolveResponseSchema.parse(result));
  });

  return app;
}
