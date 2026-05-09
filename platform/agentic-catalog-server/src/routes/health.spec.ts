import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildIntegrationHarness, type IntegrationHarness } from '../test-helpers/integration.js';

describe('health routes', () => {
  let h: IntegrationHarness;

  beforeAll(async () => { h = await buildIntegrationHarness(); });
  afterAll(async () => { await h.destroy(); });

  it('GET /healthz returns 200 ok regardless of auth', async () => {
    const res = await h.fetch(new Request('http://localhost/healthz'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok', authMode: 'oidc' });
  });

  it('GET /readyz reports ready when DB is up', async () => {
    const res = await h.fetch(new Request('http://localhost/readyz'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ready', db: 'ok', authMode: 'oidc' });
  });

  it('health routes set X-Request-Id', async () => {
    const res = await h.fetch(new Request('http://localhost/healthz'));
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });

  it('honours incoming X-Request-Id', async () => {
    const res = await h.fetch(new Request('http://localhost/healthz', {
      headers: { 'X-Request-Id': 'caller-supplied-id' },
    }));
    expect(res.headers.get('X-Request-Id')).toBe('caller-supplied-id');
  });
});
