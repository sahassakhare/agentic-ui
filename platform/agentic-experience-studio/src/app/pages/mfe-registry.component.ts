import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../environments/environment';
import { CapabilityCatalogService } from '../services/capability-catalog.service';
import { ToastService } from '../services/toast.service';
import { ConfirmService } from '../services/confirm.service';

interface RemoteRecord {
  remoteName: string;
  version: string;
  remoteEntry: string;
  env?: string;
  disabled?: boolean;
  source?: { npm?: string; url?: string };
  ingestedAt?: string;
}

/**
 * MFEs (Remotes) — the federated remotes the Hub loads, as reported by the
 * component-ingest service (`GET /admin/remotes`). Read + manage: enable/disable
 * (a disabled remote drops out of the Hub's `registry.json`), remove (registry
 * entry + served artifacts + its catalog component rows), and re-ingest (rebuild
 * from the stored npm/URL source). Each remote lists the components it exposes,
 * cross-referenced from the catalog's `kind:'component'` rows by `remoteName`.
 */
@Component({
  selector: 'aes-mfe-registry',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="wrap">
      <div class="head">
        <div>
          <h1>MFEs <span class="muted">· federated remotes</span></h1>
          <p class="muted sm">Remotes the Hub loads at boot. Built by the ingest service; managed here.</p>
        </div>
        <div class="head-actions">
          <button class="btn" (click)="load()" [disabled]="busy()">↻ Refresh</button>
          <a class="btn primary" routerLink="/components/upload">⬆ Upload library</a>
        </div>
      </div>

      @if (error()) { <p class="err">{{ error() }}</p> }

      @if (!remotes().length && !error()) {
        <div class="empty muted">No remotes registered. <a routerLink="/components/upload">Upload a component library</a> to create one.</div>
      }

      <div class="list">
        @for (r of remotes(); track r.remoteName) {
          <section class="card" [class.off]="r.disabled">
            <div class="row">
              <div class="ident">
                <span class="dot" [class.on]="!r.disabled"></span>
                <b>{{ r.remoteName }}</b>
                <span class="ver">v{{ r.version }}</span>
                @if (r.env) { <span class="chip">{{ r.env }}</span> }
                @if (r.disabled) { <span class="chip off">disabled</span> }
              </div>
              <div class="acts">
                <button class="btn sm" (click)="toggle(r)" [disabled]="pending().has(r.remoteName)">{{ r.disabled ? 'Enable' : 'Disable' }}</button>
                <button class="btn sm" (click)="reingest(r)" [disabled]="pending().has(r.remoteName) || !reingestable(r)" [title]="reingestable(r) ? 'Rebuild from source' : 'No stored source — re-upload'">↺ Re-ingest</button>
                <button class="btn sm danger" (click)="remove(r)" [disabled]="pending().has(r.remoteName)">Remove</button>
              </div>
            </div>
            <div class="meta muted sm">
              <a [href]="r.remoteEntry" target="_blank" rel="noopener">{{ r.remoteEntry }}</a>
              @if (r.source?.npm) { <span>· npm: {{ r.source!.npm }}</span> }
              @if (r.source?.url) { <span>· url</span> }
              @if (r.ingestedAt) { <span>· ingested {{ r.ingestedAt }}</span> }
            </div>
            @if (componentsOf(r.remoteName).length) {
              <div class="comps">
                <span class="eyebrow">{{ componentsOf(r.remoteName).length }} component(s)</span>
                @for (name of componentsOf(r.remoteName); track name) { <span class="wchip">⛃ {{ name }}</span> }
              </div>
            }
          </section>
        }
      </div>
    </div>
  `,
  styles: [`
    .wrap { padding:20px 24px; max-width:920px; margin:0 auto; }
    .head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; }
    h1 { font-size:20px; margin:0 0 4px; } .muted { opacity:.65; } .sm { font-size:12px; } h1 .muted { font-weight:400; font-size:15px; }
    .head-actions { display:flex; gap:8px; }
    .btn { font:inherit; padding:8px 14px; border-radius:9px; border:1px solid rgba(120,120,140,.3); background:transparent; color:inherit; cursor:pointer; text-decoration:none; display:inline-flex; align-items:center; }
    .btn.primary { background:#6750a4; color:#fff; border-color:#6750a4; font-weight:600; } .btn.sm { padding:5px 10px; font-size:12px; } .btn.danger:hover { border-color:#c0392b; color:#c0392b; } .btn[disabled] { opacity:.5; cursor:default; }
    .err { color:#c0392b; font-size:13px; } .empty { margin-top:20px; }
    .list { display:flex; flex-direction:column; gap:10px; margin-top:16px; }
    .card { border:1px solid rgba(120,120,140,.2); border-radius:12px; padding:14px 16px; } .card.off { opacity:.6; }
    .row { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
    .ident { display:flex; align-items:center; gap:8px; } .ident b { font-size:15px; }
    .dot { width:8px; height:8px; border-radius:50%; background:#c0392b; display:inline-block; } .dot.on { background:#0a7d32; }
    .ver { font-family:ui-monospace,Menlo,monospace; font-size:12px; opacity:.7; }
    .chip { font-size:11px; padding:2px 8px; border-radius:999px; background:rgba(103,80,164,.14); color:#6750a4; } .chip.off { background:rgba(192,57,43,.14); color:#c0392b; }
    .acts { display:flex; gap:6px; }
    .meta { margin-top:8px; display:flex; gap:8px; flex-wrap:wrap; } .meta a { color:inherit; }
    .comps { margin-top:10px; display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
    .eyebrow { font-size:10px; text-transform:uppercase; letter-spacing:.06em; opacity:.55; margin-right:4px; }
    .wchip { font-family:ui-monospace,Menlo,monospace; font-size:11px; color:#6750a4; background:rgba(103,80,164,.1); padding:2px 8px; border-radius:999px; }
  `],
})
export class MfeRegistryComponent {
  private readonly base = environment.ingestUrl;
  private readonly catalog = inject(CapabilityCatalogService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly remotes = signal<RemoteRecord[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly pending = signal<ReadonlySet<string>>(new Set());
  /** remoteName → exposed component widget names (from kind:'component' rows). */
  private readonly componentsByRemote = signal<Record<string, string[]>>({});

  protected readonly reingestable = (r: RemoteRecord) => !!(r.source?.npm || r.source?.url);
  protected componentsOf(name: string): string[] { return this.componentsByRemote()[name] ?? []; }

  constructor() { this.load(); }

  protected load(): void {
    this.busy.set(true); this.error.set(null);
    fetch(`${this.base}/admin/remotes`)
      .then((res) => { if (!res.ok) throw new Error(`ingest service returned ${res.status}`); return res.json(); })
      .then((d: { remotes: RemoteRecord[] }) => this.remotes.set(d.remotes ?? []))
      .catch((e: Error) => this.error.set(`Could not reach the ingest service at ${this.base}. ${e.message}`))
      .finally(() => this.busy.set(false));
    // Cross-reference the catalog's component rows to show what each remote exposes.
    this.catalog.listByKind('component').subscribe({
      next: (r) => {
        const map: Record<string, string[]> = {};
        for (const c of r.items) {
          const remote = (c.body as { remoteName?: string } | undefined)?.remoteName;
          if (remote) (map[remote] ??= []).push(c.name);
        }
        this.componentsByRemote.set(map);
      },
      error: () => {},
    });
  }

  private mark(name: string, on: boolean): void {
    this.pending.update((s) => { const n = new Set(s); on ? n.add(name) : n.delete(name); return n; });
  }

  protected toggle(r: RemoteRecord): void {
    this.mark(r.remoteName, true);
    fetch(`${this.base}/admin/remotes/${encodeURIComponent(r.remoteName)}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ disabled: !r.disabled }),
    })
      .then((res) => { if (!res.ok) throw new Error(`${res.status}`); this.toast.success(r.disabled ? 'Enabled' : 'Disabled', `${r.remoteName} ${r.disabled ? 'will load' : 'removed from the Hub registry'}.`); this.load(); })
      .catch((e: Error) => this.toast.error('Failed', e.message))
      .finally(() => this.mark(r.remoteName, false));
  }

  protected async remove(r: RemoteRecord): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Remove remote?',
      message: `Remove “${r.remoteName}”? This deletes its served artifacts and its catalog component rows.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    this.mark(r.remoteName, true);
    fetch(`${this.base}/admin/remotes/${encodeURIComponent(r.remoteName)}`, { method: 'DELETE' })
      .then((res) => res.json().then((d) => ({ ok: res.ok, d })))
      .then(({ ok, d }) => { if (!ok) throw new Error(d?.error ?? 'remove failed'); this.toast.success('Removed', `${r.remoteName} removed (${d.catalogRowsRemoved ?? 0} catalog rows).`); this.load(); })
      .catch((e: Error) => this.toast.error('Failed', e.message))
      .finally(() => this.mark(r.remoteName, false));
  }

  protected reingest(r: RemoteRecord): void {
    this.mark(r.remoteName, true);
    fetch(`${this.base}/admin/remotes/${encodeURIComponent(r.remoteName)}/reingest`, { method: 'POST' })
      .then((res) => res.json().then((d) => ({ ok: res.ok, d })))
      .then(({ ok, d }) => { if (!ok) throw new Error(d?.error ?? 'reingest failed'); this.toast.success('Re-ingest started', `Rebuilding ${r.remoteName}. It updates when the build completes.`); })
      .catch((e: Error) => this.toast.error('Failed', e.message))
      .finally(() => this.mark(r.remoteName, false));
  }
}
