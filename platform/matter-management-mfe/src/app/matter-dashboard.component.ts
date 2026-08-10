import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatterService } from './data/matters';

/** Matter Management dashboard — KPI cards, review progress by matter, and a
 *  matter-type breakdown. A federated surface the platform mounts by name. */
@Component({
  selector: 'app-matter-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dash">
      <div class="kpis">
        <div class="kpi"><span class="v">{{ t().active }}</span><span class="l">Active matters</span></div>
        <div class="kpi"><span class="v">{{ fmt(t().docs) }}</span><span class="l">Documents collected</span></div>
        <div class="kpi"><span class="v">{{ t().reviewPct }}%</span><span class="l">Reviewed</span><span class="d">{{ fmt(t().reviewed) }} docs</span></div>
        <div class="kpi warn"><span class="v">{{ t().holds }}</span><span class="l">Active legal holds</span></div>
      </div>

      <div class="cols">
        <section class="panel">
          <h3>Review progress by matter</h3>
          @for (m of top(); track m.id) {
            <div class="bar">
              <span class="bl">{{ m.name }}</span>
              <span class="track"><span class="fill" [style.width.%]="pct(m)"></span></span>
              <span class="bp">{{ pct(m) }}%</span>
            </div>
          }
        </section>

        <section class="panel">
          <h3>Matters by type</h3>
          @for (r of byType(); track r.label) {
            <div class="row"><span class="tl">{{ r.label }}</span><span class="tt"><span class="tf" [style.width.%]="r.pct"></span></span><span class="tn">{{ r.n }}</span></div>
          }
        </section>
      </div>
    </div>
  `,
  styles: [`
    :host { display:block; font-family:system-ui,sans-serif; color:#0f172a; }
    .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:14px; margin-bottom:18px; }
    .kpi { display:flex; flex-direction:column; gap:2px; padding:16px; border:1px solid #e2e8f0; border-radius:12px; background:#fff; }
    .kpi .v { font-size:28px; font-weight:800; letter-spacing:-.02em; } .kpi .l { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:#64748b; } .kpi .d { font-size:11px; color:#94a3b8; }
    .kpi.warn .v { color:#b45309; }
    .cols { display:grid; grid-template-columns:1.4fr 1fr; gap:16px; }
    @media (max-width:820px){ .cols { grid-template-columns:1fr; } }
    .panel { border:1px solid #e2e8f0; border-radius:12px; background:#fff; padding:16px; }
    h3 { font-size:13px; margin:0 0 12px; color:#334155; }
    .bar { display:grid; grid-template-columns:1fr 120px 40px; align-items:center; gap:10px; margin:9px 0; font-size:13px; }
    .bl { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#334155; }
    .track { height:9px; border-radius:6px; background:#eef2f7; overflow:hidden; } .fill { display:block; height:100%; background:linear-gradient(90deg,#2563eb,#60a5fa); border-radius:6px; }
    .bp { text-align:right; color:#475569; font-variant-numeric:tabular-nums; }
    .row { display:grid; grid-template-columns:90px 1fr 34px; align-items:center; gap:10px; margin:8px 0; font-size:13px; }
    .tl { color:#475569; } .tt { height:10px; background:#eef2f7; border-radius:6px; overflow:hidden; } .tf { display:block; height:100%; background:#8b74d6; border-radius:6px; } .tn { text-align:right; color:#475569; }
  `],
})
export class MatterDashboardComponent {
  private readonly svc = inject(MatterService);
  protected readonly t = this.svc.totals;
  protected readonly top = computed(() => [...this.svc.matters()].sort((a, b) => b.docs - a.docs).slice(0, 6));
  protected pct(m: { docs: number; reviewed: number }): number { return this.svc.reviewPct(m as never); }
  protected fmt(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n); }
  protected readonly byType = computed(() => {
    const ms = this.svc.matters();
    const counts = new Map<string, number>();
    for (const m of ms) counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
    const max = Math.max(1, ...counts.values());
    return [...counts.entries()].map(([label, n]) => ({ label, n, pct: (n / max) * 100 }));
  });
}
