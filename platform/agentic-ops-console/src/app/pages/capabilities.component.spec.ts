import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { CapabilitiesComponent } from './capabilities.component';
import {
  CatalogClientService,
  type Capability,
  type CapabilitySearchHit,
} from '../services/catalog-client.service';
import {
  CatalogStreamService,
  type CatalogMutationEvent,
} from '../services/catalog-stream.service';
import { AutoRefreshService } from '../services/auto-refresh.service';

class StubStreamService {
  state = vi.fn(() => 'live' as const);
  isLive = vi.fn(() => true);
  onMutation(_h: (e: CatalogMutationEvent) => void): () => void { return () => {}; }
}

class StubAutoRefresh {
  setEnabled = vi.fn();
  register(_h: () => void): () => void { return () => {}; }
}

function makeCap(overrides: Partial<Capability> = {}): Capability {
  return {
    id: 'cap-' + Math.random().toString(36).slice(2),
    tenantId: 'demo',
    kind: 'tool',
    name: 'sample',
    body: { source: 'host' },
    lifecycle: 'published',
    owner: null,
    tags: [],
    requiredHostVersion: null,
    createdAt: '2026-05-10T00:00:00Z',
    updatedAt: '2026-05-10T00:00:00Z',
    createdBy: 'tester',
    softDeletedAt: null,
    ...overrides,
  };
}

describe('CapabilitiesComponent — SEM-B search flow', () => {
  let listSpy: ReturnType<typeof vi.fn>;
  let searchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listSpy = vi.fn().mockReturnValue(of({ items: [], total: 0, limit: 100, offset: 0 }));
    searchSpy = vi.fn();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: CatalogStreamService, useClass: StubStreamService },
        { provide: AutoRefreshService, useClass: StubAutoRefresh },
        {
          provide: CatalogClientService,
          useValue: {
            listCapabilities: listSpy,
            searchCapabilities: searchSpy,
          },
        },
      ],
    });
  });

  it('runSearch with a successful response populates searchHits + searchProvider', async () => {
    const hits: CapabilitySearchHit[] = [
      { ...makeCap({ name: 'addCustodian', kind: 'tool' }), _score: 0.91 },
      { ...makeCap({ name: 'redactDocument', kind: 'tool' }), _score: 0.84 },
    ];
    searchSpy.mockReturnValue(of({ items: hits, query: 'legal docs', kind: null, topK: 50, provider: 'openai' }));

    const fixture = TestBed.createComponent(CapabilitiesComponent);
    const cmp = fixture.componentInstance;
    cmp.searchQuery.set('legal docs');
    cmp.runSearch();
    await fixture.whenStable();

    expect(searchSpy).toHaveBeenCalledOnce();
    const args = searchSpy.mock.calls[0]![0];
    expect(args.q).toBe('legal docs');
    expect(args.topK).toBe(50);
    expect(cmp.searchHits()?.length).toBe(2);
    expect(cmp.searchHits()?.[0]?.name).toBe('addCustodian');
    expect(cmp.searchProvider()).toBe('openai');
    expect(cmp.searchInfo()).toBeNull();
    expect(cmp.searching()).toBe(false);
  });

  it('runSearch with 422 (not configured) sets searchInfo + leaves searchHits null', async () => {
    searchSpy.mockReturnValue(throwError(() => ({
      status: 422,
      error: { detail: 'Semantic search is not configured. Set EMBEDDING_PROVIDER=...' },
    })));

    const fixture = TestBed.createComponent(CapabilitiesComponent);
    const cmp = fixture.componentInstance;
    cmp.searchQuery.set('any query');
    cmp.runSearch();
    await fixture.whenStable();

    expect(cmp.searchHits()).toBeNull();
    expect(cmp.searchProvider()).toBeNull();
    expect(cmp.searchInfo()).toMatch(/Semantic search is not configured/);
    expect(cmp.error()).toBeNull(); // 422 doesn't go to top-level error banner
  });

  it('runSearch with 503 (provider unreachable) surfaces a transient-error message', async () => {
    searchSpy.mockReturnValue(throwError(() => ({
      status: 503,
      error: { detail: 'OpenAI 429 rate limited' },
    })));

    const fixture = TestBed.createComponent(CapabilitiesComponent);
    const cmp = fixture.componentInstance;
    cmp.searchQuery.set('any');
    cmp.runSearch();
    await fixture.whenStable();

    expect(cmp.searchHits()).toBeNull();
    expect(cmp.searchInfo()).toMatch(/Embedding provider unreachable/);
    expect(cmp.searchInfo()).toMatch(/rate limited/);
  });

  it('runSearch with 500 surfaces to the top-level error banner (not the search-info)', async () => {
    searchSpy.mockReturnValue(throwError(() => ({
      status: 500,
      error: { detail: 'internal' },
    })));

    const fixture = TestBed.createComponent(CapabilitiesComponent);
    const cmp = fixture.componentInstance;
    cmp.searchQuery.set('any');
    cmp.runSearch();
    await fixture.whenStable();

    expect(cmp.error()).toMatch(/Search failed/);
    expect(cmp.searchInfo()).toBeNull();
  });

  it('runSearch with empty query is a no-op (clears any prior search)', async () => {
    const fixture = TestBed.createComponent(CapabilitiesComponent);
    const cmp = fixture.componentInstance;
    // Seed prior state
    cmp.searchHits.set([{ ...makeCap(), _score: 0.5 }]);
    cmp.searchProvider.set('openai');
    cmp.searchQuery.set('   ');
    cmp.runSearch();
    expect(searchSpy).not.toHaveBeenCalled();
    expect(cmp.searchHits()).toBeNull();
    expect(cmp.searchProvider()).toBeNull();
  });

  it('clearSearch() resets all search state', () => {
    const fixture = TestBed.createComponent(CapabilitiesComponent);
    const cmp = fixture.componentInstance;
    cmp.searchQuery.set('test');
    cmp.searchHits.set([{ ...makeCap(), _score: 0.5 }]);
    cmp.searchProvider.set('cohere');
    cmp.searchInfo.set('something');
    cmp.lastQuery.set('test');

    cmp.clearSearch();

    expect(cmp.searchQuery()).toBe('');
    expect(cmp.searchHits()).toBeNull();
    expect(cmp.searchProvider()).toBeNull();
    expect(cmp.searchInfo()).toBeNull();
    expect(cmp.lastQuery()).toBe('');
  });
});
