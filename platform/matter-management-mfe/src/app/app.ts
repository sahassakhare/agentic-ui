import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatterDashboardComponent } from './matter-dashboard.component';
import { MatterListComponent } from './matter-list.component';
import { MatterReportComponent } from './matter-report.component';

/**
 * Standalone view of the Matter Management remote (open :4300 directly). It uses
 * the SAME components it federates to the platform — so the remote is a complete
 * domain app on its own, and the Studio/Hub compose those same surfaces.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatterDashboardComponent, MatterListComponent, MatterReportComponent],
  template: `
    <main>
      <header class="top">
        <div>
          <h1>Matter Management</h1>
          <p class="sub">eDiscovery · a federated domain app orchestrated by the Agentic Experience Platform. The surfaces below are the same components the Studio composes into pages.</p>
        </div>
        <span class="tag">MFE remote · :4300</span>
      </header>

      <section><div class="eyebrow">Dashboard</div><app-matter-dashboard /></section>
      <section><div class="eyebrow">Matters</div><app-matter-list /></section>
      <section><div class="eyebrow">Reporting</div><app-matter-report /></section>
    </main>
  `,
  styles: [`
    :host { display:block; font-family:system-ui,sans-serif; color:#0f172a; background:#f1f5f9; min-height:100vh; }
    main { max-width:1100px; margin:0 auto; padding:24px 20px 60px; }
    .top { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:20px; }
    h1 { font-size:22px; margin:0 0 6px; } .sub { color:#475569; font-size:13px; max-width:640px; margin:0; line-height:1.5; }
    .tag { font-size:11px; padding:4px 10px; border-radius:20px; background:#e0e7ff; color:#3730a3; white-space:nowrap; }
    section { margin-top:26px; } .eyebrow { font-size:11px; text-transform:uppercase; letter-spacing:.07em; color:#94a3b8; margin-bottom:10px; }
  `],
})
export class App {}
