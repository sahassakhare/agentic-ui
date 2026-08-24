import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { environment } from '../../environments/environment';

interface IngestJob {
  id: string;
  remoteName: string;
  phase: string;
  log: string[];
  components: { name: string; className: string; inputs: string[] }[];
  remoteEntry?: string;
  error?: string;
}

/**
 * Upload a component library — POST it to the component-ingest service, which
 * builds it into a federated remote of widgets and registers the components as
 * `kind:'component'` capabilities. Two-step flow: discover the library's
 * components, pick which to expose, then build only those (a big library builds
 * faster and avoids pulling components' optional deps you don't need).
 */
@Component({
  selector: 'aes-component-ingest',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, MatTabsModule],
  template: `
    <div class="wrap">
      <a routerLink="/components" class="back">← Components</a>
      <h1>Upload a component library</h1>
      <p class="muted">Ingest an Angular library (an npm package, <code>.tgz</code>, or <code>.zip</code>). It's built into a federated remote and registered as components — usable in Forms &amp; Pages with <strong>no redeploy</strong>.</p>

      @if (!job()) {
        <section class="card">
          <mat-tab-group class="ingest-tabs" [selectedIndex]="modeIndex()" (selectedIndexChange)="setModeByIndex($event)" mat-stretch-tabs="false">
            <mat-tab label="npm package">
              <label class="lbl">npm spec</label>
              <input class="input" [(ngModel)]="npmSpec" placeholder="&#64;progress/kendo-angular-buttons@16.0.0" (keydown.enter)="discover()" />
            </mat-tab>
            <mat-tab label="Tarball URL">
              <label class="lbl">Tarball URL (.tgz)</label>
              <input class="input" [(ngModel)]="url" placeholder="https://…/my-lib-1.0.0.tgz" (keydown.enter)="discover()" />
              <p class="muted sm" style="margin-top:6px">A direct link to a packed library tarball — e.g. an npm registry URL or a release asset.</p>
            </mat-tab>
            <mat-tab label="Upload archive">
              <label class="lbl">Library archive (.tgz / .zip)</label>
              <input type="file" accept=".tgz,.gz,.zip" (change)="onFile($event)" />
            </mat-tab>
          </mat-tab-group>
          @if (error()) { <p class="err">{{ error() }}</p> }
          <div class="actions">
            <button class="btn primary" (click)="discover()" [disabled]="busy() || !canSubmit()">
              @if (busy()) { Working… } @else { Discover components → }
            </button>
            <button class="btn link" (click)="ingestAll()" [disabled]="busy() || !canSubmit()">or ingest the whole library →</button>
          </div>
        </section>
      } @else if (job()!.phase === 'discovered') {
        <section class="card">
          <div class="statusrow">
            <b>{{ job()!.remoteName }}</b>
            <span class="muted sm">discovered {{ job()!.components.length }} component(s) — choose which to build</span>
          </div>
          <div class="toolbar">
            <input class="input filter" [(ngModel)]="filter" placeholder="Filter by name…" />
            <span class="count">{{ selectedCount() }} / {{ job()!.components.length }} selected</span>
            <button class="btn tiny" (click)="selectAll()">All</button>
            <button class="btn tiny" (click)="selectNone()">None</button>
          </div>
          <ul class="picker">
            @for (c of filtered(); track c.name) {
              <li>
                <label>
                  <input type="checkbox" [checked]="selected().has(c.name)" (change)="toggle(c.name)" />
                  <b>{{ c.name }}</b>
                  <span class="muted sm">{{ c.className }} · {{ c.inputs.length }} input(s)</span>
                </label>
              </li>
            }
            @if (!filtered().length) { <li class="empty muted sm">No components match “{{ filter() }}”.</li> }
          </ul>
          @if (error()) { <p class="err">{{ error() }}</p> }
          <div class="actions">
            <button class="btn primary" (click)="buildSelected()" [disabled]="busy() || !selectedCount()">
              @if (busy()) { Working… } @else { Build {{ selectedCount() }} selected → }
            </button>
            <button class="btn" (click)="reset()">Cancel</button>
          </div>
        </section>
      } @else {
        <section class="card">
          <div class="statusrow">
            <span class="badge" [class.done]="job()!.phase === 'registered'" [class.bad]="job()!.phase === 'failed'">{{ job()!.phase }}</span>
            <b>{{ job()!.remoteName }}</b>
            @if (polling()) { <span class="spin" aria-hidden="true"></span> }
          </div>
          @if (job()!.components.length) {
            <div class="eyebrow">Building {{ job()!.components.length }} component(s)</div>
            <ul class="comps">
              @for (c of job()!.components; track c.name) {
                <li><b>{{ c.name }}</b> <span class="muted sm">{{ c.className }} · {{ c.inputs.length }} input(s)</span></li>
              }
            </ul>
          }
          @if (job()!.phase === 'registered') { <p class="ok">✓ Registered — the components now appear in the Components list and the Page/Form designers.</p> }
          @if (job()!.phase === 'failed') { <p class="err">{{ job()!.error }}</p> }
          <details class="log"><summary>Build log ({{ job()!.log.length }} lines)</summary><pre>{{ logText() }}</pre></details>
          <button class="btn" (click)="reset()">Ingest another</button>
        </section>
      }
    </div>
  `,
  styles: [`
    .wrap { padding:20px 24px; max-width:760px; margin:0 auto; }
    .back { font-size:13px; text-decoration:none; opacity:.7; } h1 { font-size:20px; margin:10px 0 6px; }
    .muted { opacity:.65; } .sm { font-size:12px; }
    .card { border:1px solid rgba(120,120,140,.18); border-radius:14px; padding:18px; margin-top:14px; }
    .ingest-tabs { margin-bottom:14px; }
    .ingest-tabs .lbl { margin-top:14px; }
    .lbl { display:block; font-size:12px; font-weight:600; margin:8px 0 5px; opacity:.8; }
    .input { width:100%; padding:10px 12px; border:1px solid rgba(120,120,140,.3); border-radius:9px; background:transparent; color:inherit; font:inherit; }
    .actions { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
    .btn { font:inherit; margin-top:14px; padding:9px 16px; border-radius:9px; border:1px solid rgba(120,120,140,.3); background:transparent; color:inherit; cursor:pointer; }
    .btn.primary { background:#6750a4; color:#fff; border-color:#6750a4; font-weight:600; } .btn[disabled] { opacity:.5; cursor:default; }
    .btn.link { border:none; background:none; text-decoration:underline; opacity:.75; padding:9px 0; }
    .btn.tiny { margin-top:0; padding:5px 10px; font-size:12px; }
    .err { color:#c0392b; font-size:13px; margin-top:10px; } .ok { color:#0a7d32; font-size:13px; margin-top:10px; }
    .statusrow { display:flex; align-items:center; gap:10px; }
    .badge { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; padding:3px 10px; border-radius:999px; background:rgba(203,143,0,.16); color:#a86a00; }
    .badge.done { background:rgba(10,125,50,.15); color:#0a7d32; } .badge.bad { background:rgba(192,57,43,.14); color:#c0392b; }
    .eyebrow { font-size:11px; text-transform:uppercase; letter-spacing:.06em; opacity:.55; margin:14px 0 8px; }
    .toolbar { display:flex; align-items:center; gap:10px; margin:14px 0 8px; flex-wrap:wrap; }
    .toolbar .filter { flex:1 1 220px; padding:7px 10px; } .toolbar .count { font-size:12px; opacity:.7; }
    .comps, .picker { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
    .comps li { padding:8px 10px; border:1px solid rgba(120,120,140,.18); border-radius:9px; }
    .picker { max-height:340px; overflow:auto; }
    .picker li { padding:0; border:1px solid rgba(120,120,140,.14); border-radius:9px; }
    .picker label { display:flex; align-items:center; gap:9px; padding:8px 10px; cursor:pointer; }
    .picker li.empty { padding:10px; border:none; }
    .log { margin-top:12px; } .log pre { max-height:300px; overflow:auto; background:rgba(120,120,140,.06); border-radius:9px; padding:10px; font-size:11.5px; font-family:ui-monospace,Menlo,monospace; white-space:pre-wrap; }
    .spin { width:13px; height:13px; border:2px solid rgba(120,120,140,.3); border-top-color:#6750a4; border-radius:50%; display:inline-block; animation:spin 0.8s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
  `],
})
export class ComponentIngestComponent {
  private readonly base = environment.ingestUrl;

