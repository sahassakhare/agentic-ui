import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatterService, type MatterStatus } from './data/matters';

/** Matter Management reporting — a review-progress + legal-hold summary rolled up
 *  by status and by type, with portfolio totals. A federated reporting surface. */
@Component({
  selector: 'app-matter-report',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rep">
      <div class="head"><h3>Portfolio review report</h3><span class="asof">Generated {{ asOf }}</span></div>

      <table class="rt">
        <thead><tr><th>Status</th><th class="n">Matters</th><th class="n">Docs</th><th class="n">Reviewed</th><th class="n">Review %</th><th class="n">Holds</th></tr></thead>
        <tbody>
          @for (r of byStatus(); track r.status) {
            <tr>
              <td><span class="st" [attr.data-s]="r.status">{{ r.status }}</span></td>
              <td class="n">{{ r.matters }}</td><td class="n">{{ fmt(r.docs) }}</td><td class="n">{{ fmt(r.reviewed) }}</td>
              <td class="n"><b>{{ r.pct }}%</b></td><td class="n">{{ r.holds }}</td>
            </tr>
          }
        </tbody>
        <tfoot><tr><td>Total</td><td class="n">{{ t().matters }}</td><td class="n">{{ fmt(t().docs) }}</td><td class="n">{{ fmt(t().reviewed) }}</td><td class="n"><b>{{ t().reviewPct }}%</b></td><td class="n">{{ t().holds }}</td></tr></tfoot>
      </table>

      <h3 class="sub">By matter type</h3>
      <table class="rt">
        <thead><tr><th>Type</th><th class="n">Matters</th><th class="n">Docs</th><th class="n">Review %</th></tr></thead>
        <tbody>
          @for (r of byType(); track r.type) {
            <tr><td>{{ r.type }}</td><td class="n">{{ r.matters }}</td><td class="n">{{ fmt(r.docs) }}</td><td class="n"><b>{{ r.pct }}%</b></td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    :host { display:block; font-family:system-ui,sans-serif; color:#0f172a; }
    .head { display:flex; align-items:baseline; justify-content:space-between; margin-bottom:12px; } h3 { font-size:14px; margin:0; color:#334155; } h3.sub { margin:22px 0 12px; } .asof { font-size:12px; color:#94a3b8; }
    .rt { width:100%; border-collapse:collapse; font-size:13px; background:#fff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; }
    th, td { text-align:left; padding:10px 12px; border-bottom:1px solid #eef2f7; } th.n, td.n { text-align:right; }
    th { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:#64748b; background:#f8fafc; }
    tfoot td { font-weight:700; background:#f8fafc; border-top:2px solid #e2e8f0; border-bottom:none; }
    .st { font-size:12px; padding:2px 9px; border-radius:999px; } .st[data-s='Active'] { background:#d1fae5; color:#065f46; } .st[data-s='On Hold'] { background:#fef3c7; color:#92400e; } .st[data-s='Closed'] { background:#e2e8f0; color:#475569; }
  `],
})
export class MatterReportComponent {
  private readonly svc = inject(MatterService);
  protected readonly t = this.svc.totals;
  protected readonly asOf = new Date().toISOString().slice(0, 10);
  protected fmt(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n); }

  protected readonly byStatus = computed(() => {
    const groups: MatterStatus[] = ['Active', 'On Hold', 'Closed'];
    return groups.map((status) => {
      const ms = this.svc.matters().filter((m) => m.status === status);
      const docs = ms.reduce((s, m) => s + m.docs, 0), reviewed = ms.reduce((s, m) => s + m.reviewed, 0);
      return { status, matters: ms.length, docs, reviewed, holds: ms.reduce((s, m) => s + m.holds, 0), pct: docs ? Math.round((reviewed / docs) * 100) : 0 };
    }).filter((r) => r.matters);
  });
  protected readonly byType = computed(() => {
    const map = new Map<string, { matters: number; docs: number; reviewed: number }>();
    for (const m of this.svc.matters()) {
      const g = map.get(m.type) ?? { matters: 0, docs: 0, reviewed: 0 };
      g.matters++; g.docs += m.docs; g.reviewed += m.reviewed; map.set(m.type, g);
    }
    return [...map.entries()].map(([type, g]) => ({ type, matters: g.matters, docs: g.docs, pct: g.docs ? Math.round((g.reviewed / g.docs) * 100) : 0 }));
  });
}
