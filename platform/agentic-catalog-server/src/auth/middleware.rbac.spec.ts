import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { requireWriteAccess, writerRolesFromEnv } from './middleware.js';
import type { Principal } from '../domain/principal.js';

/**
 * Unit tests for the per-verb RBAC guard (audit finding A1). Reads are open to
 * any authenticated principal; unsafe methods require a writer role; read-only
 * POSTs (…/plan) are exempt. Pure-logic — runs in the standard suite.
 */
function appAs(roles: string[]) {
  const principal: Principal = { subject: 't', tenantId: 'acme', displayName: 't', roles, issuer: 'test' };
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('principal', principal); await next(); });
  app.use('*', requireWriteAccess(['platform-admin', 'editor']));
  app.get('/x', (c) => c.text('read'));
  app.post('/x', (c) => c.text('write'));
  app.patch('/x', (c) => c.text('patch'));
  app.delete('/x', (c) => c.text('del'));
  app.post('/y/plan', (c) => c.text('plan'));
  return app;
}
const status = (app: Hono, method: string, path: string) =>
  app.request(path, { method }).then((r) => r.status);

describe('requireWriteAccess — per-verb RBAC', () => {
  it('lets any authenticated principal READ', async () => {
    expect(await status(appAs(['member']), 'GET', '/x')).toBe(200);
  });
  it('DENIES writes without a writer role (403)', async () => {
    const app = appAs(['member']);
    expect(await status(app, 'POST', '/x')).toBe(403);
    expect(await status(app, 'PATCH', '/x')).toBe(403);
    expect(await status(app, 'DELETE', '/x')).toBe(403);
  });
  it('ALLOWS writes for a writer role', async () => {
    expect(await status(appAs(['editor']), 'POST', '/x')).toBe(200);
    expect(await status(appAs(['platform-admin']), 'DELETE', '/x')).toBe(200);
  });
  it('exempts read-only POSTs (…/plan) from the write guard', async () => {
    expect(await status(appAs(['member']), 'POST', '/y/plan')).toBe(200);
  });
  it('always includes platform-admin as a writer role from env', () => {
    expect(writerRolesFromEnv()).toContain('platform-admin');
  });
});
