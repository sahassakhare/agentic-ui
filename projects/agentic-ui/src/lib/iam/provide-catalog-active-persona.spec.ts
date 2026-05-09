import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { AGENTIC_ACTIVE_PERSONA } from '../chat/active-persona';
import {
  CatalogIamService,
  type CatalogActivePersonaOptions,
} from './provide-catalog-active-persona';

function base64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function mintToken(payload: object): string {
  return [
    base64Url(JSON.stringify({ alg: 'none', typ: 'JWT' })),
    base64Url(JSON.stringify(payload)),
    'sig',
  ].join('.');
}

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit;
}

function recordingFetch(handler: (call: FetchCall) => Response | Promise<Response>): { fn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input
      : 'url' in (input as Request) ? (input as Request).url
      : String(input);
    const call = { url, init };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { fn, calls };
}

/**
 * The provider helper {@link provideCatalogActivePersona} is exercised
 * by setting up the {@link CatalogIamService} via Angular's standard
 * `providedIn: 'root'` and wiring `AGENTIC_ACTIVE_PERSONA` to read
 * from the service's signal — same shape as the production helper,
 * but expressed in a test-bed-friendly way.
 */
function setup(opts: CatalogActivePersonaOptions): { svc: CatalogIamService; persona: () => string } {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AGENTIC_ACTIVE_PERSONA,
        useFactory: (svc: CatalogIamService) => {
          svc.configure(opts);
          return () => svc.persona();
        },
        deps: [CatalogIamService],
      },
    ],
  });
  const personaFactory = TestBed.inject(AGENTIC_ACTIVE_PERSONA);
  const svc = TestBed.inject(CatalogIamService);
  return { svc, persona: personaFactory };
}

