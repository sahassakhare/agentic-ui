import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { CatalogClientService, type UsageAggregate, type UsageEvent } from '../services/catalog-client.service';
import { autoRefresh } from '../services/auto-refresh.service';
import { autoStream } from '../services/catalog-stream.service';

@Component({
  selector: 'ops-usage',
  imports: [DatePipe, DecimalPipe],
  template: `
    <h1>Usage</h1>
    <p class="dim">
      Per-tenant consumption stream. Catalog stores units (tokens,
      invocations, bytes); pricing is host-side. Hosts post events as
      work happens; this view aggregates them by kind.
    </p>

    @if (error(); as err) { <div class="error">Failed to load: {{ err }}</div> }
    @if (loading()) {
      <p class="dim">Loading…</p>
    } @else {
      <section class="card">
        <h2>All-time totals</h2>
        @if (total(); as t) {
          <div class="totals">
            <div class="stat">
              <div class="stat-num">{{ t.totalEvents | number }}</div>
              <div class="stat-label">events</div>
            </div>
            <div class="stat">
              <div class="stat-num">{{ t.totalQuantity | number }}</div>
              <div class="stat-label">total quantity</div>
            </div>
            <div class="stat">
              <div class="stat-num">{{ kindCount(t) }}</div>
              <div class="stat-label">distinct kinds</div>
            </div>
          </div>
        }
        <h3>By kind</h3>
        @if (kindEntries(); as entries) {
          @if (entries.length === 0) {
            <div class="empty">No usage events recorded.</div>
          } @else {
            <table>
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Quantity</th>
                  <th>% of total</th>
                </tr>
              </thead>
              <tbody>
                @for (e of entries; track e.kind) {
                  <tr>
                    <td class="mono">{{ e.kind }}</td>
                    <td class="mono">{{ e.quantity | number }}</td>
                    <td class="dim">{{ e.pct | number: '1.1-1' }}%</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        }
      </section>

      <section class="card">
        <h2>Recent events</h2>
        @if (recent().length === 0) {
          <div class="empty">No recent events.</div>
        } @else {
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Kind</th>
                <th>Quantity</th>
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>
              @for (e of recent(); track e.id) {
                <tr>
                  <td class="dim">{{ e.occurredAt | date: 'short' }}</td>
                  <td class="mono">{{ e.kind }}</td>
                  <td class="mono">{{ e.quantity | number }}</td>
                  <td class="mono dim">{{ tagsSummary(e) }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    }
  `,
  styles: [`
    .card {
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 20px;
      margin: 16px 0;
    }
    h2 { margin: 0 0 12px 0; font-size: 14px; color: var(--fg-muted); text-transform: uppercase; letter-spacing: 0.5px; }
    h3 { margin: 16px 0 8px; font-size: 13px; color: var(--fg-muted); }
    .totals { display: flex; gap: 32px; margin-bottom: 16px; }
    .stat-num { font-size: 28px; font-weight: 600; }
    .stat-label { font-size: 12px; color: var(--fg-muted); }
  `],
})
export class UsageComponent {
  private readonly catalog = inject(CatalogClientService);

  readonly total = signal<UsageAggregate | null>(null);
  readonly recent = signal<readonly UsageEvent[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly kindEntries = computed(() => {
    const t = this.total();
    if (!t) return [] as { kind: string; quantity: number; pct: number }[];
    const entries = Object.entries(t.byKind);
    const totalQ = t.totalQuantity || 1;
    return entries
      .map(([kind, quantity]) => ({ kind, quantity, pct: (quantity / totalQ) * 100 }))
      .sort((a, b) => b.quantity - a.quantity);
  });

  constructor() {
    this.fetch();
    autoStream(() => this.fetch(true));
    autoRefresh(() => this.fetch(true));
  }

  private fetch(silent = false): void {
    if (!silent) this.loading.set(true);
    Promise.all([
      this.catalog.aggregateUsage().toPromise(),
      this.catalog.recentUsage(50).toPromise(),
    ]).then(([agg, recent]) => {
      if (agg) this.total.set(agg);
      if (recent) this.recent.set(recent.items);
      this.loading.set(false);
    }).catch((err) => {
      this.error.set(err?.error?.detail ?? err?.message ?? 'unknown error');
      this.loading.set(false);
    });
  }

  kindCount(t: UsageAggregate): number {
    return Object.keys(t.byKind).length;
  }

  tagsSummary(e: UsageEvent): string {
    const entries = Object.entries(e.tags);
    if (entries.length === 0) return '—';
    return entries.map(([k, v]) => `${k}=${v}`).join(' ');
  }
}
