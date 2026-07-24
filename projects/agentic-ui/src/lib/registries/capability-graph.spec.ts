import { describe, expect, it } from 'vitest';
import {
  capabilityNodeId,
  createCapabilityLookup,
  resolveCapabilityGraph,
  type RootCapability,
} from './capability-graph';
import type { RegistryEntry } from '../types/registry-defs';

function entry(name: string, extra: Partial<RegistryEntry> = {}): RegistryEntry {
  return { name, ...extra };
}

/** Build a lookup over kind → entries maps. */
function lookupFrom(map: Record<string, RegistryEntry[]>) {
  return createCapabilityLookup(
    Object.entries(map).map(([kind, entries]) => ({ kind, entries: () => entries })),
  );
}

describe('resolveCapabilityGraph', () => {
  it('a leaf capability yields just the root node, no edges', () => {
    const root: RootCapability = { kind: 'experience', entry: entry('legalIntake') };
    const graph = resolveCapabilityGraph(root, lookupFrom({}));

    expect(graph.root).toBe('experience:legalIntake');
    expect(graph.nodes.map((n) => n.id)).toEqual(['experience:legalIntake']);
    expect(graph.edges).toEqual([]);
    expect(graph.unmet).toEqual([]);
    expect(graph.cycles).toEqual([]);
  });

  it('resolves a required dependency by exact name', () => {
    const root: RootCapability = {
      kind: 'experience',
      entry: entry('legalIntake', {
        requires: [{ kind: 'form', name: 'customerSearch', reason: 'pick a party' }],
      }),
    };
    const graph = resolveCapabilityGraph(root, lookupFrom({ form: [entry('customerSearch')] }));

    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['experience:legalIntake', 'form:customerSearch']);
    expect(graph.edges).toEqual([
      { from: 'experience:legalIntake', to: 'form:customerSearch', optional: false, reason: 'pick a party', viaTag: undefined },
    ]);
    expect(graph.unmet).toEqual([]);
    expect(graph.nodes.find((n) => n.id === 'form:customerSearch')?.depth).toBe(1);
  });

  it('records a required-but-missing dependency as unmet + a null placeholder node', () => {
    const root: RootCapability = {
      kind: 'experience',
      entry: entry('legalIntake', { requires: [{ kind: 'tool', name: 'conflictCheck' }] }),
    };
    const graph = resolveCapabilityGraph(root, lookupFrom({}));

    expect(graph.unmet).toEqual([
      { from: 'experience:legalIntake', requirement: { kind: 'tool', name: 'conflictCheck' } },
    ]);
    const placeholder = graph.nodes.find((n) => n.id === 'tool:conflictCheck');
    expect(placeholder?.entry).toBeNull();
    expect(graph.edges[0]).toMatchObject({ from: 'experience:legalIntake', to: 'tool:conflictCheck', optional: false });
  });

  it('skips optional missing dependencies (no unmet, no node)', () => {
    const root: RootCapability = {
      kind: 'experience',
      entry: entry('legalIntake', { requires: [{ kind: 'tool', name: 'aiSummary', optional: true }] }),
    };
    const graph = resolveCapabilityGraph(root, lookupFrom({}));

    expect(graph.unmet).toEqual([]);
    expect(graph.nodes.map((n) => n.id)).toEqual(['experience:legalIntake']);
    expect(graph.edges).toEqual([]);
  });

  it('late-binds by tag to multiple implementations', () => {
    const root: RootCapability = {
      kind: 'experience',
      entry: entry('search', { requires: [{ kind: 'component', tag: 'result-card' }] }),
    };
    const graph = resolveCapabilityGraph(
      root,
      lookupFrom({
        component: [
          entry('customerCard', { tags: ['result-card'] }),
          entry('matterCard', { tags: ['result-card'] }),
          entry('unrelated', { tags: ['sidebar'] }),
        ],
      }),
    );

    const targets = graph.edges.map((e) => e.to).sort();
    expect(targets).toEqual(['component:customerCard', 'component:matterCard']);
    expect(graph.edges.every((e) => e.viaTag === 'result-card')).toBe(true);
  });

  it('traverses transitive dependencies and orders dependencies before dependents', () => {
    // experience → tool:conflictCheck → dataSource:customerEntity
    const root: RootCapability = {
      kind: 'experience',
      entry: entry('legalIntake', { requires: [{ kind: 'tool', name: 'conflictCheck' }] }),
    };
    const graph = resolveCapabilityGraph(
      root,
      lookupFrom({
        tool: [entry('conflictCheck', { requires: [{ kind: 'dataSource', name: 'customerEntity' }] })],
        dataSource: [entry('customerEntity')],
      }),
    );

    expect(graph.nodes.map((n) => n.id).sort()).toEqual([
      'dataSource:customerEntity',
      'experience:legalIntake',
      'tool:conflictCheck',
    ]);
    // dependency must come before dependent in topological order
    const order = graph.order;
    expect(order.indexOf('dataSource:customerEntity')).toBeLessThan(order.indexOf('tool:conflictCheck'));
    expect(order.indexOf('tool:conflictCheck')).toBeLessThan(order.indexOf('experience:legalIntake'));
  });

  it('detects a cycle and still terminates', () => {
    // a → b → a
    const root: RootCapability = {
      kind: 'tool',
      entry: entry('a', { requires: [{ kind: 'tool', name: 'b' }] }),
    };
    const graph = resolveCapabilityGraph(
      root,
      lookupFrom({ tool: [entry('a', { requires: [{ kind: 'tool', name: 'b' }] }), entry('b', { requires: [{ kind: 'tool', name: 'a' }] })] }),
    );

    expect(graph.cycles.length).toBeGreaterThan(0);
    expect(graph.cycles[0]).toContain('tool:a');
    expect(graph.cycles[0]).toContain('tool:b');
  });

  it('name wins when both name and tag are set', () => {
    const root: RootCapability = {
      kind: 'experience',
      entry: entry('x', { requires: [{ kind: 'form', name: 'exact', tag: 'ignored' }] }),
    };
    const graph = resolveCapabilityGraph(
      root,
      lookupFrom({ form: [entry('exact', { tags: [] }), entry('tagged', { tags: ['ignored'] })] }),
    );

    expect(graph.edges.map((e) => e.to)).toEqual(['form:exact']);
    expect(graph.edges[0].viaTag).toBeUndefined();
  });

  it('respects maxDepth', () => {
    const chain = lookupFrom({
      tool: [
        entry('t0', { requires: [{ kind: 'tool', name: 't1' }] }),
        entry('t1', { requires: [{ kind: 'tool', name: 't2' }] }),
        entry('t2', { requires: [{ kind: 'tool', name: 't3' }] }),
        entry('t3'),
      ],
    });
    const root: RootCapability = { kind: 'tool', entry: entry('t0', { requires: [{ kind: 'tool', name: 't1' }] }) };
    const graph = resolveCapabilityGraph(root, chain, { maxDepth: 2 });

    // depth 0 (t0) and depth 1 (t1) processed; t1's children not expanded past maxDepth
    expect(graph.nodes.some((n) => n.id === 'tool:t3')).toBe(false);
  });

  it('capabilityNodeId composes kind and name', () => {
    expect(capabilityNodeId('tool', 'foo')).toBe('tool:foo');
  });
});
