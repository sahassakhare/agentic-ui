import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { provideAgenticPlatform } from './provide-agentic-platform';
import { AGENTIC_ACTIVE_PERSONA } from '../chat/active-persona';
import { MFE_REGISTRY_SOURCE } from '../mfe/mfe-registry-source';

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
