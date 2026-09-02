import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { wireDesignerLiveSync } from './designer-live-sync';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { CapabilityCatalogService } from '../services/capability-catalog.service';
import { buildTree, flattenTree, normalizeDepths, type NavEntry, type NavRow } from './application-nav';
import { LifecycleBarComponent, type BarAction } from '../lifecycle-bar.component';
import { HistoryPanelComponent } from '../history-panel.component';
import { applyCapability, canApproveWith, handleBarAction, reportWriteError, type GovState } from '../governance-actions';
import { AuthService } from '../services/auth.service';
import { ToastService } from '../services/toast.service';
import type { ApprovalState } from '../services/capability-catalog.service';
import type { Lifecycle } from '../lifecycle';
import type { HasUnsavedChanges } from '../guards/unsaved-changes.guard';

interface PageItem { name: string; title: string }

/**
 * Application Designer — composes a whole product (a `kind:'application'`
 * capability) from **Pages** authored in the Page Studio. The author builds the
 * app's route tree: pick pages, set each one's URL path + label, drag to reorder,
 * toggle the assistant. The runtime Experience Hub renders exactly this route
 * tree. Pages are NOT authored here — they are created in the Studio (kind:'page')
 * and merely referenced, so pages stay reusable and independently governed.
 */
@Component({
  selector: 'aes-application-designer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, LifecycleBarComponent, HistoryPanelComponent,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatCheckboxModule, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="wrap">
      <header class="head">
        <a routerLink="/applications" class="back">← Applications</a>
        <h1>{{ name() || 'Application' }} · Designer</h1>
        <span class="sp"></span>
        <aes-lifecycle-bar [lifecycle]="lifecycle()" [approvalState]="approvalState()" [canApprove]="canApprove()"
          [busy]="saving()" (action)="onBarAction($event)" (history)="showHistory.set(true)" />
        @if (saved()) { <span class="ok">✓ saved</span> }
        <button matButton="filled" (click)="save()" [disabled]="saving()">Save application</button>
      </header>

      @if (loading()) { <p class="muted">Loading…</p> }
      @else {
        <div class="grid">
          <aside class="col">
            <section class="card">
              <div class="eyebrow">Settings</div>
              <mat-form-field appearance="outline" class="mf">
                <mat-label>Title</mat-label>
                <input matInput [(ngModel)]="title" placeholder="Acme Operations Workspace" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="mf">
                <mat-label>Description</mat-label>
                <textarea matInput rows="2" [(ngModel)]="description"></textarea>
              </mat-form-field>
              <mat-form-field appearance="outline" class="mf">
                <mat-label>Master page (shell)</mat-label>
                <mat-select [(ngModel)]="master">
                  <mat-option value="">— built-in default shell —</mat-option>
                  @for (m of masters(); track m.name) { <mat-option [value]="m.name">{{ m.title }}</mat-option> }
                </mat-select>
                <mat-hint>header · menu · footer</mat-hint>
              </mat-form-field>
              <mat-checkbox [(ngModel)]="assistantEnabled">Enable the AI assistant (ag-ui)</mat-checkbox>
            </section>

            <section class="card">
              <div class="eyebrow">Add a page <span class="muted sm">— authored in Page Studio</span></div>
              @if (!available().length) {
                <p class="muted sm">No more pages. <a routerLink="/pages">Create a page →</a></p>
              }
              @for (p of available(); track p.name) {
                <button class="palette" (click)="add(p)">
                  <span class="ic"><mat-icon>article</mat-icon></span>
                  <span class="pt"><span class="nm">{{ p.title }}</span><span class="gl">page · {{ p.name }}</span></span>
                  <span class="plus"><mat-icon>add</mat-icon></span>
                </button>
              }
            </section>
          </aside>

          <main class="col">
            <section class="card">
              <div class="eyebrow">Navigation (route tree) <span class="muted sm">— drag to reorder · ← → to nest · icon + personas per entry</span></div>
              @if (!nav().length) { <p class="muted">Add pages from the left to build the app's navigation.</p> }
              <ol class="menu">
                @for (n of nav(); track $index; let i = $index) {
                  <li class="row" [class.child]="n.depth > 0" [style.marginLeft.px]="n.depth * 22"
                      draggable="true" (dragstart)="drag.set(i)" (dragover)="allow($event)" (drop)="drop(i)">
                    <mat-icon class="grip">drag_indicator</mat-icon>
                    <input class="iconin" [ngModel]="n.icon ?? ''" (ngModelChange)="setIcon(i, $event)" placeholder="▤" title="Icon (emoji or glyph)" aria-label="Icon" maxlength="2" />
                    <span class="meta">
                      <input class="titlein" [ngModel]="n.title" (ngModelChange)="edit(i, 'title', $event)" placeholder="Label" />
                      <span class="pathline">/<input class="pathin" [ngModel]="n.path" (ngModelChange)="edit(i, 'path', $event)" placeholder="path" /> <span class="gl">→ {{ n.page }}</span></span>
                    </span>
                    <input class="personasin" [ngModel]="personasText(n)" (ngModelChange)="setPersonas(i, $event)" placeholder="all personas" title="Comma-separated personas; empty = visible to all" aria-label="Personas" />
                    <span class="navctrls">
                      <button class="mv" (click)="outdent(i)" [disabled]="n.depth === 0" matTooltip="Outdent" aria-label="Outdent"><mat-icon>format_indent_decrease</mat-icon></button>
                      <button class="mv" (click)="indent(i)" [disabled]="!canIndent(i)" matTooltip="Indent (nest under previous)" aria-label="Indent"><mat-icon>format_indent_increase</mat-icon></button>
                      <button class="x" (click)="remove(i)" aria-label="Remove" matTooltip="Remove"><mat-icon>close</mat-icon></button>
                    </span>
                  </li>
                }
              </ol>
            </section>
          </main>
        </div>
      }
      @if (showHistory()) { <aes-history-panel [capabilityId]="id()" (close)="showHistory.set(false)" (changed)="reload()" /> }
    </div>
  `,
  styles: [`
    button mat-icon { font-size:16px; width:16px; height:16px; vertical-align:middle; }
    .navctrls .x, .row .x, .navctrls .mv { display:inline-grid; place-items:center; }
    .grip { font-size:18px; width:18px; height:18px; }
    .ic mat-icon { font-size:16px; width:16px; height:16px; }
    .plus mat-icon { font-size:16px; width:16px; height:16px; }
    .wrap { padding:20px 24px; max-width:1100px; margin:0 auto; }
    .head { display:flex; align-items:center; gap:14px; margin-bottom:18px; }
    .head h1 { font-size:18px; margin:0; } .back { font-size:13px; text-decoration:none; opacity:.7; } .sp { flex:1; }
    .ok { color:#0a7d32; font-size:13px; }
    .btn { font:inherit; padding:9px 16px; border-radius:9px; border:1px solid rgba(120,120,140,.3); background:transparent; color:inherit; cursor:pointer; }
    .btn.primary { background:#6750a4; color:#fff; border-color:#6750a4; font-weight:600; } .btn[disabled] { opacity:.5; }
    .grid { display:grid; grid-template-columns:320px 1fr; gap:18px; }
    .card { border:1px solid rgba(120,120,140,.18); border-radius:14px; padding:16px; margin-bottom:16px; }
    .mf { width:100%; display:block; }
    .eyebrow { font-size:11px; text-transform:uppercase; letter-spacing:.06em; opacity:.55; margin-bottom:10px; }
    .muted { opacity:.6; } .sm { font-size:12px; }
    .lbl { display:block; font-size:12px; font-weight:600; margin:10px 0 5px; opacity:.8; }
    .input { width:100%; padding:9px 11px; border:1px solid rgba(120,120,140,.3); border-radius:8px; background:transparent; color:inherit; font:inherit; }
    .chk { display:flex; align-items:center; gap:8px; margin-top:14px; font-size:13px; cursor:pointer; }
    .palette { display:flex; align-items:center; gap:10px; width:100%; padding:9px 10px; margin-top:8px; border:1px solid rgba(120,120,140,.22); border-radius:9px; background:transparent; color:inherit; cursor:pointer; text-align:left; }
    .palette:hover { background:rgba(103,80,164,.06); } .palette .plus { margin-left:auto; opacity:.5; }
    .ic { display:grid; place-items:center; width:26px; height:26px; border-radius:7px; background:rgba(103,80,164,.14); color:#6750a4; font-size:13px; }
    .pt, .meta { display:flex; flex-direction:column; min-width:0; } .nm { font-size:13.5px; font-weight:600; } .gl { font-size:11px; opacity:.55; }
    .menu { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
    .row { display:flex; align-items:center; gap:11px; padding:10px 11px; border:1px solid rgba(120,120,140,.2); border-radius:10px; background:rgba(120,120,140,.03); cursor:grab; }
    .grip { opacity:.4; } .row .x { margin-left:auto; border:none; background:transparent; color:inherit; opacity:.5; cursor:pointer; }
    .titlein { border:none; background:transparent; color:inherit; font:inherit; font-size:13.5px; font-weight:600; padding:0; width:100%; }
    .pathline { display:flex; align-items:center; gap:6px; font-size:11px; opacity:.7; }
    .pathin { border:none; border-bottom:1px solid rgba(120,120,140,.3); background:transparent; color:inherit; font:inherit; font-size:11px; width:90px; padding:0 0 1px; }
    .row .meta { flex:1; }
    .row.child { background:rgba(103,80,164,.04); border-left:2px solid rgba(103,80,164,.35); }
    .iconin { width:28px; text-align:center; border:1px solid rgba(120,120,140,.25); border-radius:7px; background:transparent; color:inherit; font:inherit; font-size:14px; padding:4px 0; }
    .personasin { width:120px; border:1px solid rgba(120,120,140,.25); border-radius:7px; background:transparent; color:inherit; font:inherit; font-size:11px; padding:5px 7px; }
    .navctrls { display:inline-flex; align-items:center; gap:2px; margin-left:2px; }
    .navctrls .mv, .navctrls .x { border:none; background:transparent; color:inherit; opacity:.5; cursor:pointer; padding:2px 5px; font-size:12px; }
    .navctrls .mv:hover:not([disabled]), .navctrls .x:hover { opacity:1; } .navctrls .mv[disabled] { opacity:.18; cursor:default; }
    @media (max-width: 860px) {
      .grid { grid-template-columns:1fr; gap:14px; }
      .wrap { padding:16px 14px; }
    }
  `],
})
export class ApplicationDesignerComponent implements HasUnsavedChanges {
  private readonly caps = inject(CapabilityCatalogService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  readonly id = input.required<string>();

  protected readonly name = signal('');
  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly assistantEnabled = signal(true);
  protected readonly master = signal('');
  protected readonly nav = signal<NavRow[]>([]);
  protected readonly pages = signal<PageItem[]>([]);
  protected readonly masters = signal<PageItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly lifecycle = signal<Lifecycle>('draft');
  protected readonly approvalState = signal<ApprovalState>('draft');
  protected readonly capVersion = signal(0);
  protected readonly showHistory = signal(false);
  protected readonly canApprove = computed(() => canApproveWith(this.auth.roles()));
  private pristine = '';
  protected readonly drag = signal<number | null>(null);
  private assistantExtra: Record<string, unknown> = {};
  private otherBody: Record<string, unknown> = {};

  /** Studio-authored pages not already in the route tree. */
  protected readonly available = computed(() => {
    const inNav = new Set(this.nav().map((n) => n.page));
    return this.pages().filter((p) => !inNav.has(p.name));
  });

  constructor() { wireDesignerLiveSync({ id: () => this.id(), reload: () => this.reload(), isDirty: () => this.hasUnsavedChanges() }); }

  private load(): void {
    const item = (c: { name: string; body: Record<string, unknown> }) => ({ name: c.name, title: (c.body?.['title'] as string) ?? c.name });
    // Pages are all kind:'page'; a page's `type` decides content (route tree) vs shell (master).
    this.caps.listByKind('page').subscribe((r) => {
      this.pages.set(r.items.filter((c) => c.body?.['type'] !== 'shell').map(item));
      this.masters.set(r.items.filter((c) => c.body?.['type'] === 'shell').map(item));
    });
    this.caps.get(this.id()).subscribe((c) => {
      const b = c.body as { title?: string; description?: string; master?: string; assistant?: Record<string, unknown>; nav?: NavEntry[] };
      this.name.set(c.name);
      this.title.set(b.title ?? c.name);
      this.description.set(b.description ?? '');
      this.master.set(b.master ?? '');
      const asst = b.assistant ?? {};
      this.assistantEnabled.set(asst['enabled'] !== false);
      this.assistantExtra = asst;
      this.otherBody = { ...(c.body as Record<string, unknown>) };
      this.nav.set(flattenTree(b.nav ?? []));
      applyCapability(this.gov(), c);
      this.loading.set(false);
      this.pristine = this.snapshot();
    });
  }

  // ── governance + unsaved-changes guard ──────────────────────────────────────
  private snapshot(): string {
    return JSON.stringify({ title: this.title(), description: this.description(), master: this.master(), assistant: this.assistantEnabled(), nav: this.nav() });
  }
  hasUnsavedChanges(): boolean { return !this.loading() && this.snapshot() !== this.pristine; }
  private gov(): GovState { return { lifecycle: this.lifecycle, approvalState: this.approvalState, version: this.capVersion }; }
  protected onBarAction(a: BarAction): void { handleBarAction(a, this.id(), this.gov(), this.caps, this.toast); }
  protected reload(): void { this.load(); }

  private slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  protected add(p: PageItem): void {
    const path = this.slug(p.name.replace(/-page$/, '')) || this.slug(p.name);
    this.nav.update((cur) => [...cur, { title: p.title, path, page: p.name, depth: 0 }]);
    this.saved.set(false);
  }
  protected remove(i: number): void { this.mutNav((rows) => rows.splice(i, 1)); }
  protected edit(i: number, key: 'title' | 'path', v: string): void {
    this.nav.update((cur) => cur.map((n, idx) => (idx === i ? { ...n, [key]: key === 'path' ? this.slug(v) : v } : n)));
    this.saved.set(false);
  }
  protected setIcon(i: number, v: string): void { this.nav.update((cur) => cur.map((n, idx) => (idx === i ? { ...n, icon: v || undefined } : n))); this.saved.set(false); }
  protected personasText(n: NavRow): string { return (n.personas ?? []).join(', '); }
  protected setPersonas(i: number, v: string): void {
    const list = v.split(/[\s,]+/).filter(Boolean);
    this.nav.update((cur) => cur.map((n, idx) => (idx === i ? { ...n, personas: list.length ? list : undefined } : n)));
    this.saved.set(false);
  }

  /** Can this row nest under the previous one? (needs a previous row at >= its depth) */
  protected canIndent(i: number): boolean { const rows = this.nav(); return i > 0 && rows[i].depth <= rows[i - 1].depth; }
  protected indent(i: number): void { this.mutNav((rows) => { rows[i] = { ...rows[i], depth: rows[i].depth + 1 }; }); }
  protected outdent(i: number): void { this.mutNav((rows) => { rows[i] = { ...rows[i], depth: Math.max(0, rows[i].depth - 1) }; }); }

  private mutNav(fn: (rows: NavRow[]) => void): void {
    this.nav.update((cur) => { const rows = cur.map((n) => ({ ...n })); fn(rows); normalizeDepths(rows); return rows; });
    this.saved.set(false);
  }

  protected allow(e: DragEvent): void { e.preventDefault(); }
  protected drop(to: number): void {
    const from = this.drag();
    if (from === null || from === to) { this.drag.set(null); return; }
    this.mutNav((rows) => { const [m] = rows.splice(from, 1); rows.splice(to, 0, m!); });
    this.drag.set(null);
  }

  protected save(): void {
    this.saving.set(true);
    const nav = buildTree(this.nav());
    const body: Record<string, unknown> = {
      ...this.otherBody,          // preserve menu/personas/scopes etc.
      title: this.title(),
      description: this.description(),
      master: this.master() || undefined,
      assistant: { ...this.assistantExtra, enabled: this.assistantEnabled() },
      nav,
    };
    this.caps.update(this.id(), { body }, this.capVersion()).subscribe({
      next: (c) => { this.saving.set(false); this.saved.set(true); this.pristine = this.snapshot(); applyCapability(this.gov(), c); },
      error: (e) => { this.saving.set(false); reportWriteError(this.toast, e); },
    });
  }
}
