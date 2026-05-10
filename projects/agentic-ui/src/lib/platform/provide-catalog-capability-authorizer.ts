import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  signal,
  type EnvironmentProviders,
  type Signal,
} from '@angular/core';
import { ToolRegistry } from '../registries/tool-registry';
import { ComponentRegistry } from '../registries/component-registry';
import type { RegistryScopePolicy } from '../registries/registry-base';
import { AGENTIC_TELEMETRY_SINK } from '../telemetry/telemetry-sink';
import type { RegistryEntry } from '../types/registry-defs';

/**
 * Configuration for {@link provideCatalogCapabilityAuthorizer}. Closes
 * Gap 3 from the [2026-05-10 platform audit](../../../../../docs/audit/2026-05-10-platform-audit.md):
 * the catalog's `lifecycle: 'disabled'` flag has no enforcement effect
 * on consumer apps today — they don't ask. An operator who toggles a
 * capability to `disabled` in the ops console sees no behaviour
 * change in any running app.
 *
 * The authorizer fetches the catalog's capability list at boot,
 * filters to `lifecycle === 'disabled'`, and installs a scope policy
 * on `ToolRegistry` + `ComponentRegistry` that hides disabled entries
 * from `list()` / `get()` / `signal()` reads. Re-fetches on a
 * configurable polling interval so operator toggles propagate
 * without an app reload.
 *
 * **Default-allow.** Capabilities not present in the catalog (e.g.
 * apps adopting before the registrar runs, demo deploys without a
 * catalog) stay visible. Only entries explicitly marked
 * `disabled` in the catalog are hidden. This preserves today's
 * behaviour for non-platform adopters; governance is opt-in.
 */
export interface CatalogCapabilityAuthorizerOptions {
  readonly catalogUrl: string;
  readonly tenantId: string;
  readonly getToken: () => Promise<string | null | undefined> | string | null | undefined;

  /**
   * Refresh interval for the disabled-list poll. Default `30000`
   * (30s). Polling is the v1 transport — SSE-based live updates are
   * a follow-up (see ADR-033 §Out-of-scope). Set `0` to disable
   * polling and only fetch once at boot.
   */
  readonly refreshIntervalMs?: number;

  /**
   * If the initial fetch fails (catalog unreachable, malformed
   * response), what to do:
   *   - `'allow'` (default) — keep the permissive default; degrade
   *     gracefully. Telemetry records the failure.
   *   - `'deny'` — install an empty-allowlist policy that hides
   *     EVERY entry until a successful fetch lands. Use this when
   *     the catalog is the authoritative source of truth and a
   *     stale-read is worse than no app surface.
   */
  readonly onInitialFetchFailure?: 'allow' | 'deny';

  /** Override of `globalThis.fetch`. Test seam. */
  readonly fetchFn?: typeof fetch;
}

interface CatalogCapabilityListItem {
  readonly kind: string;
  readonly name: string;
  readonly lifecycle: 'draft' | 'published' | 'deprecated' | 'disabled';
}

interface CatalogListResponse {
  readonly items: readonly CatalogCapabilityListItem[];
}

/**
 * Service that owns the live disabled-keys set + composable scope
 * policy. Hosts can `inject` it directly to surface a "N capabilities
 * gated" badge or to force a re-fetch after an external event.
 */
@Injectable({ providedIn: 'root' })
export class CatalogCapabilityAuthorizerService {
  /** Set of `${kind}:${name}` keys that are disabled per the catalog. */
  private readonly disabled = signal<ReadonlySet<string>>(new Set());
  private readonly fetchFailedAtBoot = signal<boolean>(false);
  private readonly telemetry = inject(AGENTIC_TELEMETRY_SINK);
  private readonly destroyRef = inject(DestroyRef, { optional: true });

  private timer: ReturnType<typeof setInterval> | null = null;
  private options: CatalogCapabilityAuthorizerOptions | null = null;

  /** Live signal of disabled keys. */
  readonly disabledKeys: Signal<ReadonlySet<string>> = this.disabled.asReadonly();

  /** Did the initial fetch fail? Useful for surfacing a "degraded" badge. */
  readonly initialFetchFailed: Signal<boolean> = this.fetchFailedAtBoot.asReadonly();

  /**
   * Number of currently-disabled capabilities. Convenience for ops
   * dashboards: `inject(CatalogCapabilityAuthorizerService).disabledCount()`.
   */
  readonly disabledCount: Signal<number> = computed(() => this.disabled().size);

  /**
   * Promise of the in-flight (or last) `refresh()` call. Useful in
   * tests that need to await the fire-and-forget initial fetch.
   * `null` until the first refresh starts.
   */
  lastRefresh: Promise<void> | null = null;

  configure(options: CatalogCapabilityAuthorizerOptions): void {
    this.options = options;
    this.destroyRef?.onDestroy(() => this.stopPolling());
  }

