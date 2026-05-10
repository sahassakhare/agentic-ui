import {
  Injectable,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  signal,
  type EnvironmentProviders,
  type Signal,
} from '@angular/core';
import { ToolRegistry } from '../registries/tool-registry';
import { ComponentRegistry } from '../registries/component-registry';
import { AGENTIC_TELEMETRY_SINK } from '../telemetry/telemetry-sink';
import type { RegistryEntry, ToolDef, ComponentDef } from '../types/registry-defs';

/**
 * Configuration for {@link provideCatalogCapabilityRegistrar}. Closes
 * Gap 1 from the [2026-05-10 platform audit](../../../../../docs/audit/2026-05-10-platform-audit.md):
 * the catalog has zero knowledge of capabilities the runtime exposes
 * unless an operator hand-curates a mirror (drift-prone — see
 * [ADR-025](../../../../../docs/adr/0025-ediscovery-demo-seed.md)).
 *
 * The registrar walks the in-process tool + widget registries at boot
 * and POSTs each entry to
 * `POST /v1/catalogs/{tenant}/capabilities`. The catalog's
 * `(tenant_id, kind, name)` UNIQUE constraint guarantees idempotency:
 * a repeat boot returns 409 per entry, which the registrar treats as
 * "already registered, success."
 *
 * Failures are non-fatal — the registrar logs them to the telemetry
 * sink. We deliberately do **not** block bootstrap on a network call
 * to the catalog: an unreachable catalog server should not prevent
 * the consumer app from rendering.
 */
export interface CatalogCapabilityRegistrarOptions {
  readonly catalogUrl: string;
  readonly tenantId: string;
  readonly getToken: () => Promise<string | null | undefined> | string | null | undefined;

  /**
   * Lifecycle to apply to entries that don't carry an explicit
   * `lifecycle`. Default `'published'` — apps that have actually
   * registered the capability are using it. Operators who want
   * runtime-discovered entries to require manual approval can set
   * `'draft'`.
   */
  readonly defaultLifecycle?: 'draft' | 'published' | 'deprecated' | 'disabled';

  /**
   * Whether to also register `source = 'remote:*'` entries (i.e.
   * federated MFE-contributed capabilities). Default `false` —
   * remotes typically own their own catalog identity and may have
   * already self-registered. Apps that treat the host as the
   * authoritative registrar can set `true`.
   */
  readonly includeRemotes?: boolean;

  /** Override of `globalThis.fetch`. Test seam. */
  readonly fetchFn?: typeof fetch;
}

/** Per-entry sync outcome. */
export type RegistrarSyncStatus = 'pending' | 'created' | 'exists' | 'failed';

export interface RegistrarSyncEntry {
  readonly kind: string;
  readonly name: string;
  readonly status: RegistrarSyncStatus;
  /** HTTP status, where applicable. */
  readonly httpStatus?: number;
  /** Error message when `status === 'failed'`. */
  readonly error?: string;
}

/**
 * Service that owns the registrar's sync state. Hosts can `inject`
 * it directly to inspect last-sync results from devtools or surface
 * a "registered N of M capabilities" badge.
 */
@Injectable({ providedIn: 'root' })
export class CatalogCapabilityRegistrarService {
  private readonly entries = signal<readonly RegistrarSyncEntry[]>([]);
  private readonly telemetry = inject(AGENTIC_TELEMETRY_SINK);

  readonly results: Signal<readonly RegistrarSyncEntry[]> = this.entries.asReadonly();

  /**
   * Promise of the last `sync()` call, useful in tests that need to
   * await the fire-and-forget initializer. `null` until the first
   * sync starts.
   */
  lastSync: Promise<void> | null = null;

  async sync(
    options: CatalogCapabilityRegistrarOptions,
    capabilities: readonly RegistrarPayload[],
  ): Promise<void> {
    const fetcher = options.fetchFn ?? fetch;
    const url = `${stripTrailingSlash(options.catalogUrl)}/v1/catalogs/${encodeURIComponent(options.tenantId)}/capabilities`;
    const token = await options.getToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const results: RegistrarSyncEntry[] = capabilities.map((c) => ({
      kind: c.kind,
      name: c.name,
      status: 'pending' as RegistrarSyncStatus,
    }));
    this.entries.set(results);

    let created = 0;
    let exists = 0;
    let failed = 0;

    for (let i = 0; i < capabilities.length; i++) {
      const cap = capabilities[i]!;
      try {
        const res = await fetcher(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(cap),
        });
        if (res.status === 201) {
          results[i] = { kind: cap.kind, name: cap.name, status: 'created', httpStatus: 201 };
          created++;
        } else if (res.status === 409) {
          results[i] = { kind: cap.kind, name: cap.name, status: 'exists', httpStatus: 409 };
          exists++;
        } else {
          const detail = await safeReadText(res);
          results[i] = {
            kind: cap.kind,
            name: cap.name,
            status: 'failed',
            httpStatus: res.status,
            error: `HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`,
          };
          failed++;
        }
      } catch (err) {
        results[i] = {
          kind: cap.kind,
          name: cap.name,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        };
        failed++;
      }
    }