describe('CatalogIamService + AGENTIC_ACTIVE_PERSONA', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('falls back to defaultPersona before the resolve completes', () => {
    const fx = recordingFetch(async () => {
      await new Promise(() => { /* never resolves */ });
      return new Response('{}');
    });
    const { svc, persona } = setup({
      catalogUrl: 'https://catalog.example.com',
      getToken: () => mintToken({ tenant_id: 'acme', groups: ['eng'] }),
      defaultPersona: 'paralegal',
      fetchFn: fx.fn,
    });
    void svc.refresh();
    expect(persona()).toBe('paralegal');
  });

  it('updates the persona after a successful resolve', async () => {
    const fx = recordingFetch(() => new Response(JSON.stringify({
      runtimePersona: 'lead-counsel',
      matchedClaimValues: ['executives'],
      mappingId: '00000000-0000-0000-0000-000000000001',
      priority: 200,
    })));
    const { svc, persona } = setup({
      catalogUrl: 'https://catalog.example.com',
      getToken: () => mintToken({ tenant_id: 'acme', groups: ['executives'] }),
      defaultPersona: 'paralegal',
      fetchFn: fx.fn,
    });
    await svc.refresh();
    expect(persona()).toBe('lead-counsel');
    expect(fx.calls.length).toBeGreaterThanOrEqual(1);
    expect(fx.calls[fx.calls.length - 1]!.url)
      .toBe('https://catalog.example.com/v1/catalogs/acme/role-mappings/resolve');
  });

  it('falls back to defaultPersona on catalog HTTP failure', async () => {
    const fx = recordingFetch(() => new Response('boom', { status: 503 }));
    const { svc, persona } = setup({
      catalogUrl: 'https://catalog.example.com',
      getToken: () => mintToken({ tenant_id: 'acme', groups: ['eng'] }),
      defaultPersona: 'paralegal',
      fetchFn: fx.fn,
    });
    await svc.refresh();
    expect(persona()).toBe('paralegal');
  });

  it('falls back to defaultPersona when the JWT is malformed', async () => {
    const fx = recordingFetch(() => new Response(JSON.stringify({})));
    const { svc, persona } = setup({
      catalogUrl: 'https://catalog.example.com',
      getToken: () => 'not-a-jwt',
      defaultPersona: 'paralegal',
      fetchFn: fx.fn,
    });
    await svc.refresh();
    expect(persona()).toBe('paralegal');
    expect(fx.calls.length).toBe(0);
  });

  it('falls back to defaultPersona when resolve returns runtimePersona: null', async () => {
    const fx = recordingFetch(() => new Response(JSON.stringify({
      runtimePersona: null,
      matchedClaimValues: [],
      mappingId: null,
      priority: null,
    })));
    const { svc, persona } = setup({
      catalogUrl: 'https://catalog.example.com',
      getToken: () => mintToken({ tenant_id: 'acme', groups: ['unmapped'] }),
      defaultPersona: 'paralegal',
      fetchFn: fx.fn,
    });
    await svc.refresh();
    expect(persona()).toBe('paralegal');
  });

  it('honours an explicit tenantId override (function form)', async () => {
    const fx = recordingFetch(() => new Response(JSON.stringify({
      runtimePersona: 'paralegal', matchedClaimValues: [], mappingId: null, priority: null,
    })));
    const { svc } = setup({
      catalogUrl: 'https://catalog.example.com',
      getToken: () => mintToken({ groups: ['eng'] }),
      tenantId: () => 'override-tenant',
      defaultPersona: 'paralegal',
      fetchFn: fx.fn,
    });
    await svc.refresh();
    expect(fx.calls[0]!.url).toContain('/v1/catalogs/override-tenant/role-mappings/resolve');
  });

  it('uses a custom claimValuesExtractor', async () => {
    const fx = recordingFetch(() => new Response(JSON.stringify({
      runtimePersona: 'paralegal', matchedClaimValues: [], mappingId: null, priority: null,
    })));
    const { svc } = setup({
      catalogUrl: 'https://catalog.example.com',
      getToken: () => mintToken({
        tenant_id: 'acme',
        'https://my.idp/claims': { groups: ['nested-a', 'nested-b'] },
      }),
      claimPath: 'https://my.idp/claims',
      claimValuesExtractor: (payload, path) => {
        const obj = payload?.[path];
        if (obj && typeof obj === 'object' && Array.isArray((obj as { groups?: unknown }).groups)) {
          return (obj as { groups: string[] }).groups;
        }
        return [];
      },
      defaultPersona: 'paralegal',
      fetchFn: fx.fn,
    });
    await svc.refresh();
    const body = JSON.parse(fx.calls[0]!.init.body as string);
    expect(body.claimValues).toEqual(['nested-a', 'nested-b']);
  });

  it('the newer refresh wins — older results do not overwrite newer ones', async () => {
    let callCount = 0;
    const fx = recordingFetch(async () => {
      callCount++;
      // First call resolves slowly to "stale-old"; second resolves
      // promptly to "fresh-new". The service must reflect "fresh-new"
      // even though "stale-old" lands later in wall-clock terms.
      if (callCount === 1) {
        await new Promise((r) => setTimeout(r, 30));
        return new Response(JSON.stringify({
          runtimePersona: 'stale-old',
          matchedClaimValues: [],
          mappingId: null,
          priority: null,
        }));
      }
      return new Response(JSON.stringify({
        runtimePersona: 'fresh-new',
        matchedClaimValues: [],
        mappingId: null,
        priority: null,
      }));
    });
    const { svc, persona } = setup({
      catalogUrl: 'https://catalog.example.com',
      getToken: () => mintToken({ tenant_id: 'acme', groups: ['eng'] }),
      defaultPersona: 'paralegal',
      fetchFn: fx.fn,
    });
    const first = svc.refresh();
    const second = svc.refresh();
    await Promise.all([first, second]);
    // Allow the slow "stale-old" response to land, then verify it
    // did NOT clobber the newer one.
    await new Promise((r) => setTimeout(r, 60));
    expect(persona()).toBe('fresh-new');
  });
});
