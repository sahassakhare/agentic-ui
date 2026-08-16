import { describe, expect, it } from 'vitest';
import { buildTree, flattenTree, normalizeDepths, type NavRow } from './application-nav';

describe('flattenTree / buildTree round-trip', () => {
  it('flattens a nested tree into depth-tagged rows', () => {
    const rows = flattenTree([
      { title: 'Home', path: 'home', page: 'home-page' },
      {
        title: 'Reports', path: 'reports', page: 'reports-page',
        children: [
          { title: 'Monthly', path: 'monthly', page: 'monthly-page' },
          { title: 'Yearly', path: 'yearly', page: 'yearly-page' },
        ],
      },
    ]);
    expect(rows.map((r) => [r.title, r.depth])).toEqual([
      ['Home', 0], ['Reports', 0], ['Monthly', 1], ['Yearly', 1],
    ]);
  });

  it('rebuilds the nested tree from flat rows + depth', () => {
    const rows: NavRow[] = [
      { title: 'Home', path: 'home', page: 'home-page', depth: 0 },
      { title: 'Reports', path: 'reports', page: 'reports-page', depth: 0 },
      { title: 'Monthly', path: 'monthly', page: 'monthly-page', depth: 1 },
    ];
    const tree = buildTree(rows);
    expect(tree).toHaveLength(2);
    expect(tree[1].title).toBe('Reports');
    expect(tree[1].children?.map((c) => c.title)).toEqual(['Monthly']);
    // order assigned per sibling group
    expect(tree[0].order).toBe(10);
    expect(tree[1].order).toBe(20);
    expect(tree[1].children?.[0].order).toBe(10);
  });

  it('is a stable round-trip (tree → rows → tree)', () => {
    const tree = [
      { title: 'A', path: 'a', page: 'a', order: 10, children: [{ title: 'B', path: 'b', page: 'b', order: 10 }] },
    ];
    expect(buildTree(flattenTree(tree))).toEqual(tree);
  });

  it('carries icon + personas through the round-trip', () => {
    const rows: NavRow[] = [
      { title: 'Ops', path: 'ops', page: 'ops', depth: 0, icon: '📊', personas: ['admin', 'ops'] },
    ];
    const tree = buildTree(rows);
    expect(tree[0].icon).toBe('📊');
    expect(tree[0].personas).toEqual(['admin', 'ops']);
    // empty personas/icon drop out (undefined, not empty)
    expect(buildTree([{ title: 'X', path: 'x', page: 'x', depth: 0, personas: [] }])[0].personas).toBeUndefined();
  });
});

describe('normalizeDepths', () => {
  it('forces the first row to depth 0 and clamps jumps to +1', () => {
    const rows: NavRow[] = [
      { title: 'A', path: 'a', page: 'a', depth: 3 },   // first → clamped to 0
      { title: 'B', path: 'b', page: 'b', depth: 5 },   // → 1 (prev+1)
      { title: 'C', path: 'c', page: 'c', depth: 1 },   // → 1 ok
      { title: 'D', path: 'd', page: 'd', depth: -2 },  // → 0
    ];
    normalizeDepths(rows);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 0]);
  });
});
