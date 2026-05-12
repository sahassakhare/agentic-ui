import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Type,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ComponentRegistry } from '../registries/component-registry';
import { DataSourceRegistry } from '../registries/data-source-registry';
import { ToolRegistry } from '../registries/tool-registry';
import type { TileDef, TileDrilldown } from '../types/registry-defs';

interface ResolvedTile {
  readonly component: Type<unknown>;
  readonly inputs: Record<string, unknown>;
}

/**
 * Emitted when the user clicks a tile's drill-down body (when
 * `[drilldown]` is set). Host wires the actual navigation /
 * longer-form tool invocation.
 */
export interface DashboardTileDrilldown {
  readonly tileId: string;
  readonly target: TileDrilldown;
}

/**
 * Emitted when the user clicks the "Explain" affordance on an
 * explainable tile. Host wires the actual explanation flow —
 * typically a chat message asking the agent to explain the value.
 */
export interface DashboardTileExplain {
  readonly tileId: string;
  readonly value: unknown;
}

/**
 * Renders one `TileDef` in a dashboard slot — Pillar 3 P3.A.1 of
 * [post-chat-surfaces-plan.md](../../../../docs/plans/post-chat-surfaces-plan.md).
 *
 * Each tile is *one of three* per ADR-044 D3:
 *
 * - **`tool` tile.** Invokes a registered tool via `ToolRegistry`
 *   on refresh. Chain-hashed each call. Persona scope applies via
 *   `ToolRegistry.get()` — tools the active persona can't see make
 *   the tile render a `no-access` stub (not a 403, not silent
 *   omission — preserves the layout).
 * - **`data` tile.** Re-queries a `DataSourceRegistry` source on
 *   refresh. No audit entry per re-query.
 * - **`static` tile.** Renders the supplied props verbatim. No
 *   refresh; no registry lookup beyond the component.
 *
 * Rendering is always via `<mvk-widget-container>`-style:
 * `ComponentRegistry.get(tile.component)` → Zod-validate the props
 * payload against `ComponentDef.propsSchema` → mount via
 * `*ngComponentOutlet`. Bad props fall through to raw inputs (same
 * fail-soft contract as the widget container).
 *
 * The tile manages loading + error + cached-value lifecycle itself
 * so the dashboard canvas doesn't have to. Refresh strategy comes
 * from `tile.refreshOn`:
 *
 * - `'load'` *(default)* — fire on first render
 * - `'manual'` — only when host calls `refresh()` (via template ref)
 *   or clicks the refresh button
 * - `'interval'` — refire every `cacheTtlMs` while the tile is alive
 * - `'event'` — fire on initial load + when the host signals via the
 *   `[refreshTick]` input (changes to this input trigger a re-fire)
 *
 * Optional drill-down + explain affordances surface as small icon
 * buttons in the tile header; clicks emit typed events.
 *
 * @see [ADR-044](../../../../docs/adr/0044-dashboard-registry.md)
 */
