import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatterService, type Matter } from './data/matters';

/** Matter Management list — a filterable matter grid with status, type, review
 *  progress and legal-hold counts. A federated surface mounted by the platform. */
@Component({
  selector: 'app-matter-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="wrap">
      <div class="bar">
        <input class="q" [(ngModel)]="q" (ngModelChange)="q.set($event)" placeholder="Filter matters, clients, attorneys…" />
        <select [ngModel]="status()" (ngModelChange)="status.set($event)">
          <option value="">All statuses</option><option>Active</option><option>On Hold</option><option>Closed</option>
        </select>
      </div>
      <div class="tblwrap">
        <table>
          <thead><tr><th>Matter</th><th>Client</th><th>Type</th><th>Status</th><th>Lead</th><th class="n">Cust.</th><th class="n">Docs</th><th>Review</th><th class="n">Holds</th></tr></thead>
          <tbody>
            @for (m of rows(); track m.id) {
              <tr>
                <td><div class="mn">{{ m.name }}</div><div class="mid">{{ m.id }} · <span class="pri" [attr.data-p]="m.priority">{{ m.priority }}</span></div></td>
                <td>{{ m.client }}</td>
                <td><span class="type">{{ m.type }}</span></td>
                <td><span class="st" [attr.data-s]="m.status">{{ m.status }}</span></td>
                <td>{{ m.leadAttorney }}</td>
                <td class="n">{{ m.custodians }}</td>
                <td class="n">{{ fmt(m.docs) }}</td>
                <td><span class="track"><span class="fill" [style.width.%]="pct(m)"></span></span><span class="pc">{{ pct(m) }}%</span></td>
                <td class="n">{{ m.holds }}</td>
              </tr>
            } @empty { <tr><td colspan="9" class="empty">No matters match.</td></tr> }
          </tbody>
        </table>
      </div>
      <div class="foot">{{ rows().length }} of {{ svc.matters().length }} matters</div>
    </div>
  `,
  styles: [`
    :host { display:block; font-family:system-ui,sans-serif; color:#0f172a; }
    .bar { display:flex; gap:10px; margin-bottom:12px; }
    .q { flex:1; padding:9px 12px; border:1px solid #cbd5e1; border-radius:8px; font:inherit; }
    select { padding:9px 10px; border:1px solid #cbd5e1; border-radius:8px; font:inherit; background:#fff; }
    .tblwrap { overflow-x:auto; border:1px solid #e2e8f0; border-radius:12px; }
    table { width:100%; border-collapse:collapse; font-size:13px; background:#fff; }
    th, td { text-align:left; padding:10px 12px; border-bottom:1px solid #eef2f7; white-space:nowrap; vertical-align:top; }
    th { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:#64748b; background:#f8fafc; } th.n, td.n { text-align:right; }
    tr:last-child td { border-bottom:none; }
    .mn { font-weight:600; } .mid { font-size:11px; color:#94a3b8; margin-top:2px; }
    .pri[data-p='High'] { color:#b91c1c; } .pri[data-p='Medium'] { color:#b45309; } .pri[data-p='Low'] { color:#64748b; }
    .type { font-size:12px; padding:2px 8px; border-radius:6px; background:#eef2ff; color:#3730a3; }
    .st { font-size:12px; padding:2px 9px; border-radius:999px; }
    .st[data-s='Active'] { background:#d1fae5; color:#065f46; } .st[data-s='On Hold'] { background:#fef3c7; color:#92400e; } .st[data-s='Closed'] { background:#e2e8f0; color:#475569; }
    .track { display:inline-block; width:70px; height:8px; border-radius:5px; background:#eef2f7; overflow:hidden; vertical-align:middle; } .fill { display:block; height:100%; background:linear-gradient(90deg,#2563eb,#60a5fa); }
    .pc { font-size:11px; color:#64748b; margin-left:7px; }
    .empty { text-align:center; color:#94a3b8; padding:20px; }
    .foot { margin-top:10px; font-size:12px; color:#94a3b8; }
  `],
})
export class MatterListComponent {
  protected readonly svc = inject(MatterService);
  protected readonly q = signal('');
  protected readonly status = signal('');
  protected pct(m: Matter): number { return this.svc.reviewPct(m); }
  protected fmt(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n); }
  protected rows(): Matter[] {
    const q = this.q().toLowerCase().trim(); const s = this.status();
    return this.svc.matters().filter((m) =>
      (!s || m.status === s) &&
      (!q || `${m.name} ${m.client} ${m.leadAttorney} ${m.id}`.toLowerCase().includes(q)));
  }
}
