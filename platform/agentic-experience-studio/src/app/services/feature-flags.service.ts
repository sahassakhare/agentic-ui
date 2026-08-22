import { Injectable, InjectionToken, Signal, computed, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';

/** Flags the Studio knows about. Extend as new gated features land. */
export type FeatureFlagName = 'aiAssistedAuthoring';

/**
 * Tenant policy: a flag → allowed map. An absent entry means "not restricted by
 * the tenant" (the decision defers to the platform default). A `false` entry is
 * a hard tenant-level disable.
 */
export interface TenantFlagPolicy {
  readonly flags: Readonly<Record<string, boolean>>;
}

/** Source of the tenant policy — stubbed here, wired to the catalog later. */
export interface TenantPolicySource {
  load(): Promise<TenantFlagPolicy>;
}

/** Default tenant source imposes no restriction (empty policy → defers to platform). */
export const TENANT_POLICY_SOURCE = new InjectionToken<TenantPolicySource>('TENANT_POLICY_SOURCE', {
  providedIn: 'root',
  factory: () => ({ load: async () => ({ flags: {} }) }),
});

/** Platform-level defaults (cascade layer 1) — sourced from the environment. */
export const PLATFORM_FLAG_DEFAULTS = new InjectionToken<Readonly<Record<string, boolean>>>(
  'PLATFORM_FLAG_DEFAULTS',
  {
    providedIn: 'root',
    factory: () => (environment as { featureFlags?: Record<string, boolean> }).featureFlags ?? {},
  },
);

const OPT_OUT_KEY = 'aes-flag-optout';

/**
 * Pure cascade resolver (platform → tenant → author). A flag is enabled only if
 * the platform default is `true`, the tenant hasn't disabled it, and the author
 * hasn't opted out. Default OFF; no layer can force-enable past the one above.
 * Exported standalone so the truth table is unit-testable without Angular.
 */
export function resolveFlag(
  name: string,
  platform: Readonly<Record<string, boolean>>,
  tenant: Readonly<Record<string, boolean>>,
  authorOptOut: ReadonlySet<string>,
): boolean {
  const platformAllows = platform[name] === true;
  const tenantAllows = tenant[name] !== false; // absent = allowed
  const optedOut = authorOptOut.has(name);
  return platformAllows && tenantAllows && !optedOut;
}

/**
 * Resolves Studio feature flags through the platform → tenant → author cascade
 * (see {@link resolveFlag}). Exposes reactive signals so UI shows/hides gated
 * affordances live. This is the seam the AI-assisted authoring toggle rides on
 * (execution plan, Phase 2): the manual path is unaffected when a flag is off.
 */
@Injectable({ providedIn: 'root' })
export class FeatureFlagsService {
  private readonly tenantSource = inject(TENANT_POLICY_SOURCE);
  private readonly platform = inject(PLATFORM_FLAG_DEFAULTS);
  private readonly tenant = signal<Readonly<Record<string, boolean>>>({});
  private readonly optOut = signal<ReadonlySet<string>>(this.loadOptOut());
  private readonly cache = new Map<string, Signal<boolean>>();

  /** Convenience reactive accessor for the AI-authoring gate. */
  readonly aiAssistedAuthoring = this.resolve('aiAssistedAuthoring');

  constructor() {
    void this.refreshTenantPolicy();
  }

  /** A reactive signal for `name`, memoized so repeat calls share one computed. */
  resolve(name: FeatureFlagName | string): Signal<boolean> {
    let sig = this.cache.get(name);
    if (!sig) {
      sig = computed(() => resolveFlag(name, this.platform, this.tenant(), this.optOut()));
      this.cache.set(name, sig);
    }
    return sig;
  }

  /** Synchronous read of the current resolved value. */
  isEnabled(name: FeatureFlagName | string): boolean {
    return resolveFlag(name, this.platform, this.tenant(), this.optOut());
  }

  /** (Re)load the tenant policy; failures fall back to "no restriction". */
  async refreshTenantPolicy(): Promise<void> {
    try {
      const policy = await this.tenantSource.load();
      this.tenant.set(policy?.flags ?? {});
    } catch {
      this.tenant.set({});
    }
  }

  /** Author-level opt-out (persisted per browser). The author can only turn a flag off. */
  setAuthorOptOut(name: FeatureFlagName | string, optedOut: boolean): void {
    const next = new Set(this.optOut());
    if (optedOut) next.add(name);
    else next.delete(name);
    this.optOut.set(next);
    this.persistOptOut(next);
  }

  private loadOptOut(): ReadonlySet<string> {
    try {
      const raw = localStorage.getItem(OPT_OUT_KEY);
      return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set<string>();
    }
  }

  private persistOptOut(names: ReadonlySet<string>): void {
    try {
      localStorage.setItem(OPT_OUT_KEY, JSON.stringify([...names]));
    } catch {
      /* private mode / storage disabled — opt-out is best-effort */
    }
  }
}