@Component({
  selector: 'mvk-dashboard-tile',
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="tile" [attr.data-tile-id]="tile().id">
      <header class="tile-head">
        <h3 class="tile-title">{{ tile().title }}</h3>
        <span class="actions">
          @if (tile().explainable) {
            <button type="button"
                    class="icon-btn"
                    aria-label="Explain this tile"
                    title="Explain"
                    (click)="onExplain()">?</button>
          }
          <button type="button"
                  class="icon-btn"
                  aria-label="Refresh tile"
                  title="Refresh"
                  [disabled]="loading()"
                  (click)="refresh()">↻</button>
        </span>
      </header>

      <div
        class="body"
        [class.clickable]="tile().drilldown !== undefined"
        (click)="onBodyClick()">

        @if (personaBlocked()) {
          <div class="state state-blocked">
            <span aria-hidden="true">🔒</span> Unavailable for your role
          </div>
        } @else if (loading()) {
          <div class="state state-loading" aria-busy="true">Loading…</div>
        } @else if (errorMessage(); as msg) {
          <div class="state state-error" [attr.title]="msg">
            <span aria-hidden="true">✗</span> Error
          </div>
        } @else if (resolved(); as r) {
          <ng-container *ngComponentOutlet="r.component; inputs: r.inputs" />
        } @else if (resolvedNoComponent()) {
          <div class="state state-blocked">
            <span aria-hidden="true">?</span> Unknown widget "{{ tile().component }}"
          </div>
        }
      </div>
    </article>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .tile {
      display: flex; flex-direction: column; height: 100%;
      background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem;
      overflow: hidden; font-family: system-ui, sans-serif;
    }
    .tile-head {
      display: flex; align-items: center; gap: 0.4rem;
      padding: 0.55rem 0.75rem; border-bottom: 1px solid #f3f4f6;
      background: #fafafa;
    }
    .tile-title {
      flex: 1; margin: 0; font-size: 0.85rem; font-weight: 600;
      color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .actions { display: flex; gap: 0.2rem; }
    .icon-btn {
      background: transparent; border: 0; cursor: pointer;
      width: 1.5rem; height: 1.5rem; padding: 0;
      border-radius: 0.25rem; color: #6b7280;
      font-size: 0.85rem; line-height: 1;
    }
    .icon-btn:hover { background: #f3f4f6; color: #111827; }
    .icon-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .icon-btn:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }
    .body {
      flex: 1; padding: 0.75rem; min-height: 0; overflow: auto;
      display: flex; align-items: stretch;
    }
    .body > * { flex: 1; min-width: 0; }
    .body.clickable { cursor: pointer; }
    .body.clickable:hover { background: #fafafa; }
    .state {
      display: inline-flex; align-items: center; gap: 0.4rem;
      padding: 0.4rem 0.6rem; border-radius: 0.35rem;
      font-size: 0.85rem;
    }
    .state-loading { color: #6b7280; }
    .state-error { background: #fee2e2; color: #991b1b; cursor: help; }
    .state-blocked { color: #9ca3af; }
  `,
})
export class DashboardTileComponent {
  /** The tile definition — id + invocation + component + title. */
  readonly tile = input.required<TileDef>();

  /**
   * Host-supplied input that changes when an external event should
   * trigger a re-fire (only honoured for `refreshOn: 'event'`).
   * Increment a signal in the parent on the relevant event; the tile
   * re-invokes on next change.
   */
  readonly refreshTick = input<number>(0);

  /** Emitted when the user clicks the tile body and `drilldown` is set. */
  readonly drilldown = output<DashboardTileDrilldown>();

  /** Emitted when the user clicks the Explain affordance. */
  readonly explain = output<DashboardTileExplain>();

  private readonly tools = inject(ToolRegistry);
  private readonly dataSources = inject(DataSourceRegistry);
  private readonly components = inject(ComponentRegistry);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | undefined>(undefined);
  protected readonly value = signal<unknown>(undefined);

  /** Track which invocation has run so we don't refire on every change. */
  private invocationKey = '';
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private lastFetchAt = 0;

  /**
   * True iff this tile's `kind: 'tool'` invocation references a tool
   * the active persona can't see via `ToolRegistry.get()`. Drives the
   * 'Unavailable for your role' stub render.
   */
  protected readonly personaBlocked = computed(() => {
    const t = this.tile();
    if (t.invocation.kind !== 'tool') return false;
    return this.tools.get(t.invocation.tool) === undefined;
  });

  /** Resolved component + Zod-validated inputs for the tile body. */
  protected readonly resolved = computed<ResolvedTile | null>(() => {
    const def = this.components.get(this.tile().component);
    if (!def) return null;
    const candidateInputs = { value: this.value() };
    const parsed = def.propsSchema.safeParse(candidateInputs);
    const inputs = (parsed.success ? parsed.data : candidateInputs) as Record<string, unknown>;
    return { component: def.component as Type<unknown>, inputs };
  });

  /** Helper signal so the template can distinguish "component missing" vs "resolved but null". */
  protected readonly resolvedNoComponent = computed(() => this.components.get(this.tile().component) === undefined);

  constructor() {
    // Fire whenever the tile's invocation signature changes or the
    // refresh-tick input changes (for refreshOn: 'event' tiles).
    effect(() => {
      const t = this.tile();
      const tick = this.refreshTick();
      const key = invocationCacheKey(t, tick);
      if (key === this.invocationKey) return;
      this.invocationKey = key;
      void this.fire(t);
    });

    // Schedule interval refresh for refreshOn: 'interval' tiles.
    effect(() => {
      const t = this.tile();
      if (this.intervalHandle) clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
      if (t.refreshOn !== 'interval') return;
      const ms = t.cacheTtlMs ?? 30_000;
      if (ms <= 0) return;
      this.intervalHandle = setInterval(() => void this.fire(t), ms);
    });

    this.destroyRef.onDestroy(() => {
      if (this.intervalHandle) clearInterval(this.intervalHandle);
    });
  }

  /** Public: refresh the tile's value. Host calls this from a template ref or refresh button. */
  refresh(): void {
    void this.fire(this.tile());
  }

  // ── internals ────────────────────────────────────────────────────

  private async fire(tile: TileDef): Promise<void> {
    if (tile.invocation.kind === 'static') {
      this.errorMessage.set(undefined);
      this.value.set(tile.invocation.props);
      return;
    }

    // Cache hit?
    const now = Date.now();
    if (
      tile.cacheTtlMs &&
      tile.cacheTtlMs > 0 &&
      this.lastFetchAt > 0 &&
      now - this.lastFetchAt < tile.cacheTtlMs
    ) {
      return;
    }

    if (tile.invocation.kind === 'tool') {
      if (this.personaBlocked()) {
        this.value.set(undefined);
        this.errorMessage.set(undefined);
        this.loading.set(false);
        return;
      }
      const def = this.tools.get(tile.invocation.tool);
      if (!def) {
        this.errorMessage.set(`Unknown tool "${tile.invocation.tool}"`);
        return;
      }
      this.loading.set(true);
      this.errorMessage.set(undefined);
      try {
        const args = tile.invocation.args;
        const ctx = buildTileToolContext(tile.id);
        const result = await def.handler(args, ctx);
        this.value.set(result);
        this.lastFetchAt = Date.now();
      } catch (err) {
        this.errorMessage.set(err instanceof Error ? err.message : String(err));
      } finally {
        this.loading.set(false);
      }
      return;
    }

    if (tile.invocation.kind === 'data') {
      const source = this.dataSources.get(tile.invocation.source);
      if (!source) {
        this.errorMessage.set(`Unknown data source "${tile.invocation.source}"`);
        return;
      }
      this.loading.set(true);
      this.errorMessage.set(undefined);
      try {
        // adapter() can return Observable (streams) or Promise (one-shots);
        // tiles read first emission for both. Hosts that need live stream
        // updates wire via refreshOn: 'event' + their own subscription.
        const result = source.adapter(tile.invocation.query);
        const fetched = await unwrapDataSourceResult(result);
        this.value.set(fetched);
        this.lastFetchAt = Date.now();
      } catch (err) {
        this.errorMessage.set(err instanceof Error ? err.message : String(err));
      } finally {
        this.loading.set(false);
      }
      return;
    }
  }

  protected onBodyClick(): void {
    const t = this.tile();
    if (!t.drilldown) return;
    this.drilldown.emit({ tileId: t.id, target: t.drilldown });
  }

  protected onExplain(): void {
    this.explain.emit({ tileId: this.tile().id, value: this.value() });
  }
}

/** Coerce a `DataSourceDef.adapter` result into a Promise. */
async function unwrapDataSourceResult(result: unknown): Promise<unknown> {
  if (result === null || result === undefined) return result;
  // Promise / thenable
  if (typeof (result as { then?: unknown }).then === 'function') {
    return await (result as Promise<unknown>);
  }
  // Observable (has subscribe)
  if (typeof (result as { subscribe?: unknown }).subscribe === 'function') {
    return await new Promise((resolve, reject) => {
      const sub = (result as { subscribe: (o: {
        next?: (v: unknown) => void;
        error?: (e: unknown) => void;
        complete?: () => void;
      }) => { unsubscribe: () => void } }).subscribe({
        next: (v) => {
          resolve(v);
          sub.unsubscribe();
        },
        error: reject,
      });
    });
  }
  return result;
}

/** Stable key for the invocation — re-fire when this changes. */
function invocationCacheKey(t: TileDef, tick: number): string {
  const eventSuffix = t.refreshOn === 'event' ? `|tick=${tick}` : '';
  switch (t.invocation.kind) {
    case 'tool':
      return `tool|${t.id}|${t.invocation.tool}|${JSON.stringify(t.invocation.args)}${eventSuffix}`;
    case 'data':
      return `data|${t.id}|${t.invocation.source}|${JSON.stringify(t.invocation.query)}${eventSuffix}`;
    case 'static':
      return `static|${t.id}|${JSON.stringify(t.invocation.props)}`;
  }
}

/**
 * Synthetic minimal `ToolContext` for a tile's tool invocation. The
 * tile-level call doesn't have a chat thread; threadId / runId derive
 * from the tile id so the audit chain still links every call back to
 * its tile.
 */
function buildTileToolContext(tileId: string): never {
  return {
    threadId: `tile:${tileId}`,
    runId: `tile-run-${Date.now()}`,
    toolCallId: `tile-call-${Date.now()}`,
    signal: new AbortController().signal,
    startOperation: () => `tile-op-${Date.now()}`,
    reportProgress: () => undefined,
    completeOperation: () => undefined,
    failOperation: () => undefined,
  } as never;
}
