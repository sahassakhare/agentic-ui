import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  ChatShellMode,
  LayoutDensity,
  LAYOUT_POLICY,
} from '../layout/types';
import { provideLayoutPolicy } from './provide-layout-policy';

describe('provideLayoutPolicy — single policy', () => {
  it('uses the supplied shellMode + density', () => {
    TestBed.configureTestingModule({
      providers: [
        provideLayoutPolicy({
          shellMode: (route): ChatShellMode =>
            route.startsWith('/holds') ? 'pill' : 'rail',
          density: (): LayoutDensity => 'compact',
        }),
      ],
    });
    const policy = TestBed.inject(LAYOUT_POLICY);
    expect(policy.shellMode('/holds')).toBe('pill');
    expect(policy.shellMode('/documents')).toBe('rail');
    expect(policy.density()).toBe('compact');
  });

  it('falls back to defaults when shellMode/density are omitted', () => {
    TestBed.configureTestingModule({
      providers: [
        provideLayoutPolicy({ workspaceLayout: () => 'review-workbench' }),
      ],
    });
    const policy = TestBed.inject(LAYOUT_POLICY);
    expect(policy.shellMode('/anywhere')).toBe('rail');
    expect(policy.density()).toBe('comfortable');
    expect(policy.workspaceLayout?.('/documents/123')).toBe('review-workbench');
  });

  it('exposes workspaceLayout when supplied', () => {
    TestBed.configureTestingModule({
      providers: [
        provideLayoutPolicy({
          workspaceLayout: (route) =>
            route.startsWith('/documents/') ? 'review-workbench' : null,
        }),
      ],
    });
    const policy = TestBed.inject(LAYOUT_POLICY);
    expect(policy.workspaceLayout?.('/documents/doc-1')).toBe('review-workbench');
    expect(policy.workspaceLayout?.('/audit')).toBeNull();
  });
});

describe('provideLayoutPolicy — per-persona', () => {
  it('dispatches to the persona-matched entry', () => {
    let persona: string | null = 'paralegal';
    TestBed.configureTestingModule({
      providers: [
        provideLayoutPolicy({
          resolvePersona: () => persona,
          byPersona: {
            paralegal: {
              shellMode: (r) => (r.startsWith('/holds') ? 'pill' : 'rail'),
              density: () => 'comfortable',
            },
            partner: {
              shellMode: () => 'rail',
              density: () => 'compact',
            },
          },
        }),
      ],
    });
    const policy = TestBed.inject(LAYOUT_POLICY);

    expect(policy.shellMode('/holds')).toBe('pill');
    expect(policy.density()).toBe('comfortable');

    persona = 'partner';
    expect(policy.shellMode('/holds')).toBe('rail');
    expect(policy.density()).toBe('compact');
  });

  it('uses fallback when resolvePersona returns null', () => {
    TestBed.configureTestingModule({
      providers: [
        provideLayoutPolicy({
          resolvePersona: () => null,
          byPersona: {
            partner: { shellMode: () => 'rail', density: () => 'compact' },
          },
          fallback: { shellMode: () => 'overlay', density: () => 'dense' },
        }),
      ],
    });
    const policy = TestBed.inject(LAYOUT_POLICY);
    expect(policy.shellMode('/anywhere')).toBe('overlay');
    expect(policy.density()).toBe('dense');
  });

  it('returns DEFAULT_LAYOUT_POLICY when no match + no fallback', () => {
    TestBed.configureTestingModule({
      providers: [
        provideLayoutPolicy({
          resolvePersona: () => 'unknown-persona',
          byPersona: {
            partner: { shellMode: () => 'rail', density: () => 'compact' },
          },
        }),
      ],
    });
    const policy = TestBed.inject(LAYOUT_POLICY);
    expect(policy.shellMode('/x')).toBe('rail');
    expect(policy.density()).toBe('comfortable');
  });

  it('re-evaluates persona on every read (no caching)', () => {
    let persona = 'paralegal';
    TestBed.configureTestingModule({
      providers: [
        provideLayoutPolicy({
          resolvePersona: () => persona,
          byPersona: {
            paralegal: { density: () => 'comfortable' },
            reviewer: { density: () => 'dense' },
          },
        }),
      ],
    });
    const policy = TestBed.inject(LAYOUT_POLICY);
    expect(policy.density()).toBe('comfortable');
    persona = 'reviewer';
    expect(policy.density()).toBe('dense');
    persona = 'paralegal';
    expect(policy.density()).toBe('comfortable');
  });
});

describe('LAYOUT_POLICY default', () => {
  it('resolves to rail / comfortable when no provider is wired', () => {
    TestBed.configureTestingModule({ providers: [] });
    const policy = TestBed.inject(LAYOUT_POLICY);
    expect(policy.shellMode('/anywhere')).toBe('rail');
    expect(policy.density()).toBe('comfortable');
    expect(policy.workspaceLayout).toBeUndefined();
  });
});
