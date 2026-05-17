import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { of } from 'rxjs';
import { TopologyComponent } from './topology.component';
import {
  CatalogClientService,
  type Capability,
  type MfeRemote,
} from '../services/catalog-client.service';
import {
  CatalogStreamService,
  type CatalogMutationEvent,
} from '../services/catalog-stream.service';
import { provideRouter } from '@angular/router';

class StubStreamService {
  private listeners: ((e: CatalogMutationEvent) => void)[] = [];
  state = vi.fn(() => 'live' as const);
  isLive = vi.fn(() => true);
  onMutation(handler: (e: CatalogMutationEvent) => void): () => void {
    this.listeners.push(handler);
    return () => { this.listeners = this.listeners.filter((h) => h !== handler); };
  }
  fire(e: CatalogMutationEvent): void { for (const h of this.listeners) h(e); }
}

function makeCapability(overrides: Partial<Capability> = {}): Capability {
  return {
    id: 'cap-' + Math.random().toString(36).slice(2),
    tenantId: 'demo',
    kind: 'tool',
    name: 'sample-tool',
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

function makeMfe(overrides: Partial<MfeRemote> = {}): MfeRemote {
  return {
    id: 'mfe-' + Math.random().toString(36).slice(2),
    tenantId: 'demo',
    name: 'demo-remote',
    manifestUrl: 'https://demo.example.com/remoteEntry.json',
    version: '1.0.0',
    requiredHostVersion: null,
    exposes: { tools: ['t1', 't2'] },
    status: 'active',
    lastHealthAt: '2026-05-10T00:00:00Z',
    ...overrides,
  };
}

describe('TopologyComponent', () => {
  let stubStream: StubStreamService;
  let capListSpy: ReturnType<typeof vi.fn>;
  let mfeListSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stubStream = new StubStreamService();
    capListSpy = vi.fn();
    mfeListSpy = vi.fn();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: CatalogStreamService, useValue: stubStream },
        {
          provide: CatalogClientService,
          useValue: {
            listCapabilities: capListSpy,
            listMfes: mfeListSpy,
          },
        },
      ],
    });
  });

  it('groups capabilities into Host-direct + per-MFE buckets, with kind sub-grouping', async () => {
    capListSpy.mockReturnValue(of({
      items: [
        makeCapability({ name: 'addCustodian', kind: 'tool', body: { source: 'host' } }),
        makeCapability({ name: 'custodianCard', kind: 'component', body: { source: 'host' } }),
        makeCapability({ name: 'searchDocuments', kind: 'tool', body: { source: 'demo-remote' } }),
        makeCapability({ name: 'searchPanel', kind: 'component', body: { source: 'demo-remote' } }),
      ],
      total: 4,
      limit: 1000,
      offset: 0,
    }));
    mfeListSpy.mockReturnValue(of({ items: [makeMfe({ name: 'demo-remote' })] }));

    const fixture = TestBed.createComponent(TopologyComponent);
    await fixture.whenStable();
    const t = (fixture.componentInstance as unknown as { topology: () => { groups: Array<{ label: string; totalCount: number; capabilitiesByKind: Record<string, unknown[]> }>; totalCapabilities: number; totalMfes: number; hostCapabilities: number } | null }).topology();

    expect(t).not.toBeNull();
    expect(t!.totalCapabilities).toBe(4);
    expect(t!.totalMfes).toBe(1);
    expect(t!.hostCapabilities).toBe(2);
    expect(t!.groups.length).toBe(2);

    const host = t!.groups[0]!;
    expect(host.label).toBe('Host-direct');
    expect(host.totalCount).toBe(2);
    expect(Object.keys(host.capabilitiesByKind).sort()).toEqual(['component', 'tool']);

    const remote = t!.groups[1]!;
    expect(remote.label).toBe('demo-remote');
    expect(remote.totalCount).toBe(2);
    expect(Object.keys(remote.capabilitiesByKind).sort()).toEqual(['component', 'tool']);
  });

  it('surfaces orphan capabilities (source not matching any registered MFE) explicitly', async () => {
    capListSpy.mockReturnValue(of({
      items: [
        makeCapability({ name: 'host-cap', body: { source: 'host' } }),
        makeCapability({ name: 'orphan-cap', body: { source: 'unknown-remote' } }),
      ],
      total: 2, limit: 1000, offset: 0,
    }));
    mfeListSpy.mockReturnValue(of({ items: [] }));

    const fixture = TestBed.createComponent(TopologyComponent);
    await fixture.whenStable();
    const t = (fixture.componentInstance as unknown as { topology: () => { groups: Array<{ label: string; totalCount: number }> } | null }).topology()!;

    expect(t.groups.find((g) => g.label === 'Orphan: unknown-remote')).toBeDefined();
    expect(t.groups.find((g) => g.label === 'Host-direct')).toBeDefined();
  });

  it('lifecycle filter narrows the visible capability set', async () => {
    capListSpy.mockReturnValue(of({
      items: [
        makeCapability({ name: 'live', lifecycle: 'published' }),
        makeCapability({ name: 'gone', lifecycle: 'disabled' }),
      ],
      total: 2, limit: 1000, offset: 0,
    }));
    mfeListSpy.mockReturnValue(of({ items: [] }));

    const fixture = TestBed.createComponent(TopologyComponent);
    await fixture.whenStable();
    const cmp = fixture.componentInstance as unknown as {
      lifecycleFilter: { set: (v: 'all' | 'published' | 'draft' | 'deprecated' | 'disabled') => void };
      topology: () => { totalCapabilities: number } | null;
    };

    expect(cmp.topology()!.totalCapabilities).toBe(2);
    cmp.lifecycleFilter.set('disabled');
    expect(cmp.topology()!.totalCapabilities).toBe(1);
    cmp.lifecycleFilter.set('published');
    expect(cmp.topology()!.totalCapabilities).toBe(1);
  });

  it('falls back to source=host when capability.body.source is missing (legacy seed rows)', async () => {
    capListSpy.mockReturnValue(of({
      items: [
        // No body.source field at all — pre-registrar seed shape.
        makeCapability({ name: 'legacy', body: {} }),
      ],
      total: 1, limit: 1000, offset: 0,
    }));
    mfeListSpy.mockReturnValue(of({ items: [] }));

    const fixture = TestBed.createComponent(TopologyComponent);
    await fixture.whenStable();
    const t = (fixture.componentInstance as unknown as { topology: () => { groups: Array<{ label: string; totalCount: number }> } | null }).topology()!;

    const host = t.groups.find((g) => g.label === 'Host-direct');
    expect(host?.totalCount).toBe(1);
  });
});
