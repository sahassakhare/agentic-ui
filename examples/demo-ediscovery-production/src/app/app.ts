import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { listProductionSets, validateBatesPattern } from '@infra-tools/demo-ediscovery-shared';

import { environment } from '../environments/environment';
import { createProductionSetTool } from './tools/create-production-set.tool';
import { assignBatesNumbersTool } from './tools/assign-bates-numbers.tool';
import { exportProductionSetTool } from './tools/export-production-set.tool';
import { ProductionSummaryComponent } from './widgets/production-summary.component';

/**
 * Standalone domain UI for `demo-ediscovery-production`. Visiting
 * :4303 directly proves the capability is a complete production-
 * assembly surface — same handlers the host's agent calls. The form
 * below exercises the full chain (`create → assign → export`) so a
 * litigation-support engineer can walk through one round-trip
 * without leaving the page.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterOutlet, ProductionSummaryComponent],
  template: `
    <main>
      <header>
        <h1>demo-ediscovery-production</h1>
        <p class="subtle">
          Production remote — contributes <code>createProductionSet</code>,
          <code>assignBatesNumbers</code>, <code>redactDocument</code>,
          <code>exportProductionSet</code>, <code>productionSummary</code>,
          <code>batesPreview</code>, <code>redactionEditor</code>, and the
          <code>productionConfigForm</code> to the host shell at
          <a href="http://localhost:4300">localhost:4300</a> via Native Federation.
        </p>
      </header>

      <section class="panel">
        <h2>Run a production round-trip</h2>
        <p class="muted">Same handlers the agent calls — chained inline below.</p>

        <form (ngSubmit)="run()" class="form">
          <label>
            <span>Set name</span>
            <input name="name" [(ngModel)]="name" required>
          </label>
          <label>
            <span>Format</span>
            <select name="format" [(ngModel)]="format">
              <option value="native">native</option>
              <option value="tiff">tiff</option>
              <option value="pdf">pdf</option>
              <option value="load-file">load-file</option>
            </select>
          </label>
          <label class="wide">
            <span>Bates pattern <small>(e.g. ACME-{{ "{seq:07d}" }})</small></span>
            <input name="pattern" [(ngModel)]="pattern" required>
            @if (patternError(); as e) { <em class="err">{{ e }}</em> }
          </label>
          <label class="check">
            <input type="checkbox" name="deliver" [(ngModel)]="deliver">
            <span>Deliver after finalising (irreversible)</span>
          </label>
          <button type="submit" [disabled]="busy()">{{ busy() ? 'Running…' : 'Run create → bates → export' }}</button>
        </form>

        @if (status(); as s) { <p class="status">{{ s }}</p> }

        @if (lastSet(); as ls) {
          <app-production-summary
            [productionId]="ls.productionId"
            [name]="ls.name"
            [format]="ls.format"
            [batesPattern]="ls.batesPattern"
            [documentCount]="ls.documentCount"
            [status]="ls.status"
            [createdAt]="ls.createdAt"
          />
        }

        <details>
          <summary>All production sets in this matter ({{ allSets().length }})</summary>
          <ul>
            @for (p of allSets(); track p.id) {
              <li><code>{{ p.id }}</code> · {{ p.name }} · <strong>{{ p.status }}</strong> · {{ p.documents.length }} doc(s) · {{ p.batesPattern }}</li>
            } @empty {
              <li class="muted">No sets yet. Run the form above.</li>
            }
          </ul>
        </details>
      </section>

      <router-outlet />
    </main>
  `,
  styles: `
    :host { display: block; max-width: 880px; margin: 0 auto; padding: 1.5rem 1.2rem; }
    h1 { font-size: 1.4rem; margin: 0 0 0.4rem; }
    h2 { font-size: 1rem; margin: 0 0 0.3rem; color: #1e293b; }
    .subtle { color: #475569; font-size: 0.88rem; line-height: 1.5; margin: 0 0 1rem; }
    .muted { color: #64748b; font-size: 0.85rem; margin: 0 0 0.6rem; }
    .panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 0.5rem; padding: 1rem; }
    .form { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 0.7rem; align-items: end; margin-bottom: 0.6rem; }
    .form .wide, .form .check, .form button { grid-column: 1 / -1; }
    label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.78rem; color: #475569; }
    label.check { flex-direction: row; align-items: center; gap: 0.35rem; }
    label small { color: #94a3b8; font-weight: 400; }
    input, select { padding: 0.45rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 4px; font: inherit; }
    input:focus, select:focus { outline: 2px solid #4f46e5; outline-offset: -1px; border-color: transparent; }
    button { padding: 0.55rem 1rem; background: #4f46e5; color: white; border: 0; border-radius: 4px; font: inherit; font-weight: 500; cursor: pointer; }
    button:hover:not(:disabled) { background: #4338ca; }
    button:disabled { background: #94a3b8; cursor: not-allowed; }
    .err { color: #b91c1c; font-size: 0.78rem; margin-top: 2px; font-style: normal; }
    .status { margin: 0.6rem 0; font-size: 0.85rem; color: #475569; padding: 0.4rem 0.6rem; background: #eef2ff; border-left: 3px solid #4f46e5; border-radius: 4px; white-space: pre-wrap; }
    details { margin-top: 0.8rem; font-size: 0.85rem; }
    summary { cursor: pointer; color: #4f46e5; }
    details ul { list-style: none; margin: 0.4rem 0 0; padding: 0; display: grid; gap: 0.2rem; }
    details li { padding: 0.3rem 0.5rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 0.82rem; color: #475569; }
    code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-size: 0.92em; }
    a { color: #4f46e5; }
  `,
})
export class App {
  protected readonly name = signal('PROD-002 — Q1 responsive');
  protected readonly format = signal<'native' | 'tiff' | 'pdf' | 'load-file'>('tiff');
  protected readonly pattern = signal('ACME-{seq:07d}');
  protected readonly deliver = signal(false);

  protected readonly busy = signal(false);
  protected readonly status = signal<string | null>(null);
  protected readonly lastSet = signal<{
    productionId: string; name: string; format: string;
    batesPattern: string; documentCount: number; status: string; createdAt: string;
  } | null>(null);
  protected readonly bump = signal(0);
  protected readonly allSets = computed(() => { this.bump(); return listProductionSets(environment.matterId); });

  protected readonly patternError = computed(() => {
    const v = validateBatesPattern(this.pattern());
    return v.ok ? null : v.errors[0];
  });

  protected async run(): Promise<void> {
    this.busy.set(true);
    this.status.set('Creating draft…');
    const ctx = standaloneCtx();
    try {
      const created = await createProductionSetTool.handler(
        {
          name: this.name(),
          format: this.format(),
          batesPattern: this.pattern(),
          scope: { includeTags: ['responsive'], excludePrivileged: true },
        },
        ctx,
      ) as Record<string, unknown> & { id?: string; documentCount?: number; error?: string };
      if (created.error) {
        this.status.set('⚠️ ' + created.error);
        return;
      }
      const newId = created.id!;
      const docCount = created.documentCount ?? 0;
      this.status.set(`Created ${newId} with ${docCount} doc(s). Assigning Bates…`);

      const assigned = await assignBatesNumbersTool.handler(
        { productionId: newId, start: 1 },
        ctx,
      ) as Record<string, unknown> & { count?: number; first?: string; last?: string; error?: string };
      if (assigned.error) {
        this.status.set('⚠️ ' + assigned.error);
        return;
      }
      this.status.set(`Bates ${assigned.first} → ${assigned.last} assigned. Exporting…`);

      const exported = await exportProductionSetTool.handler(
        { productionId: newId, deliver: this.deliver(), reason: 'Standalone-UI round trip' },
        ctx,
      ) as Record<string, unknown> & { status?: string; error?: string };
      if (exported.error) {
        this.status.set('⚠️ ' + exported.error);
        return;
      }

      this.status.set(`✅ Round-trip complete — ${newId} is now ${exported.status ?? '(unknown)'}`);
      this.lastSet.set({
        productionId: newId,
        name: this.name(),
        format: this.format(),
        batesPattern: this.pattern(),
        documentCount: docCount,
        status: exported.status ?? 'finalized',
        createdAt: (created['createdAt'] as string | undefined) ?? new Date().toISOString(),
      });
      this.bump.update((n) => n + 1);
    } catch (err) {
      this.status.set('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      this.busy.set(false);
    }
  }
}

function standaloneCtx() {
  const id = `standalone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    threadId: 'standalone',
    runId: id,
    toolCallId: id,
    signal: new AbortController().signal,
    // Capability F5 LRO surface — standalone path is synchronous, so
    // these are typed stubs.
    startOperation: () => `op-standalone-${Date.now()}`,
    reportProgress: () => undefined,
    completeOperation: () => undefined,
    failOperation: () => undefined,
  };
}
