import { describe, expect, it, vi } from 'vitest';
import { createEmbedClient, EmbedError } from './client.js';
import type { PublishedManifest } from './types.js';

const manifest: PublishedManifest = {
  experience: { name: 'support-ticket', title: 'Support Ticket', goal: 'open a ticket' },
  workflow: { steps: [{ id: 's1', widget: 'category-picker', next: null }] },
  widgets: [{ name: 'category-picker', kind: 'component' }],
  publishedVersionNo: 3,
  publishedAt: '2026-08-01T00:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('createEmbedClient.getManifest', () => {
  it('calls the manifest URL with the embed key and returns JSON', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(manifest));
    const client = createEmbedClient({
      catalogUrl: 'https://catalog.example.com/', tenant: 'acme', key: 'emb_secret', fetchImpl,
    });

    const out = await client.getManifest('support-ticket');
    expect(out.experience.name).toBe('support-ticket');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://catalog.example.com/v1/embed/acme/experiences/support-ticket/manifest');
    expect((init as RequestInit).method).toBe('GET');
    expect((init as RequestInit).headers).toMatchObject({ 'x-embed-key': 'emb_secret' });
  });

  it('sends Origin only when configured', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(manifest));
    const client = createEmbedClient({
      catalogUrl: 'https://c', tenant: 'acme', key: 'k', origin: 'https://portal.acme.com', fetchImpl,
    });
    await client.getManifest('x');
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ origin: 'https://portal.acme.com' });
  });

  it('throws EmbedError with status + code on non-2xx', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 'not_found', message: 'nope' }, 404));
    const client = createEmbedClient({ catalogUrl: 'https://c', tenant: 'acme', key: 'k', fetchImpl });
    await expect(client.getManifest('missing')).rejects.toMatchObject({
      name: 'EmbedError', status: 404, code: 'not_found',
    });
  });

  it('wraps network failures as EmbedError(status=0)', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const client = createEmbedClient({ catalogUrl: 'https://c', tenant: 'acme', key: 'k', fetchImpl });
    const err = await client.getManifest('x').catch((e) => e);
    expect(err).toBeInstanceOf(EmbedError);
    expect(err.status).toBe(0);
  });
});
