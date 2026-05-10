import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { Component, inject, provideEnvironmentInitializer } from '@angular/core';
import {
  provideCatalogCapabilityAuthorizer,
  CatalogCapabilityAuthorizerService,
  composeWithCatalogAuthorizer,
} from './provide-catalog-capability-authorizer';
import { provideAgenticUi } from '../providers/provide-agentic-ui';
import { ToolRegistry } from '../registries/tool-registry';
import { ComponentRegistry } from '../registries/component-registry';
import { activeScopePolicy, permissiveScopePolicy } from '../registries/registry-base';
import type { ToolDef, ComponentDef, RegistryEntry } from '../types/registry-defs';

const enabledTool: ToolDef = {
  name: 'enabled-tool',
  description: 'd',
  schema: z.object({}),
  handler: async () => null,
};
const disabledTool: ToolDef = {
  name: 'disabled-tool',
  description: 'd',
  schema: z.object({}),
  handler: async () => null,
};

@Component({ selector: 'enabled-widget', template: '' })
class EnabledWidget {}
const enabledWidget: ComponentDef = {
  name: 'enabled-widget',
  component: EnabledWidget,
  propsSchema: z.object({}),
};

interface FetchCall { url: string; init: RequestInit }
function recordingFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string'
      ? input
      : 'url' in (input as Request)
      ? (input as Request).url
      : String(input);
    calls.push({ url, init });
    return handler({ url, init });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const denyDisabledToolFetch = recordingFetch(async () =>
  new Response(
    JSON.stringify({
      items: [
        { kind: 'tool', name: 'disabled-tool', lifecycle: 'disabled' },
      ],
      total: 1,
      limit: 500,
      offset: 0,
    }),
    { status: 200 },
  ),
);

describe('composeWithCatalogAuthorizer', () => {
  it('AND-composes inner policy with catalog deny-list', () => {
    const inner = activeScopePolicy(() => 'paralegal');
    const disabled = new Set(['tool:disabled-tool']);
    const composed = composeWithCatalogAuthorizer(
      inner,
      () => disabled,
      'tool',
      () => false,
    );

    // In-scope + not disabled → visible.
    expect(composed({ name: 'enabled-tool', scopes: ['paralegal'] } as RegistryEntry)).toBe(true);

    // In-scope but disabled → hidden.
    expect(composed({ name: 'disabled-tool', scopes: ['paralegal'] } as RegistryEntry)).toBe(false);

    // Out-of-scope (inner says false) → hidden.
    expect(composed({ name: 'enabled-tool', scopes: ['lead-counsel'] } as RegistryEntry)).toBe(false);
  });

  it('closedAllowlist=true denies everything', () => {
    const composed = composeWithCatalogAuthorizer(
      permissiveScopePolicy,
      () => new Set(),
      'tool',
      () => true,
    );
    expect(composed({ name: 'whatever' } as RegistryEntry)).toBe(false);
  });
});

