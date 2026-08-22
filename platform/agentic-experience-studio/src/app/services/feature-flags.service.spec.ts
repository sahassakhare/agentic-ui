import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  FeatureFlagsService,
  TENANT_POLICY_SOURCE,
  PLATFORM_FLAG_DEFAULTS,
  resolveFlag,
  type TenantPolicySource,
} from './feature-flags.service';

const F = 'aiAssistedAuthoring';

describe('resolveFlag — cascade truth table', () => {
  const on = { [F]: true };

  it('default (nothing set) → off', () => {
    expect(resolveFlag(F, {}, {}, new Set())).toBe(false);
  });

  it('platform off → off (even if tenant would allow)', () => {
    expect(resolveFlag(F, { [F]: false }, { [F]: true }, new Set())).toBe(false);
  });

  it('tenant off → off (even if platform is on)', () => {
    expect(resolveFlag(F, on, { [F]: false }, new Set())).toBe(false);
  });

  it('author opt-out → off (even if platform + tenant allow)', () => {
    expect(resolveFlag(F, on, { [F]: true }, new Set([F]))).toBe(false);
  });

  it('platform on, tenant unset (defers), no opt-out → on', () => {
    expect(resolveFlag(F, on, {}, new Set())).toBe(true);
  });

  it('all layers allow → on', () => {
    expect(resolveFlag(F, on, { [F]: true }, new Set())).toBe(true);
  });
});

describe('FeatureFlagsService', () => {
  function configure(
    platform: Record<string, boolean>,
    tenant: Record<string, boolean> = {},
  ): FeatureFlagsService {
    const source: TenantPolicySource = { load: async () => ({ flags: tenant }) };
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_FLAG_DEFAULTS, useValue: platform },
        { provide: TENANT_POLICY_SOURCE, useValue: source },
      ],
    });
    return TestBed.inject(FeatureFlagsService);
  }

  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    TestBed.resetTestingModule();
  });

  it('defaults aiAssistedAuthoring to off (platform default is false)', () => {
    const svc = configure({});
    expect(svc.isEnabled(F)).toBe(false);
    expect(svc.aiAssistedAuthoring()).toBe(false);
  });

  it('author opt-out toggles the resolved value off and back on', () => {
    const svc = configure({ [F]: true });
    expect(svc.isEnabled(F)).toBe(true);
    svc.setAuthorOptOut(F, true);
    expect(svc.isEnabled(F)).toBe(false);
    svc.setAuthorOptOut(F, false);
    expect(svc.isEnabled(F)).toBe(true);
  });

  it('resolve() returns a stable memoized signal', () => {
    const svc = configure({});
    expect(svc.resolve(F)).toBe(svc.resolve(F));
  });

  it('survives a throwing localStorage', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const svc = configure({});
    expect(svc.isEnabled(F)).toBe(false); // no throw
    spy.mockRestore();
  });
});
