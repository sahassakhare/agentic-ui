import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';

const DEFAULT_INTERVAL_MS = 8000;

/**
 * Tab-visibility-aware polling primitive. Pages call
 * `register(refresh)` to get auto-refresh; the service ticks the
 * registered callback every `intervalMs` while the tab is visible
 * and pauses when it's hidden (so Render free-tier bandwidth doesn't
 * burn on background tabs).
 *
 * One service instance, many subscribers. Each `register()` returns
 * an unregister function; the page should call it from
 * `DestroyRef.onDestroy` to stop ticking when navigated away from.
 *
 * **Design note** — this is polling, not push. SSE-based push is the
 * plan-v3 v0.2 path (ADR-015 §D-future); polling is the pragmatic
 * shortcut that ships today.
 */
@Injectable({ providedIn: 'root' })
export class AutoRefreshService {
  private readonly _enabled = signal<boolean>(true);
  private readonly _visible = signal<boolean>(this.readVisibility());
  private readonly _intervalMs = signal<number>(DEFAULT_INTERVAL_MS);
  private readonly tickers = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly visibilityListener: () => void;

  /**
   * UI affordance — components bind to this to show "auto-refresh
   * paused (tab hidden)" when the tab isn't visible.
   */
  readonly running = computed(() => this._enabled() && this._visible());
  readonly intervalMs = this._intervalMs.asReadonly();

  constructor() {
    this.visibilityListener = () => this._visible.set(this.readVisibility());
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.visibilityListener);
    }
    this.startTimer();
  }

  /** Register a refresh callback. Returns the unregister function. */
  register(refresh: () => void, destroyRef?: DestroyRef): () => void {
    this.tickers.add(refresh);
    const cleanup = () => this.tickers.delete(refresh);
    destroyRef?.onDestroy(cleanup);
    return cleanup;
  }

  setEnabled(enabled: boolean): void { this._enabled.set(enabled); }

  setIntervalMs(ms: number): void {
    if (ms < 1000) return;
    this._intervalMs.set(ms);
    this.startTimer();
  }

  ngOnDestroy(): void {
    if (this.timer != null) clearInterval(this.timer);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityListener);
    }
  }

  private startTimer(): void {
    if (this.timer != null) clearInterval(this.timer);
    if (typeof setInterval === 'undefined') return;
    this.timer = setInterval(() => this.tick(), this._intervalMs());
  }

  private tick(): void {
    if (!this._enabled() || !this._visible()) return;
    for (const t of this.tickers) {
      try { t(); }
      catch { /* one bad ticker shouldn't kill the others */ }
    }
  }

  private readVisibility(): boolean {
    return typeof document === 'undefined'
      ? true
      : document.visibilityState !== 'hidden';
  }
}

/**
 * Convenience: register a page's refresh callback for the lifetime
 * of the component. Wires up the unregister hook against the
 * component's `DestroyRef`.
 */
export function autoRefresh(refresh: () => void): void {
  inject(AutoRefreshService).register(refresh, inject(DestroyRef));
}