  protected readonly mode = signal<'npm' | 'url' | 'file'>('npm');
  private static readonly MODES = ['npm', 'url', 'file'] as const;
  protected readonly modeIndex = computed(() => ComponentIngestComponent.MODES.indexOf(this.mode()));
  protected setModeByIndex(i: number): void { this.mode.set(ComponentIngestComponent.MODES[i] ?? 'npm'); }
  protected readonly npmSpec = signal('');
  protected readonly url = signal('');
  protected readonly file = signal<File | null>(null);
  protected readonly job = signal<IngestJob | null>(null);
  protected readonly busy = signal(false);
  protected readonly polling = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly selected = signal<Set<string>>(new Set());
  protected readonly filter = signal('');

  protected readonly canSubmit = computed(() =>
    this.mode() === 'npm' ? this.npmSpec().trim().length > 0
    : this.mode() === 'url' ? /^https?:\/\/\S+/.test(this.url().trim())
    : this.file() !== null);
  protected readonly selectedCount = computed(() => this.selected().size);
  protected readonly filtered = computed(() => {
    const comps = this.job()?.components ?? [];
    const f = this.filter().trim().toLowerCase();
    return f ? comps.filter((c) => c.name.toLowerCase().includes(f) || c.className.toLowerCase().includes(f)) : comps;
  });
  protected readonly logText = computed(() => (this.job()?.log ?? []).join('\n'));