  async refresh(): Promise<void> {
    const opts = this.options;
    if (!opts) return;

    try {
      const next = await this.fetchDisabled(opts);
      this.disabled.set(next);
      this.fetchFailedAtBoot.set(false);
      this.telemetry.emit('agentic.platform.capability_authorizer.refresh', {
        'platform.capability.disabled_count': next.size,
      });
    } catch (err) {
      this.telemetry.emit('agentic.platform.capability_authorizer.refresh_failed', {
        'error.message': err instanceof Error ? err.message : String(err),
      });
      // If we've never had a successful fetch and the policy is
      // 'deny', surface the failure flag so the policy installer
      // can flip to closed-allowlist mode.
      if (this.disabled().size === 0 && !this.everSucceeded) {
        this.fetchFailedAtBoot.set(true);
      }
    }
  }

  startPolling(intervalMs: number): void {
    this.stopPolling();
    if (intervalMs <= 0) return;
    this.timer = setInterval(() => { this.lastRefresh = this.refresh(); }, intervalMs);
  }

  stopPolling(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private everSucceeded = false;

  private async fetchDisabled(
    opts: CatalogCapabilityAuthorizerOptions,
  ): Promise<ReadonlySet<string>> {
    const fetcher = opts.fetchFn ?? fetch;
    const token = await opts.getToken();
    const url = `${stripTrailingSlash(opts.catalogUrl)}/v1/catalogs/${encodeURIComponent(opts.tenantId)}/capabilities?lifecycle=disabled&limit=500`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetcher(url, { headers });
    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
    }
    const body = (await res.json()) as CatalogListResponse;
    const next = new Set<string>();
    for (const item of body.items ?? []) {
      if (item.lifecycle === 'disabled' && typeof item.kind === 'string' && typeof item.name === 'string') {
        next.add(`${item.kind}:${item.name}`);
      }
    }
    this.everSucceeded = true;
    return next;
  }
}

/**
 * Compose `inner` with a disabled-key check. The returned policy is
 * the AND of (a) `inner(entry)` and (b) the catalog's allow / deny
 * decision. Exposed for hosts that want to wrap their own custom
 * policy explicitly; the standard flow is to let
 * {@link provideCatalogCapabilityAuthorizer} install it.
 */
export function composeWithCatalogAuthorizer(
  inner: RegistryScopePolicy,
  disabledKeys: () => ReadonlySet<string>,
  registryKind: 'tool' | 'component',
  closedAllowlist: () => boolean,
): RegistryScopePolicy {
  return (entry: RegistryEntry) => {
    if (closedAllowlist()) return false;
    const key = `${registryKind}:${entry.name}`;
    if (disabledKeys().has(key)) return false;
    return inner(entry);
  };
}

/**
 * Wire the catalog-driven capability authorizer.
 *
 * Provides:
 * - {@link CatalogCapabilityAuthorizerService} (owns the live
 *   disabled-keys signal + refresh logic).
 * - An initializer that fetches the disabled list at boot, installs
 *   a composing scope policy on `ToolRegistry` + `ComponentRegistry`,
 *   and (optionally) starts a refresh timer.
 *
 * Closes Gap 3 from the 2026-05-10 platform audit (ADR-033).
 *
 * @example
 * ```ts
 * provideCatalogCapabilityAuthorizer({
 *   catalogUrl: 'https://catalog.example.com',
 *   tenantId: 'acme',
 *   getToken: () => oidc.getAccessToken(),
 *   refreshIntervalMs: 30_000,
 * })
 * ```
 */
export function provideCatalogCapabilityAuthorizer(
  options: CatalogCapabilityAuthorizerOptions,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      const svc = inject(CatalogCapabilityAuthorizerService);
      const tools = inject(ToolRegistry);
      const widgets = inject(ComponentRegistry);

      svc.configure(options);

      const onFailure = options.onInitialFetchFailure ?? 'allow';
      const closedAllowlist = (): boolean =>
        onFailure === 'deny' && svc.initialFetchFailed();

      // Capture each registry's existing policy so we compose rather
      // than overwrite. Hosts that have an active-persona policy
      // installed keep it; ours runs first to deny disabled entries,
      // then defers to the persona policy.
      const innerToolsPolicy = tools.currentScopePolicy();
      const innerWidgetsPolicy = widgets.currentScopePolicy();

      tools.setScopePolicy(
        composeWithCatalogAuthorizer(innerToolsPolicy, () => svc.disabledKeys(), 'tool', closedAllowlist),
      );
      widgets.setScopePolicy(
        composeWithCatalogAuthorizer(innerWidgetsPolicy, () => svc.disabledKeys(), 'component', closedAllowlist),
      );

      // Fire-and-forget initial fetch + start polling. Capture the
      // promise on the service so tests + devtools can await it.
      svc.lastRefresh = svc.refresh();
      const intervalMs = options.refreshIntervalMs ?? 30_000;
      svc.startPolling(intervalMs);
    }),
  ]);
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

async function safeReadText(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 500); }
  catch { return ''; }
}
