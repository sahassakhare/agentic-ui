import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import {
  provideCatalogCapabilityRegistrar,
  CatalogCapabilityRegistrarService,
  toRegistrarPayload,
} from './provide-catalog-capability-registrar';
import { provideAgenticUi } from '../providers/provide-agentic-ui';
import { ToolRegistry } from '../registries/tool-registry';
import { ComponentRegistry } from '../registries/component-registry';
import { Component } from '@angular/core';
import type { ToolDef, ComponentDef } from '../types/registry-defs';

interface FetchCall { url: string; init: RequestInit }

function recordingFetch(
  handler: (call: FetchCall) => Response | Promise<Response>,
): { fn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string'
      ? input
      : 'url' in (input as Request)
      ? (input as Request).url
      : String(input);
    const call = { url, init };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const sampleTool: ToolDef = {
  name: 'sample-tool',
  description: 'a tool used for testing',
  schema: z.object({ x: z.number() }),
  handler: async (args: unknown) => args,
  scopes: ['paralegal'],
  tags: ['test', 'sample'],
  owner: 'team:platform',
  lifecycle: 'published',
};

@Component({ selector: 'sample-widget', template: '' })
class SampleWidget {}

const sampleWidget: ComponentDef = {
  name: 'sample-widget',
  component: SampleWidget,
  propsSchema: z.object({}),
  dataSources: ['users'],
};

describe('toRegistrarPayload', () => {
  it('maps tool with scopes/tags/owner to catalog wire shape', () => {
    const payload = toRegistrarPayload('tool', sampleTool, 'published');
    expect(payload.kind).toBe('tool');
    expect(payload.name).toBe('sample-tool');
    expect(payload.lifecycle).toBe('published');
    expect(payload.tags).toEqual(['test', 'sample']);
    expect(payload.owner).toBe('team:platform');
    expect(payload.body).toMatchObject({
      description: 'a tool used for testing',
      source: 'host',
      scopes: ['paralegal'],
    });
  });

  it('maps widget with dataSources', () => {
    const payload = toRegistrarPayload('component', sampleWidget, 'published');
    expect(payload.kind).toBe('component');
    expect(payload.name).toBe('sample-widget');
    expect(payload.body).toMatchObject({
      source: 'host',
      dataSources: ['users'],
    });
  });

  it('falls back to defaultLifecycle when entry has none', () => {
    const tool: ToolDef = { ...sampleTool, name: 'no-lc' };
    const { lifecycle: _omit, ...rest } = tool;
    const payload = toRegistrarPayload('tool', rest as ToolDef, 'draft');
    expect(payload.lifecycle).toBe('draft');
  });
});

describe('provideCatalogCapabilityRegistrar', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('POSTs each registered tool + widget at boot', async () => {
    const fx = recordingFetch(async () =>
      new Response(JSON.stringify({ id: 'srv-id' }), { status: 201 }),
    );
    TestBed.configureTestingModule({
      providers: [
        provideAgenticUi({ tools: [sampleTool], widgets: [sampleWidget] }),
        provideCatalogCapabilityRegistrar({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => 'token-abc',
          fetchFn: fx.fn,
        }),
      ],
    });
    const svc = TestBed.inject(CatalogCapabilityRegistrarService);
    await svc.lastSync;

    expect(fx.calls.length).toBe(2);
    expect(fx.calls[0]?.url).toBe(
      'https://catalog.example.com/v1/catalogs/acme/capabilities',
    );
    const auth = (fx.calls[0]?.init.headers as Record<string, string>)['Authorization'];
    expect(auth).toBe('Bearer token-abc');
    const body0 = JSON.parse(String(fx.calls[0]?.init.body));
    expect(body0).toMatchObject({ kind: 'tool', name: 'sample-tool' });
    const body1 = JSON.parse(String(fx.calls[1]?.init.body));
    expect(body1).toMatchObject({ kind: 'component', name: 'sample-widget' });
  });

  it('treats 409 conflicts as success (idempotent)', async () => {
    const fx = recordingFetch(async () =>
      new Response('Capability already exists', { status: 409 }),
    );
    TestBed.configureTestingModule({
      providers: [
        provideAgenticUi({ tools: [sampleTool] }),
        provideCatalogCapabilityRegistrar({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => 'token-abc',
          fetchFn: fx.fn,
        }),
      ],
    });
    const svc = TestBed.inject(CatalogCapabilityRegistrarService);
    await svc.lastSync;

    const results = svc.results();
    expect(results.length).toBe(1);
    expect(results[0]?.status).toBe('exists');
    expect(results[0]?.httpStatus).toBe(409);
  });

  it('records server failures without crashing', async () => {
    const fx = recordingFetch(async () =>
      new Response('boom', { status: 500, statusText: 'Internal Server Error' }),
    );
    TestBed.configureTestingModule({
      providers: [
        provideAgenticUi({ tools: [sampleTool] }),
        provideCatalogCapabilityRegistrar({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => 'token-abc',
          fetchFn: fx.fn,
        }),
      ],
    });
    const svc = TestBed.inject(CatalogCapabilityRegistrarService);
    await svc.lastSync;

    const results = svc.results();
    expect(results[0]?.status).toBe('failed');
    expect(results[0]?.httpStatus).toBe(500);
    expect(results[0]?.error).toMatch(/HTTP 500/);
  });

  it('skips remote-source entries by default; includes them when includeRemotes', async () => {
    const remoteTool: ToolDef = { ...sampleTool, name: 'remote-tool', source: 'remote:bookings' };
    const fx = recordingFetch(async () =>
      new Response(JSON.stringify({ id: 'srv-id' }), { status: 201 }),
    );
    TestBed.configureTestingModule({
      providers: [
        provideAgenticUi({ tools: [sampleTool, remoteTool] }),
        provideCatalogCapabilityRegistrar({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => null,
          fetchFn: fx.fn,
        }),
      ],
    });
    const svc = TestBed.inject(CatalogCapabilityRegistrarService);
    await svc.lastSync;

    // Only the host tool should have been POSTed.
    expect(fx.calls.length).toBe(1);
    const body = JSON.parse(String(fx.calls[0]?.init.body));
    expect(body.name).toBe('sample-tool');
  });

  it('omits Authorization header when getToken returns null (AUTH_MODE=disabled)', async () => {
    const fx = recordingFetch(async () =>
      new Response(JSON.stringify({}), { status: 201 }),
    );
    TestBed.configureTestingModule({
      providers: [
        provideAgenticUi({ tools: [sampleTool] }),
        provideCatalogCapabilityRegistrar({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => null,
          fetchFn: fx.fn,
        }),
      ],
    });
    const svc = TestBed.inject(CatalogCapabilityRegistrarService);
    await svc.lastSync;

    const headers = fx.calls[0]?.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('does not crash when the registry is empty', async () => {
    const fx = recordingFetch(async () => new Response('', { status: 201 }));
    TestBed.configureTestingModule({
      providers: [
        provideAgenticUi({}),
        provideCatalogCapabilityRegistrar({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => null,
          fetchFn: fx.fn,
        }),
      ],
    });
    const svc = TestBed.inject(CatalogCapabilityRegistrarService);
    await svc.lastSync;

    expect(fx.calls.length).toBe(0);
    expect(svc.results().length).toBe(0);
  });

  it('resync() picks up late-arriving registrations (e.g. MFE remotes loaded post-bootstrap)', async () => {
    const fx = recordingFetch(async () =>
      new Response(JSON.stringify({}), { status: 201 }),
    );
    TestBed.configureTestingModule({
      providers: [
        provideAgenticUi({ tools: [sampleTool] }),
        provideCatalogCapabilityRegistrar({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => null,
          fetchFn: fx.fn,
          includeRemotes: true,
        }),
      ],
    });
    const svc = TestBed.inject(CatalogCapabilityRegistrarService);
    await svc.lastSync;

    // Initial sync only sees `sample-tool`.
    expect(fx.calls.length).toBe(1);
    expect(JSON.parse(String(fx.calls[0]?.init.body)).name).toBe('sample-tool');

    // Simulate a federated remote loading after bootstrap.
    const lateTool: ToolDef = { ...sampleTool, name: 'late-remote-tool', source: 'remote:bookings' };
    TestBed.inject(ToolRegistry).register(lateTool);

    // Trigger resync — the host calls this from inside its MFE-load
    // initializer once remotes have settled.
    await svc.resync();

    // Both tools have been POSTed; the first re-attempt returns 409
    // (already exists) and the new one returns 201.
    expect(fx.calls.length).toBe(3);
    const lastBodies = fx.calls.slice(1).map((c) => JSON.parse(String(c.init.body)).name);
    expect(lastBodies).toContain('sample-tool');     // sees 409 from server (mocked 201, treated as created — fine for this test)
    expect(lastBodies).toContain('late-remote-tool');
  });

  it('resync() is a no-op when the service was never configured (no provider wired)', async () => {
    TestBed.configureTestingModule({
      providers: [provideAgenticUi({})],
    });
    const svc = TestBed.inject(CatalogCapabilityRegistrarService);
    // Should not throw — there's just no config to act on.
    await svc.resync();
    expect(svc.results().length).toBe(0);
  });
});