    this.entries.set(results);
    this.telemetry.emit('agentic.platform.capability_registrar.sync', {
      'platform.capability.attempted': capabilities.length,
      'platform.capability.created': created,
      'platform.capability.exists': exists,
      'platform.capability.failed': failed,
    });
  }
}

/**
 * Wire-format payload posted to
 * `POST /v1/catalogs/{tenant}/capabilities`. Mirrors the catalog's
 * [`CapabilityCreateSchema`](../../../../../platform/agentic-catalog-server/src/domain/capability.ts).
 */
export interface RegistrarPayload {
  readonly kind: string;
  readonly name: string;
  readonly body: Record<string, unknown>;
  readonly lifecycle: 'draft' | 'published' | 'deprecated' | 'disabled';
  readonly tags?: readonly string[];
  readonly owner?: string;
  readonly requiredHostVersion?: string;
}

/**
 * Build the catalog payload from a runtime registry entry. Exported
 * for testing the runtime↔catalog mapping in isolation.
 */
export function toRegistrarPayload(
  kind: 'tool' | 'component',
  entry: ToolDef | ComponentDef,
  defaultLifecycle: 'draft' | 'published' | 'deprecated' | 'disabled',
): RegistrarPayload {
  const body: Record<string, unknown> = {
    source: entry.source ?? 'host',
  };
  if (kind === 'tool') {
    const tool = entry as ToolDef;
    body['description'] = tool.description;
    if (tool.executeIn) body['executeIn'] = tool.executeIn;
    if (tool.longRunning) body['longRunning'] = tool.longRunning;
  } else {
    const widget = entry as ComponentDef;
    if (widget.dataSources) body['dataSources'] = [...widget.dataSources];
  }
  if (entry.scopes && entry.scopes.length > 0) {
    body['scopes'] = [...entry.scopes];
  }

  const out: RegistrarPayload = {
    kind,
    name: entry.name,
    body,
    lifecycle: entry.lifecycle ?? defaultLifecycle,
    ...(entry.tags && entry.tags.length > 0 ? { tags: [...entry.tags] } : {}),
    ...(entry.owner ? { owner: entry.owner } : {}),
    ...(entry.requiredHostVersion ? { requiredHostVersion: entry.requiredHostVersion } : {}),
  };
  return out;
}

function isHostEntry(entry: RegistryEntry, includeRemotes: boolean): boolean {
  if (includeRemotes) return true;
  const src = entry.source ?? 'host';
  return src === 'host';
}

/**
 * Wire the catalog capability registrar. On Angular bootstrap, walks
 * the {@link ToolRegistry} and {@link ComponentRegistry}, and POSTs
 * each entry to `POST /v1/catalogs/{tenant}/capabilities` (idempotent
 * via the catalog's `(tenant, kind, name)` UNIQUE constraint).
 *
 * Fire-and-forget: bootstrap never blocks on the catalog round-trip.
 * Per-entry failures land on the telemetry sink as
 * `agentic.platform.capability_registrar.sync` and don't crash the
 * app.
 *
 * Closes Gap 1 from the 2026-05-10 platform audit (ADR-032).
 */
export function provideCatalogCapabilityRegistrar(
  options: CatalogCapabilityRegistrarOptions,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      const svc = inject(CatalogCapabilityRegistrarService);
      const tools = inject(ToolRegistry);
      const widgets = inject(ComponentRegistry);

      const includeRemotes = options.includeRemotes ?? false;
      const defaultLifecycle = options.defaultLifecycle ?? 'published';

      const payloads: RegistrarPayload[] = [
        ...tools.listRaw().filter((e) => isHostEntry(e, includeRemotes))
          .map((t) => toRegistrarPayload('tool', t, defaultLifecycle)),
        ...widgets.listRaw().filter((e) => isHostEntry(e, includeRemotes))
          .map((w) => toRegistrarPayload('component', w, defaultLifecycle)),
      ];

      // Fire-and-forget. Boot never blocks. We capture the promise on
      // the service so tests + devtools can await the result.
      svc.lastSync = svc.sync(options, payloads);
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
