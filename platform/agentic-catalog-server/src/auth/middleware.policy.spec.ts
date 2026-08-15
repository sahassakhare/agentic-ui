import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { requirePolicyDecision } from './middleware.js';
import type { OpaClient } from '../policy/opa-client.js';
import type { Principal } from '../domain/principal.js';

/**
 * Unit tests for the OPA policy-enforcement guard (audit finding A3): governance
 * writes are gated by an OPA decision; deny (or an unreachable engine) blocks;
 * reads and read-only POSTs pass; no-ops when OPA is unconfigured.
 */
function fakeOpa(o: { enabled: boolean; allow?: boolean; throws?: boolean }): OpaClient {
  return {
    enabled: o.enabled,
    url: o.enabled ? 'http://opa' : null,
    async evaluate() {
      if (o.throws) throw new Error('opa unreachable');
      return { allow: o.allow ?? true, bundle: null, rulePath: 'catalog/allow' };
    },
  };
}
function app(opa: OpaClient) {
  const principal: Principal = { subject: 't', tenantId: 'acme', displayName: 't', roles: ['editor'], issuer: 'test' };
  const a = new Hono();
  a.use('*', async (c, next) => { c.set('principal', principal); await next(); });
  a.use('*', requirePolicyDecision(opa, 'catalog/allow'));
  a.get('/x', (c) => c.text('read'));
  a.post('/x', (c) => c.text('write'));
  a.post('/y/plan', (c) => c.text('plan'));
  return a;
}
const st = (a: Hono, method: string, path: string) => a.request(path, { method }).then((r) => r.status);

describe('requirePolicyDecision — OPA enforcement', () => {
  it('no-ops when OPA is not configured', async () => {
    expect(await st(app(fakeOpa({ enabled: false })), 'POST', '/x')).toBe(200);
  });
  it('always allows reads', async () => {
    expect(await st(app(fakeOpa({ enabled: true, allow: false })), 'GET', '/x')).toBe(200);
  });
  it('allows a write when OPA allows', async () => {
    expect(await st(app(fakeOpa({ enabled: true, allow: true })), 'POST', '/x')).toBe(200);
  });
  it('DENIES a write when OPA denies (403)', async () => {
    expect(await st(app(fakeOpa({ enabled: true, allow: false })), 'POST', '/x')).toBe(403);
  });
  it('fails CLOSED when the policy engine errors (403)', async () => {
    expect(await st(app(fakeOpa({ enabled: true, throws: true })), 'POST', '/x')).toBe(403);
  });
  it('exempts read-only POSTs (…/plan)', async () => {
    expect(await st(app(fakeOpa({ enabled: true, allow: false })), 'POST', '/y/plan')).toBe(200);
  });
});
