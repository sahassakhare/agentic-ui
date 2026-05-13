import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { PlaybookRegistry } from './playbook-registry';
import type { PlaybookDef } from '../types/registry-defs';

function makePlaybook(name: string, overrides: Partial<PlaybookDef> = {}): PlaybookDef {
  return {
    name,
    title: `Playbook ${name}`,
    steps: [],
    ...overrides,
  };
}

describe('PlaybookRegistry', () => {
  it('register + list preserves insertion order', () => {
    TestBed.configureTestingModule({});
    const reg = TestBed.inject(PlaybookRegistry);
    reg.register(makePlaybook('initial-privilege-pass'));
    reg.register(makePlaybook('production-prep'));
    expect(reg.list().map((p) => p.name)).toEqual(['initial-privilege-pass', 'production-prep']);
  });

  it('setScopePolicy filters list() reads per persona', () => {
    TestBed.configureTestingModule({});
    const reg = TestBed.inject(PlaybookRegistry);
    reg.register({ ...makePlaybook('public'), scopes: ['paralegal', 'partner', 'gc'] });
    reg.register({ ...makePlaybook('restricted'), scopes: ['gc'] });
    reg.setScopePolicy((entry) => (entry.scopes ?? []).includes('paralegal'));
    expect(reg.list().map((p) => p.name)).toEqual(['public']);
  });

  it('removeBySource symmetry on MFE source', () => {
    TestBed.configureTestingModule({});
    const reg = TestBed.inject(PlaybookRegistry);
    reg.register({ ...makePlaybook('host-pb'), source: 'host' });
    reg.register({ ...makePlaybook('mfe-pb-1'), source: 'remote:production' });
    reg.register({ ...makePlaybook('mfe-pb-2'), source: 'remote:production' });
    reg.removeBySource('remote:production');
    expect(reg.list().map((p) => p.name)).toEqual(['host-pb']);
  });

  it('preserves version + parentVersion + governance metadata', () => {
    TestBed.configureTestingModule({});
    const reg = TestBed.inject(PlaybookRegistry);
    reg.register({
      ...makePlaybook('initial-privilege-pass'),
      version: 'v3',
      parentVersion: 'v2',
      lifecycle: 'published',
      owner: 'legal-ops',
    });
    const got = reg.list()[0]!;
    expect(got.version).toBe('v3');
    expect(got.parentVersion).toBe('v2');
    expect(got.lifecycle).toBe('published');
    expect(got.owner).toBe('legal-ops');
  });
});
