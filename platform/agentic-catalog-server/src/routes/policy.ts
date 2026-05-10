import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  PolicyBundleCreateSchema,
  PolicyBundleSchema,
  PolicyBundleUpdateSchema,
  PolicyDecisionRequestSchema,
} from '../domain/policy.js';
import { auditActor } from '../domain/principal.js';
import { withTenantScope, type CatalogPool } from '../db/pool.js';
import {
  createPolicyBundle,
  deletePolicyBundle,
  findActivePolicyBundle,
  findPolicyBundleById,
  findPolicyBundleByName,
  listPolicyBundles,
  updatePolicyBundle,
} from '../repository/policy-repo.js';
import { appendAudit } from '../repository/audit-repo.js';
import { publishCatalogEvent } from '../events/publisher.js';
import type { OpaClient } from '../policy/opa-client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string): boolean => UUID_RE.test(s);

/**
 * Policy bundle storage + decision endpoint. Slice OPA-A / ADR-040.
 *
 *   GET    /v1/catalogs/:tenant/policy/bundles
 *   GET    /v1/catalogs/:tenant/policy/bundles/:id
 *   POST   /v1/catalogs/:tenant/policy/bundles
 *   PATCH  /v1/catalogs/:tenant/policy/bundles/:id
 *   DELETE /v1/catalogs/:tenant/policy/bundles/:id
 *   POST   /v1/catalogs/:tenant/policy/decide
 *
 * The decision endpoint forwards to an OPA sidecar (configured via
 * OPA_URL); the catalog itself doesn't evaluate rego.
 */
export function policyRoutes(pool: CatalogPool, opa: OpaClient): Hono {
  const app = new Hono();

  // ── BUNDLES — list ──────────────────────────────────────────────
  app.get('/bundles', async (c) => {
    const principal = c.get('principal');
    const items = await withTenantScope(pool, principal, (client) => listPolicyBundles(client));
    return c.json({ items: items.map((b) => PolicyBundleSchema.parse(b)) });
  });

  app.get('/bundles/:id', async (c) => {
    const principal = c.get('principal');
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HTTPException(404, { message: 'Policy bundle not found' });
    const row = await withTenantScope(pool, principal, (client) => findPolicyBundleById(client, id));
    if (!row) throw new HTTPException(404, { message: 'Policy bundle not found' });
    return c.json(PolicyBundleSchema.parse(row));
  });

  app.post('/bundles', async (c) => {
    const principal = c.get('principal');
    const requestId = c.get('requestId');
    const tenantId = principal.tenantId;
    const body = PolicyBundleCreateSchema.parse(await c.req.json());

    const created = await withTenantScope(pool, principal, async (client) => {
      const existing = await findPolicyBundleByName(client, body.name);
      if (existing) {
        throw new HTTPException(409, { message: `Policy bundle "${body.name}" already exists` });
      }
      const row = await createPolicyBundle(client, tenantId, body, auditActor(principal));
      await appendAudit(client, {
        tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'create',
        entityType: 'policy_bundle',
        entityId: row.id,
        diff: { after: row },
      });
      return row;
    });

    publishCatalogEvent({
      tenantId: created.tenantId,
      entityType: 'policy_bundle',
      operation: 'create',
      entityId: created.id,
      occurredAt: new Date().toISOString(),
      summary: { name: created.name, isActive: created.isActive },
    });
    c.status(201);
    c.header('Location', `${c.req.path}/${created.id}`);
    return c.json(PolicyBundleSchema.parse(created));
  });

  app.patch('/bundles/:id', async (c) => {
    const principal = c.get('principal');
    const requestId = c.get('requestId');
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HTTPException(404, { message: 'Policy bundle not found' });
    const patch = PolicyBundleUpdateSchema.parse(await c.req.json());

    const updated = await withTenantScope(pool, principal, async (client) => {
      const before = await findPolicyBundleById(client, id);
      if (!before) return null;
      const after = await updatePolicyBundle(client, id, patch);
      if (!after) return null;
      await appendAudit(client, {
        tenantId: principal.tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'update',
        entityType: 'policy_bundle',
        entityId: id,
        diff: { before, after },
      });
      return after;
    });
    if (!updated) throw new HTTPException(404, { message: 'Policy bundle not found' });
    publishCatalogEvent({
      tenantId: updated.tenantId,
      entityType: 'policy_bundle',
      operation: 'update',
      entityId: updated.id,
      occurredAt: new Date().toISOString(),
      summary: { isActive: updated.isActive },
    });
    return c.json(PolicyBundleSchema.parse(updated));
  });

  app.delete('/bundles/:id', async (c) => {
    const principal = c.get('principal');
    const requestId = c.get('requestId');
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HTTPException(404, { message: 'Policy bundle not found' });

    const deleted = await withTenantScope(pool, principal, async (client) => {
      const before = await findPolicyBundleById(client, id);
      if (!before) return null;
      const ok = await deletePolicyBundle(client, id);
      if (!ok) return null;
      await appendAudit(client, {
        tenantId: principal.tenantId,
        actor: auditActor(principal),
        requestId: requestId ?? null,
        operation: 'delete',
        entityType: 'policy_bundle',
        entityId: id,
        diff: { before },
      });
      return before;
    });
    if (!deleted) throw new HTTPException(404, { message: 'Policy bundle not found' });
    publishCatalogEvent({
      tenantId: deleted.tenantId,
      entityType: 'policy_bundle',
      operation: 'delete',
      entityId: deleted.id,
      occurredAt: new Date().toISOString(),
    });
    c.status(204);
    return c.body(null);
  });

  // ── DECISION ────────────────────────────────────────────────────
  app.post('/decide', async (c) => {
    if (!opa.enabled) {
      throw new HTTPException(422, {
        message: 'OPA policy decisions not configured. Set OPA_URL to point at an OPA sidecar. See ADR-040.',
      });
    }

    const principal = c.get('principal');
    const inputBody = PolicyDecisionRequestSchema.parse(await c.req.json());

    // Look up the active bundle for this tenant — the active rule
    // path determines which OPA rule we hit.
    const active = await withTenantScope(pool, principal, (client) =>
      findActivePolicyBundle(client),
    );
    if (!active) {
      throw new HTTPException(422, {
        message: 'No active policy bundle for this tenant. POST a bundle with isActive=true (or PATCH an existing one).',
      });
    }

    // Fan out to OPA. Failures bubble as 502 — operators can see
    // which call failed in the audit/telemetry trail.
    let decision;
    try {
      decision = await opa.evaluate(active.rulePath, inputBody, active.name);
    } catch (err) {
      throw new HTTPException(502, {
        message: `OPA evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    return c.json(decision);
  });

  return app;
}
