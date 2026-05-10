import { describe, expect, it } from 'vitest';
import { buildGraphElements } from './topology-graph.component';
import type { Capability, MfeRemote } from '../services/catalog-client.service';

function makeCap(overrides: Partial<Capability> = {}): Capability {
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
    exposes: { tools: [] },
    status: 'active',
    lastHealthAt: '2026-05-10T00:00:00Z',
    ...overrides,
  };
}

describe('buildGraphElements', () => {
  it('emits one group node per source bucket + parent-child edges to capability nodes', () => {
    const caps = [
      makeCap({ name: 't1', body: { source: 'host' } }),
      makeCap({ name: 't2', body: { source: 'host' } }),
      makeCap({ name: 't3', body: { source: 'demo-remote' } }),
    ];
    const mfes = [makeMfe({ name: 'demo-remote' })];

    const els = buildGraphElements(caps, mfes, 'all');

    const groups = els.filter((e) => e.data['kind'] === 'group');
    expect(groups.map((g) => g.data['id']).sort()).toEqual(['group:demo-remote', 'group:host']);

    const nodes = els.filter((e) => e.data['kind'] === 'capability');
    expect(nodes).toHaveLength(3);
    // Every capability node has a parent matching its source-group.
    const hostCaps = nodes.filter((n) => n.data['parent'] === 'group:host');
    expect(hostCaps.map((n) => n.data['label']).sort()).toEqual(['t1', 't2']);
    const remoteCaps = nodes.filter((n) => n.data['parent'] === 'group:demo-remote');
    expect(remoteCaps.map((n) => n.data['label'])).toEqual(['t3']);
  });

  it('encodes lifecycle as color and kind as shape on each capability node', () => {
    const caps = [
      makeCap({ name: 'live', kind: 'tool', lifecycle: 'published' }),
      makeCap({ name: 'gone', kind: 'component', lifecycle: 'disabled' }),
      makeCap({ name: 'old', kind: 'form', lifecycle: 'deprecated' }),
    ];
    const els = buildGraphElements(caps, [], 'all');
    const byName = Object.fromEntries(
      els.filter((e) => e.data['kind'] === 'capability').map((n) => [n.data['label'], n.data]),
    );
    expect(byName['live']!['color']).toBe('#16a34a');     // green
    expect(byName['live']!['shape']).toBe('ellipse');     // tool
    expect(byName['gone']!['color']).toBe('#dc2626');     // red
    expect(byName['gone']!['shape']).toBe('hexagon');     // component
    expect(byName['old']!['color']).toBe('#94a3b8');      // grey
    expect(byName['old']!['shape']).toBe('diamond');      // form
  });

  it('lifecycle filter narrows to only matching capabilities', () => {
    const caps = [
      makeCap({ name: 'live', lifecycle: 'published' }),
      makeCap({ name: 'gone', lifecycle: 'disabled' }),
    ];
    const els = buildGraphElements(caps, [], 'disabled');
    const capNodes = els.filter((e) => e.data['kind'] === 'capability');
    expect(capNodes).toHaveLength(1);
    expect(capNodes[0]!.data['label']).toBe('gone');
  });

  it('surfaces orphan capabilities with `Orphan: <source>` group label', () => {
    const caps = [
      makeCap({ name: 'host-cap', body: { source: 'host' } }),
      makeCap({ name: 'orphan-1', body: { source: 'unknown-remote' } }),
      makeCap({ name: 'orphan-2', body: { source: 'unknown-remote' } }),
    ];
    const els = buildGraphElements(caps, [], 'all');

    const orphanGroup = els.find((e) => e.data['id'] === 'group:orphan:unknown-remote');
    expect(orphanGroup).toBeDefined();
    expect(orphanGroup!.data['label']).toMatch(/Orphan: unknown-remote/);

    const orphanCaps = els.filter((e) => e.data['parent'] === 'group:orphan:unknown-remote');
    expect(orphanCaps).toHaveLength(2);
  });

  it('still emits Host-direct group when filter=all even if no host caps match', () => {
    const caps = [
      makeCap({ name: 'remote-only', body: { source: 'demo-remote' } }),
    ];
    const els = buildGraphElements(caps, [makeMfe({ name: 'demo-remote' })], 'all');
    const hostGroup = els.find((e) => e.data['id'] === 'group:host');
    expect(hostGroup).toBeDefined();
    expect(hostGroup!.data['label']).toMatch(/Host-direct \(0\)/);
  });

  it('falls back to source=host when capability.body.source is missing (legacy seed rows)', () => {
    const caps = [makeCap({ name: 'legacy', body: {} })];
    const els = buildGraphElements(caps, [], 'all');
    const cap = els.find((e) => e.data['kind'] === 'capability');
    expect(cap?.data['parent']).toBe('group:host');
  });

  it('encodes MFE status into group border color', () => {
    const caps = [makeCap({ body: { source: 'red-remote' } })];
    const mfes = [
      makeMfe({ name: 'red-remote', status: 'inactive' }),
    ];
    const els = buildGraphElements(caps, mfes, 'all');
    const group = els.find((e) => e.data['id'] === 'group:red-remote');
    expect(group?.data['borderColor']).toBe('#f85149'); // inactive → red
  });

  it('preserves NodeMeta on each node so the side panel can resolve the underlying entity', () => {
    const cap = makeCap({ name: 'metad' });
    const mfe = makeMfe({ name: 'meta-remote' });
    const els = buildGraphElements([cap], [mfe], 'all');

    const capNode = els.find((e) => e.data['kind'] === 'capability');
    const meta = capNode?.data['meta'];
    expect(meta).toBeDefined();
    expect((meta as { kind: string }).kind).toBe('capability');
    expect((meta as { capability: Capability }).capability.id).toBe(cap.id);

    const mfeGroup = els.find((e) => e.data['id'] === 'group:meta-remote');
    const groupMeta = mfeGroup?.data['meta'];
    expect((groupMeta as { kind: string }).kind).toBe('group');
    expect((groupMeta as { mfe: MfeRemote | null }).mfe?.name).toBe('meta-remote');
  });
});
