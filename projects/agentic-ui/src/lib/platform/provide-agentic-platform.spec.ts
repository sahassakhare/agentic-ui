import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { provideAgenticPlatform } from './provide-agentic-platform';
import { CatalogCapabilityRegistrarService } from './provide-catalog-capability-registrar';
import { AGENTIC_ACTIVE_PERSONA } from '../chat/active-persona';
import { MFE_REGISTRY_SOURCE } from '../mfe/mfe-registry-source';
import { provideAgenticUi } from '../providers/provide-agentic-ui';
import { z } from 'zod';
import type { ToolDef } from '../types/registry-defs';

const NEVER_CALLED = (() => {
  throw new Error('fetch should not be called in this test');
}) as unknown as typeof fetch;

const STUB_FETCH: typeof fetch = vi.fn(async () =>
  new Response(JSON.stringify({ items: [] }), { status: 200 }),
) as unknown as typeof fetch;

describe('provideAgenticPlatform', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('with no feature switches enabled, neither token nor registry binds', () => {
    TestBed.configureTestingModule({
      providers: [
        provideAgenticPlatform({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => null,
        }),
      ],
    });
    // The default AGENTIC_ACTIVE_PERSONA token is provided by the
    // chat module with `factory: () => () => ''`. Asking for it
    // resolves the default — i.e. our provider didn't override.
    const persona = TestBed.inject(AGENTIC_ACTIVE_PERSONA);
    expect(persona()).toBe('');
    // MFE_REGISTRY_SOURCE has no global default, so injecting it
    // without our provider would throw. Confirm it's NOT bound.
    expect(() => TestBed.inject(MFE_REGISTRY_SOURCE)).toThrow();
  });

  it('persona-only: binds AGENTIC_ACTIVE_PERSONA, leaves MFE alone', () => {
    TestBed.configureTestingModule({
      providers: [
        provideAgenticPlatform({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => null,
          personaResolver: { defaultPersona: 'paralegal', fetchFn: NEVER_CALLED },
        }),
      ],
    });
    const persona = TestBed.inject(AGENTIC_ACTIVE_PERSONA);
    // Default persona shows immediately; refresh is fire-and-forget.
    expect(persona()).toBe('paralegal');
    expect(() => TestBed.inject(MFE_REGISTRY_SOURCE)).toThrow();
  });

  it('mfe-only: binds MFE_REGISTRY_SOURCE, leaves persona alone', () => {
    TestBed.configureTestingModule({
      providers: [
        provideAgenticPlatform({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => null,
          mfeRegistry: { fetchFn: STUB_FETCH },
        }),
      ],
    });
    expect(TestBed.inject(MFE_REGISTRY_SOURCE)).toBeDefined();
    expect(TestBed.inject(AGENTIC_ACTIVE_PERSONA)()).toBe('');
  });

  it('both-on: binds both adapters', () => {
    TestBed.configureTestingModule({
      providers: [
        provideAgenticPlatform({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => null,
          personaResolver: { defaultPersona: 'paralegal', fetchFn: NEVER_CALLED },
          mfeRegistry: { fetchFn: STUB_FETCH },
        }),
      ],
    });
    expect(TestBed.inject(AGENTIC_ACTIVE_PERSONA)()).toBe('paralegal');
    expect(TestBed.inject(MFE_REGISTRY_SOURCE)).toBeDefined();
  });

  it('explicit `false` skips that integration', () => {
    TestBed.configureTestingModule({
      providers: [
        provideAgenticPlatform({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => null,
          personaResolver: false,
          mfeRegistry: { fetchFn: STUB_FETCH },
        }),
      ],
    });
    expect(TestBed.inject(AGENTIC_ACTIVE_PERSONA)()).toBe('');
    expect(TestBed.inject(MFE_REGISTRY_SOURCE)).toBeDefined();
  });

  it('capabilityRegistrar: forwards shared catalogUrl/tenant/getToken into the registrar', async () => {
    const fx = vi.fn(async () => new Response(JSON.stringify({}), { status: 201 })) as unknown as typeof fetch;
    const tool: ToolDef = {
      name: 'gap1-tool',
      description: 'gap-1 wiring check',
      schema: z.object({}),
      handler: async () => null,
    };
    TestBed.configureTestingModule({
      providers: [
        provideAgenticUi({ tools: [tool] }),
        provideAgenticPlatform({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => 'tok',
          capabilityRegistrar: { fetchFn: fx },
        }),
      ],
    });
    const svc = TestBed.inject(CatalogCapabilityRegistrarService);
    await svc.lastSync;
    expect(svc.results().length).toBe(1);
    expect(svc.results()[0]?.name).toBe('gap1-tool');
    expect(svc.results()[0]?.status).toBe('created');
  });

  it('capabilityRegistrar: false skips the registrar entirely', () => {
    const fx = vi.fn(async () => new Response(JSON.stringify({}), { status: 201 })) as unknown as typeof fetch;
    TestBed.configureTestingModule({
      providers: [
        provideAgenticUi({ tools: [{
          name: 't',
          description: 'd',
          schema: z.object({}),
          handler: async () => null,
        } satisfies ToolDef] }),
        provideAgenticPlatform({
          catalogUrl: 'https://catalog.example.com',
          tenantId: 'acme',
          getToken: () => 'tok',
          capabilityRegistrar: false,
          mfeRegistry: { fetchFn: fx },
        }),
      ],
    });
    // Initializer for registrar should never run; service holds an empty result list.
    const svc = TestBed.inject(CatalogCapabilityRegistrarService);
    expect(svc.results().length).toBe(0);
  });

  it('tenantId can be a function (resolved eagerly at provider time)', () => {
    let resolved = false;
    TestBed.configureTestingModule({
      providers: [
        provideAgenticPlatform({
          catalogUrl: 'https://catalog.example.com',
          tenantId: () => { resolved = true; return 'dynamic-tenant'; },
          getToken: () => null,
          mfeRegistry: { fetchFn: STUB_FETCH },
        }),
      ],
    });
    // Force initialisation by injecting MFE registry.
    TestBed.inject(MFE_REGISTRY_SOURCE);
    expect(resolved).toBe(true);
  });
});
