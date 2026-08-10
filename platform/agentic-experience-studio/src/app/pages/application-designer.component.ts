import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CapabilityCatalogService } from '../services/capability-catalog.service';

interface NavEntry { title: string; path: string; page: string; icon?: string; order?: number }
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
  imports: [FormsModule, RouterLink],
  template: `
    <div class="wrap">
      <header class="head">
        <a routerLink="/applications" class="back">← Applications</a>
        <h1>{{ name() || 'Application' }} · Designer</h1>
        <span class="sp"></span>
        @if (saved()) { <span class="ok">✓ saved</span> }
        <button class="btn primary" (click)="save()" [disabled]="saving()">Save application</button>
      </header>

      @if (loading()) { <p class="muted">Loading…</p> }
      @else {
        <div class="grid">
          <aside class="col">
            <section class="card">
              <div class="eyebrow">Settings</div>
              <label class="lbl">Title</label>
              <input class="input" [(ngModel)]="title" placeholder="Acme Operations Workspace" />
              <label class="lbl">Description</label>
              <textarea class="input" rows="2" [(ngModel)]="description"></textarea>
              <label class="lbl">Master page (shell) <span class="muted sm">— header · menu · footer</span></label>
              <select class="input" [(ngModel)]="master">
                <option value="">— built-in default shell —</option>
                @for (m of masters(); track m.name) { <option [value]="m.name">{{ m.title }}</option> }
              </select>
              <label class="chk"><input type="checkbox" [(ngModel)]="assistantEnabled" /> Enable the AI assistant (ag-ui)</label>
            </section>

            <section class="card">
              <div class="eyebrow">Add a page <span class="muted sm">— authored in Page Studio</span></div>
              @if (!available().length) {
                <p class="muted sm">No more pages. <a routerLink="/pages">Create a page →</a></p>
              }
              @for (p of available(); track p.name) {
                <button class="palette" (click)="add(p)">
                  <span class="ic">▤</span>
                  <span class="pt"><span class="nm">{{ p.title }}</span><span class="gl">page · {{ p.name }}</span></span>
                  <span class="plus">＋</span>
                </button>
              }
            </section>
          </aside>

          <main class="col">
            <section class="card">
              <div class="eyebrow">Navigation (route tree) <span class="muted sm">— drag to reorder; each row is a URL</span></div>
              @if (!nav().length) { <p class="muted">Add pages from the left to build the app's navigation.</p> }
              <ol class="menu">
                @for (n of nav(); track n.page; let i = $index) {
                  <li class="row" draggable="true" (dragstart)="drag.set(i)" (dragover)="allow($event)" (drop)="drop(i)">
                    <span class="grip">⋮⋮</span>
                    <span class="ic">▤</span>
                    <span class="meta">
                      <input class="titlein" [ngModel]="n.title" (ngModelChange)="edit(i, 'title', $event)" placeholder="Label" />
                      <span class="pathline">/<input class="pathin" [ngModel]="n.path" (ngModelChange)="edit(i, 'path', $event)" placeholder="path" /> <span class="gl">→ {{ n.page }}</span></span>
                    </span>
                    <button class="x" (click)="remove(i)">✕</button>
                  </li>
                }
              </ol>
            </section>
          </main>
        </div>
      }
    </div>
  `,
  styles: [`
    .wrap { padding:20px 24px; max-width:1100px; margin:0 auto; }
    .head { display:flex; align-items:center; gap:14px; margin-bottom:18px; }
    .head h1 { font-size:18px; margin:0; } .back { font-size:13px; text-decoration:none; opacity:.7; } .sp { flex:1; }
    .ok { color:#0a7d32; font-size:13px; }
    .btn { font:inherit; padding:9px 16px; border-radius:9px; border:1px solid rgba(120,120,140,.3); background:transparent; color:inherit; cursor:pointer; }
    .btn.primary { background:#6750a4; color:#fff; border-color:#6750a4; font-weight:600; } .btn[disabled] { opacity:.5; }
    .grid { display:grid; grid-template-columns:320px 1fr; gap:18px; }
    .card { border:1px solid rgba(120,120,140,.18); border-radius:14px; padding:16px; margin-bottom:16px; }
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
  `],
})
export class ApplicationDesignerComponent {
  private readonly caps = inject(CapabilityCatalogService);

  readonly id = input.required<string>();

  protected readonly name = signal('');
  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly assistantEnabled = signal(true);
  protected readonly master = signal('');
  protected readonly nav = signal<NavEntry[]>([]);
  protected readonly pages = signal<PageItem[]>([]);
  protected readonly masters = signal<PageItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly drag = signal<number | null>(null);
  private assistantExtra: Record<string, unknown> = {};
  private otherBody: Record<string, unknown> = {};

  /** Studio-authored pages not already in the route tree. */
  protected readonly available = computed(() => {
    const inNav = new Set(this.nav().map((n) => n.page));
    return this.pages().filter((p) => !inNav.has(p.name));
  });

  constructor() { queueMicrotask(() => this.load()); }

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
      this.nav.set([...(b.nav ?? [])]);
      this.loading.set(false);
    });
  }

  private slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  protected add(p: PageItem): void {
    const path = this.slug(p.name.replace(/-page$/, '')) || this.slug(p.name);
    this.nav.update((cur) => [...cur, { title: p.title, path, page: p.name }]);
    this.saved.set(false);
  }
  protected remove(i: number): void { this.nav.update((cur) => cur.filter((_, idx) => idx !== i)); this.saved.set(false); }
  protected edit(i: number, key: 'title' | 'path', v: string): void {
    this.nav.update((cur) => cur.map((n, idx) => (idx === i ? { ...n, [key]: key === 'path' ? this.slug(v) : v } : n)));
    this.saved.set(false);
  }

  protected allow(e: DragEvent): void { e.preventDefault(); }
  protected drop(to: number): void {
    const from = this.drag();
    if (from === null || from === to) return;
    this.nav.update((cur) => { const n = [...cur]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n; });
    this.drag.set(null); this.saved.set(false);
  }

  protected save(): void {
    this.saving.set(true);
    const nav = this.nav().map((n, i) => ({ ...n, order: (i + 1) * 10 }));
    const body: Record<string, unknown> = {
      ...this.otherBody,          // preserve menu/personas/scopes etc.
      title: this.title(),
      description: this.description(),
      master: this.master() || undefined,
      assistant: { ...this.assistantExtra, enabled: this.assistantEnabled() },
      nav,
    };
    this.caps.update(this.id(), { body }).subscribe({
      next: () => { this.saving.set(false); this.saved.set(true); },
      error: () => { this.saving.set(false); },
    });
  }
}
