/**
 * Dashboard tile widgets for the Experience Hub.
 *
 * Each is a plain Angular component that `<mvk-dashboard-tile>` mounts via
 * `*ngComponentOutlet`, passing a single `value` input (the resolved tile
 * value — see dashboard-tile.component.ts, which mounts with `{ value }`).
 * They are registered into `ComponentRegistry` by name (`kpi-stat`,
 * `bar-chart`, `data-table`) and referenced from `TileDef.component`.
 *
 * Deliberately dependency-free and self-styled so the Hub renders a real grid
 * out of the box; production tiles can be federated MFEs registered by the
 * same names.
 */
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** A single KPI number + label. `value` = `{ label, value, delta? }` or a raw number. */
@Component({
  selector: 'hub-kpi-stat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="kpi">
      <div class="kpi-v">{{ display().value }}</div>
      <div class="kpi-l">{{ display().label }}</div>
      @if (display().delta !== null) {
        <div class="kpi-d" [class.up]="display().delta! >= 0" [class.down]="display().delta! < 0">
          {{ display().delta! >= 0 ? '▲' : '▼' }} {{ absDelta() }}%
        </div>
      }
    </div>
  `,
  styles: [`
    .kpi { display:flex; flex-direction:column; gap:2px; }
    .kpi-v { font-size:32px; font-weight:700; line-height:1.1; letter-spacing:-.02em; }
    .kpi-l { font-size:12px; text-transform:uppercase; letter-spacing:.06em; opacity:.6; }
    .kpi-d { font-size:12px; font-weight:600; margin-top:4px; }
    .kpi-d.up { color:#0a7d32; } .kpi-d.down { color:#c0392b; }
  `],
})
export class KpiStatWidget {
  readonly value = input<unknown>();
  protected readonly display = computed(() => {
    const v = this.value() as { label?: string; value?: unknown; delta?: number } | number | null;
    if (v !== null && typeof v === 'object') {
      return { label: v.label ?? '', value: String(v.value ?? '—'), delta: typeof v.delta === 'number' ? v.delta : null };
    }
    return { label: '', value: v === null || v === undefined ? '—' : String(v), delta: null };
  });
  protected readonly absDelta = computed(() => Math.abs(this.display().delta ?? 0));
}

/** A horizontal bar chart. `value` = `Array<{ label, value }>`. */
@Component({
  selector: 'hub-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bars">
      @for (r of rows(); track r.label) {
        <div class="row">
          <span class="lbl">{{ r.label }}</span>
          <span class="track"><span class="fill" [style.width.%]="r.pct"></span></span>
          <span class="num">{{ r.value }}</span>
        </div>
      } @empty { <div class="muted">No data</div> }
    </div>
  `,
  styles: [`
    .bars { display:flex; flex-direction:column; gap:8px; }
    .row { display:grid; grid-template-columns:88px 1fr 40px; align-items:center; gap:8px; font-size:13px; }
    .lbl { opacity:.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .track { height:10px; border-radius:6px; background:rgba(120,120,140,.15); overflow:hidden; }
    .fill { display:block; height:100%; border-radius:6px; background:linear-gradient(90deg,#6750a4,#8a74d6); }
    .num { text-align:right; font-variant-numeric:tabular-nums; opacity:.8; }
    .muted { opacity:.5; font-size:13px; }
  `],
})
export class BarChartWidget {
  readonly value = input<unknown>();
  protected readonly rows = computed(() => {
    const data = (Array.isArray(this.value()) ? this.value() : []) as { label?: string; value?: number }[];
    const max = Math.max(1, ...data.map((d) => Number(d.value) || 0));
    return data.map((d) => ({ label: d.label ?? '—', value: Number(d.value) || 0, pct: ((Number(d.value) || 0) / max) * 100 }));
  });
}

/** A compact table. `value` = `{ columns: string[], rows: Array<Record<string,unknown>> }` or `Array<Record>`. */
@Component({
  selector: 'hub-data-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tbl-wrap">
      <table class="tbl">
        <thead><tr>@for (c of cols(); track c) { <th>{{ c }}</th> }</tr></thead>
        <tbody>
          @for (r of rows(); track $index) {
            <tr>@for (c of cols(); track c) { <td>{{ r[c] }}</td> }</tr>
          } @empty { <tr><td [attr.colspan]="cols().length" class="muted">No rows</td></tr> }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .tbl-wrap { overflow-x:auto; }
    .tbl { width:100%; border-collapse:collapse; font-size:13px; }
    .tbl th, .tbl td { text-align:left; padding:8px 10px; border-bottom:1px solid rgba(120,120,140,.16); white-space:nowrap; }
    .tbl th { font-size:11px; text-transform:uppercase; letter-spacing:.05em; opacity:.6; }
    .tbl tr:last-child td { border-bottom:none; }
    .muted { opacity:.5; }
  `],
})
export class DataTableWidget {
  readonly value = input<unknown>();
  private readonly model = computed(() => {
    const v = this.value();
    if (v && typeof v === 'object' && Array.isArray((v as { rows?: unknown }).rows)) {
      const o = v as { columns?: string[]; rows: Record<string, unknown>[] };
      return { columns: o.columns ?? (o.rows[0] ? Object.keys(o.rows[0]) : []), rows: o.rows };
    }
    const rows = (Array.isArray(v) ? v : []) as Record<string, unknown>[];
    return { columns: rows[0] ? Object.keys(rows[0]) : [], rows };
  });
  protected readonly cols = computed(() => this.model().columns);
  protected readonly rows = computed(() => this.model().rows);
}
