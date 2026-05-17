import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { DashboardRegistry } from './dashboard-registry';
import type { DashboardDef } from '../types/registry-defs';

function makeDashboard(name: string, overrides: Partial<DashboardDef> = {}): DashboardDef {
  return {
    name,
    title: `Dashboard ${name}`,
    layout: 'dashboard-1col',
    tiles: [],
    ...overrides,
  };
}

describe('DashboardRegistry', () => {
  it('registers + lists in insertion order', () => {
    TestBed.configureTestingModule({});
    const reg = TestBed.inject(DashboardRegistry);
    reg.register(makeDashboard('production-throughput'));
    reg.register(makeDashboard('reviewer-productivity'));
    expect(reg.list().map((d) => d.name)).toEqual([
      'production-throughput',
      'reviewer-productivity',
    ]);
  });

  it('honours setScopePolicy — junior reviewer sees fewer dashboards', () => {
    TestBed.configureTestingModule({});
    const reg = TestBed.inject(DashboardRegistry);
    reg.register({ ...makeDashboard('matter-health'), scopes: ['paralegal', 'partner', 'gc'] });
    reg.register({ ...makeDashboard('audit-integrity'), scopes: ['gc'] });
    reg.setScopePolicy((entry) => (entry.scopes ?? []).includes('paralegal'));
    expect(reg.list().map((d) => d.name)).toEqual(['matter-health']);
  });

  it('removeBySource symmetry (MFE template unload)', () => {
    TestBed.configureTestingModule({});
    const reg = TestBed.inject(DashboardRegistry);
    reg.register({ ...makeDashboard('user-saved'), source: 'host' });
    reg.register({ ...makeDashboard('production-throughput'), source: 'remote:production' });
    reg.register({ ...makeDashboard('production-quality'), source: 'remote:production' });
    reg.removeBySource('remote:production');
    expect(reg.list().map((d) => d.name)).toEqual(['user-saved']);
  });

  it('preserves version + parentVersion + lifecycle metadata', () => {
    TestBed.configureTestingModule({});
    const reg = TestBed.inject(DashboardRegistry);
    reg.register({
      ...makeDashboard('matter-health'),
      version: 'v3',
      parentVersion: 'v2',
      lifecycle: 'published',
      owner: 'paralegal-team',
    });
    const got = reg.list()[0]!;
    expect(got.version).toBe('v3');
    expect(got.parentVersion).toBe('v2');
    expect(got.lifecycle).toBe('published');
    expect(got.owner).toBe('paralegal-team');
  });
});