  protected onFile(e: Event): void { this.file.set((e.target as HTMLInputElement).files?.[0] ?? null); }

  /** Discover the library's components (introspect only) so the user can choose. */
  protected discover(): void { this.selected.set(new Set()); void this.send({ discover: true }); }
  /** Skip selection — build every discovered component. */
  protected ingestAll(): void { void this.send({}); }
  /** Build only the checked components. */
  protected buildSelected(): void { void this.send({ include: [...this.selected()] }); }

  protected toggle(name: string): void {
    const next = new Set(this.selected());
    next.has(name) ? next.delete(name) : next.add(name);
    this.selected.set(next);
  }
  protected selectAll(): void { this.selected.set(new Set((this.job()?.components ?? []).map((c) => c.name))); }
  protected selectNone(): void { this.selected.set(new Set()); }

  private async send(opts: { discover?: boolean; include?: string[] }): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true); this.error.set(null);
    try {
      let res: Response;
      if (this.mode() === 'file' && this.file()) {
        const fd = new FormData();
        fd.append('file', this.file()!);
        if (opts.discover) fd.append('discover', 'true');
        if (opts.include) fd.append('include', JSON.stringify(opts.include));
        res = await fetch(`${this.base}/ingest`, { method: 'POST', body: fd });
      } else {
        const src = this.mode() === 'url' ? { url: this.url().trim() } : { npm: this.npmSpec().trim() };
        res = await fetch(`${this.base}/ingest`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...src, discover: opts.discover, include: opts.include }),
        });
      }
      const data = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok || !data.jobId) throw new Error(data.error ?? `service returned ${res.status}`);
      void this.poll(data.jobId);
    } catch (e) {
      this.error.set(`Could not reach the ingest service at ${this.base}. ${(e as Error).message}`);
    } finally {
      this.busy.set(false);
    }
  }

  private async poll(jobId: string): Promise<void> {
    this.polling.set(true);
    for (;;) {
      try {
        const res = await fetch(`${this.base}/ingest/${jobId}`);
        const j = (await res.json()) as IngestJob;
        this.job.set(j);
        if (j.phase === 'discovered') { if (!this.selected().size) this.selectAll(); break; }
        if (j.phase === 'registered' || j.phase === 'failed') break;
      } catch {
        this.job.update((cur) => cur ? { ...cur, phase: 'failed', error: 'lost contact with the ingest service' } : cur);
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    this.polling.set(false);
  }

  protected reset(): void {
    this.job.set(null); this.npmSpec.set(''); this.url.set(''); this.file.set(null);
    this.error.set(null); this.selected.set(new Set()); this.filter.set('');
  }
}