describe('provideCatalogCapabilityAuthorizer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    denyDisabledToolFetch.calls.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides catalog-disabled entries from registry reads', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideAgenticUi({ tools: [enabledTool, disabledTool], widgets: [enabledWidget] }),
        provideCatalogCapabilityAuthorizer({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => 'tok',
          fetchFn: denyDisabledToolFetch.fn,
          refreshIntervalMs: 0, // disable polling for this test
        }),
      ],
    });
    const svc = TestBed.inject(CatalogCapabilityAuthorizerService);
    await svc.lastRefresh;

    expect(svc.disabledKeys()).toEqual(new Set(['tool:disabled-tool']));
    expect(svc.disabledCount()).toBe(1);

    const tools = TestBed.inject(ToolRegistry);
    const visibleNames = tools.list().map((t) => t.name);
    expect(visibleNames).toContain('enabled-tool');
    expect(visibleNames).not.toContain('disabled-tool');

    const widgets = TestBed.inject(ComponentRegistry);
    expect(widgets.list().map((w) => w.name)).toContain('enabled-widget');

    // Catalog request shape: GET with lifecycle=disabled query.
    expect(denyDisabledToolFetch.calls.length).toBeGreaterThan(0);
    expect(denyDisabledToolFetch.calls[0]?.url).toMatch(/lifecycle=disabled/);
    expect((denyDisabledToolFetch.calls[0]?.init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
  });

  it('default-allows when catalog fetch fails (degrades gracefully)', async () => {
    const failFetch = recordingFetch(async () =>
      new Response('catalog down', { status: 500, statusText: 'Internal Server Error' }),
    );
    TestBed.configureTestingModule({
      providers: [
        provideAgenticUi({ tools: [enabledTool, disabledTool] }),
        provideCatalogCapabilityAuthorizer({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => 'tok',
          fetchFn: failFetch.fn,
          refreshIntervalMs: 0,
        }),
      ],
    });
    const svc = TestBed.inject(CatalogCapabilityAuthorizerService);
    await svc.lastRefresh;

    expect(svc.initialFetchFailed()).toBe(true);

    // Default-allow: both tools still visible.
    const tools = TestBed.inject(ToolRegistry);
    const visibleNames = tools.list().map((t) => t.name);
    expect(visibleNames).toEqual(expect.arrayContaining(['enabled-tool', 'disabled-tool']));
  });

  it('onInitialFetchFailure: deny — closed allowlist hides everything until success', async () => {
    const failFetch = recordingFetch(async () =>
      new Response('boom', { status: 500 }),
    );
    TestBed.configureTestingModule({
      providers: [
        provideAgenticUi({ tools: [enabledTool, disabledTool] }),
        provideCatalogCapabilityAuthorizer({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => 'tok',
          fetchFn: failFetch.fn,
          refreshIntervalMs: 0,
          onInitialFetchFailure: 'deny',
        }),
      ],
    });
    const svc = TestBed.inject(CatalogCapabilityAuthorizerService);
    await svc.lastRefresh;

    expect(svc.initialFetchFailed()).toBe(true);

    const tools = TestBed.inject(ToolRegistry);
    expect(tools.list().length).toBe(0);
  });

  it('polls on refreshIntervalMs and updates disabled-keys live', async () => {
    let callCount = 0;
    const cycling = recordingFetch(async () => {
      callCount += 1;
      const items = callCount === 1
        ? []  // first fetch: no disabled entries
        : [{ kind: 'tool', name: 'disabled-tool', lifecycle: 'disabled' }];
      return new Response(JSON.stringify({ items, total: items.length, limit: 500, offset: 0 }), { status: 200 });
    });
    TestBed.configureTestingModule({
      providers: [
        provideAgenticUi({ tools: [enabledTool, disabledTool] }),
        provideCatalogCapabilityAuthorizer({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => 'tok',
          fetchFn: cycling.fn,
          refreshIntervalMs: 1000,
        }),
      ],
    });
    const svc = TestBed.inject(CatalogCapabilityAuthorizerService);
    await svc.lastRefresh;

    expect(svc.disabledCount()).toBe(0);
    const tools = TestBed.inject(ToolRegistry);
    expect(tools.list().map((t) => t.name)).toContain('disabled-tool');

    // Advance clock past one polling interval.
    await vi.advanceTimersByTimeAsync(1100);
    await Promise.resolve();
    await Promise.resolve();

    expect(svc.disabledCount()).toBe(1);
    expect(tools.list().map((t) => t.name)).not.toContain('disabled-tool');
  });

  it('composes with an existing scope policy installed before the authorizer', async () => {
    const personaSig = { value: 'paralegal' };
    TestBed.configureTestingModule({
      providers: [
        provideAgenticUi({
          tools: [
            enabledTool,
            disabledTool,
            { ...enabledTool, name: 'counsel-only-tool', scopes: ['lead-counsel'] },
          ],
        }),
        // Install the persona policy in an initializer registered
        // BEFORE the authorizer's. Initializers fire in registration
        // order; the authorizer composes on top of whatever it
        // finds installed.
        provideEnvironmentInitializer(() => {
          inject(ToolRegistry).setScopePolicy(activeScopePolicy(() => personaSig.value));
        }),
        provideCatalogCapabilityAuthorizer({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => 'tok',
          fetchFn: denyDisabledToolFetch.fn,
          refreshIntervalMs: 0,
        }),
      ],
    });
    const svc = TestBed.inject(CatalogCapabilityAuthorizerService);
    await svc.lastRefresh;
    const tools = TestBed.inject(ToolRegistry);

    const visible = tools.list().map((t) => t.name);
    // disabled-tool: hidden by authorizer.
    expect(visible).not.toContain('disabled-tool');
    // counsel-only-tool: hidden by persona policy (active=paralegal).
    expect(visible).not.toContain('counsel-only-tool');
    // enabled-tool: scope-less, in-scope; visible.
    expect(visible).toContain('enabled-tool');
  });
});
