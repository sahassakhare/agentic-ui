import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CapabilityCatalogService } from '../services/capability-catalog.service';
import { ExperienceCatalogService } from '../services/experience-catalog.service';

type PageType = 'content' | 'shell';
type SurfaceKind = 'experience' | 'dashboard' | 'form' | 'workflow' | 'component' | 'layout';
type PageLayout = 'single' | 'two-column' | 'sidebar-right' | 'sidebar-left' | 'stacked' | 'grid';
interface Surface { kind: SurfaceKind; name: string; props: Record<string, unknown> }
interface PaletteItem { kind: SurfaceKind; name: string; title: string }
interface PaletteGroup { category: string; items: PaletteItem[] }

const TEMPLATE_REGIONS: Record<PageLayout, string[]> = {
  'single': ['main'], 'two-column': ['left', 'right'], 'sidebar-right': ['main', 'aside'],
  'sidebar-left': ['aside', 'main'], 'stacked': ['top', 'main'], 'grid': ['a', 'b', 'c'],
};
const CONTENT_LAYOUTS = Object.keys(TEMPLATE_REGIONS) as PageLayout[];
const SHELL_REGIONS = ['header', 'sidenav', 'aside', 'footer'];
const KIND_GLYPH: Record<string, string> = { dashboard: '▦', experience: '›', form: '▤', workflow: '⇉', component: '◫', layout: '◧' };

// Shell components + their editable props (shell mode).
const SHELL_COMPONENTS: PaletteItem[] = [
  { kind: 'component', name: 'app-logo', title: 'Logo' },
  { kind: 'component', name: 'app-header', title: 'Header' },
  { kind: 'component', name: 'app-sidenav', title: 'Sidenav' },
  { kind: 'component', name: 'app-footer', title: 'Footer' },
  { kind: 'component', name: 'app-assistant', title: 'Assistant' },
];
interface PropField { key: string; label: string; type: 'text' | 'bool' | 'links' }
const PROP_FIELDS: Record<string, PropField[]> = {
  'app-logo': [{ key: 'text', label: 'Text', type: 'text' }, { key: 'mark', label: 'Mark', type: 'text' }, { key: 'src', label: 'Image URL', type: 'text' }],
  'app-header': [{ key: 'title', label: 'Title', type: 'text' }],
  'app-sidenav': [{ key: 'title', label: 'Section title', type: 'text' }],
  'app-footer': [{ key: 'text', label: 'Text', type: 'text' }, { key: 'links', label: 'Links', type: 'links' }],
  'app-assistant': [{ key: 'title', label: 'Title', type: 'text' }, { key: 'placeholder', label: 'Placeholder', type: 'text' }],
};

/**
 * Page Designer — one designer for both page **types**:
 *  - `content` — a leaf page: pick a layout template, drop surfaces (grouped by
 *    category) into its regions.
 *  - `shell` (a master page) — the app shell: drop shell components (logo, header,
 *    sidenav, footer, assistant) into shell regions around the page-content outlet,
 *    and configure their props.
 * Saves a `kind:'page'` capability with its `type`. Applications reference a shell
 * page as their master. There is no separate "master page" concept any more.
 */
@Component({
  selector: 'aes-page-designer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="wrap">
      <header class="head">
        <a routerLink="/pages" class="back">← Pages</a>
        <h1>{{ name() || 'Page' }} · Designer</h1>
        <div class="typetoggle">
          <button [class.on]="type() === 'content'" (click)="setType('content')">Content page</button>
          <button [class.on]="type() === 'shell'" (click)="setType('shell')">Master (shell)</button>
        </div>
        <span class="sp"></span>
        @if (saved()) { <span class="ok">✓ saved</span> }
        <button class="btn primary" (click)="save()" [disabled]="saving()">Save page</button>
      </header>

      @if (loading()) { <p class="muted">Loading…</p> }
      @else {
        <div class="grid">
          <aside class="col">
            @if (type() === 'content') {
              <section class="card">
                <div class="eyebrow">Layout template</div>
                <div class="templates">
                  @for (l of contentLayouts; track l) { <button class="tpl" [class.on]="layout() === l" (click)="setLayout(l)">{{ l }}</button> }
                </div>
                <label class="lbl">Access — personas</label>
                <input class="input" [(ngModel)]="personas" placeholder="admin, ops-manager" />
                <label class="lbl">Access — scopes</label>
                <input class="input" [(ngModel)]="scopes" placeholder="ops:read" />
              </section>
            }

            <section class="card">
              <div class="eyebrow">Add to <b>{{ activeRegion() }}</b> <span class="muted sm">— click a region, then a block</span></div>
              @for (g of palette(); track g.category) {
                <div class="cat">{{ g.category }}</div>
                @for (it of g.items; track it.kind + ':' + it.name) {
                  <button class="palette" (click)="add(it)">
                    <span class="ic" [class.dash]="it.kind === 'dashboard'">{{ glyph(it.kind) }}</span>
                    <span class="pt"><span class="nm">{{ it.title }}</span><span class="gl">{{ it.kind }} · {{ it.name }}</span></span>
                    <span class="plus">＋</span>
                  </button>
                }
              }
            </section>

            @if (selected(); as sel) {
              <section class="card">
                <div class="eyebrow">Properties · {{ sel.name }}</div>
                @if (!propFields(sel.name).length) { <p class="muted sm">This block has no configurable props.</p> }
                @for (f of propFields(sel.name); track f.key) {
                  @switch (f.type) {
                    @case ('links') {
                      <label class="lbl">{{ f.label }}</label>
                      @for (l of asLinks(propVal(sel, f.key)); track $index) {
                        <div class="linkrow">
                          <input class="input sm" [ngModel]="l.label" (ngModelChange)="editLink($index, 'label', $event)" placeholder="Label" />
                          <input class="input sm" [ngModel]="l.href" (ngModelChange)="editLink($index, 'href', $event)" placeholder="https://…" />
                          <button class="x" (click)="removeLink($index)">✕</button>
                        </div>
                      }
                      <button class="btn ghost sm" (click)="addLink()">＋ Add link</button>
                    }
                    @default { <label class="lbl">{{ f.label }}</label><input class="input" [ngModel]="propVal(sel, f.key)" (ngModelChange)="setProp(f.key, $event)" /> }
                  }
                }
              </section>
            }
          </aside>

          <main class="col">
            <section class="card">
              <div class="eyebrow">
                @if (type() === 'shell') { Shell regions <span class="muted sm">— content (pages) renders in the centre</span> }
                @else { Regions · <span class="muted">{{ layout() }}</span> }
              </div>
              <div class="regions" [attr.data-shell]="type() === 'shell'">
                @for (r of regionNames(); track r) {
                  <div class="region" [class.on]="activeRegion() === r" (click)="activeRegion.set(r)">
                    <div class="rhead">{{ r }} <span class="muted sm">{{ (regions()[r] || []).length }}</span></div>
                    @for (s of regions()[r]; track $index) {
                      <div class="block" [class.sel]="isSelected(r, $index)" (click)="select(r, $index, $event)">
                        <span class="ic" [class.dash]="s.kind === 'dashboard'">{{ glyph(s.kind) }}</span>
                        <span class="bm"><span class="nm">{{ s.name }}</span><span class="gl">{{ s.kind }}</span></span>
                        <button class="x" (click)="remove(r, $index, $event)">✕</button>
                      </div>
                    } @empty { <div class="drop">click, then add →</div> }
                  </div>
                }
                @if (type() === 'shell') { <div class="region content"><div class="rhead">content</div><div class="ph">Pages (router-outlet)</div></div> }
              </div>
            </section>
          </main>
        </div>
      }
    </div>
  `,
  styles: [`
    .wrap { padding:20px 24px; max-width:1150px; margin:0 auto; }
    .head { display:flex; align-items:center; gap:14px; margin-bottom:18px; }
    .head h1 { font-size:18px; margin:0; } .back { font-size:13px; text-decoration:none; opacity:.7; } .sp { flex:1; }
    .typetoggle { display:inline-flex; border:1px solid rgba(120,120,140,.3); border-radius:9px; overflow:hidden; }
    .typetoggle button { font:inherit; font-size:12.5px; padding:6px 12px; border:none; background:transparent; color:inherit; cursor:pointer; }
    .typetoggle button.on { background:#6750a4; color:#fff; }
    .ok { color:#0a7d32; font-size:13px; }
    .btn { font:inherit; padding:9px 16px; border-radius:9px; border:1px solid rgba(120,120,140,.3); background:transparent; color:inherit; cursor:pointer; }
    .btn.primary { background:#6750a4; color:#fff; border-color:#6750a4; font-weight:600; } .btn[disabled] { opacity:.5; }
    .btn.ghost.sm { font-size:12px; padding:6px 10px; margin-top:8px; }
    .grid { display:grid; grid-template-columns:340px 1fr; gap:18px; }
    .card { border:1px solid rgba(120,120,140,.18); border-radius:14px; padding:16px; margin-bottom:16px; }
    .eyebrow { font-size:11px; text-transform:uppercase; letter-spacing:.06em; opacity:.55; margin-bottom:10px; }
    .muted { opacity:.6; } .sm { font-size:12px; }
    .lbl { display:block; font-size:12px; font-weight:600; margin:12px 0 5px; opacity:.8; }
    .input { width:100%; padding:9px 11px; border:1px solid rgba(120,120,140,.3); border-radius:8px; background:transparent; color:inherit; font:inherit; } .input.sm { padding:7px 9px; font-size:12.5px; }
    .templates { display:flex; flex-wrap:wrap; gap:6px; } .tpl { font:inherit; font-size:12px; padding:6px 10px; border:1px solid rgba(120,120,140,.3); border-radius:8px; background:transparent; color:inherit; cursor:pointer; } .tpl.on { background:rgba(103,80,164,.14); border-color:#6750a4; color:#6750a4; }
    .cat { font-size:11px; text-transform:uppercase; letter-spacing:.05em; opacity:.5; margin:12px 0 4px; }
    .palette { display:flex; align-items:center; gap:10px; width:100%; padding:8px 10px; margin-top:6px; border:1px solid rgba(120,120,140,.22); border-radius:9px; background:transparent; color:inherit; cursor:pointer; text-align:left; } .palette:hover { background:rgba(103,80,164,.06); } .palette .plus { margin-left:auto; opacity:.5; }
    .ic { display:grid; place-items:center; width:24px; height:24px; border-radius:6px; background:rgba(120,120,140,.14); font-size:12px; } .ic.dash { background:rgba(103,80,164,.18); color:#6750a4; }
    .pt, .bm { display:flex; flex-direction:column; min-width:0; } .nm { font-size:13px; font-weight:600; } .gl { font-size:11px; opacity:.55; }
    .linkrow { display:grid; grid-template-columns:1fr 1.3fr auto; gap:6px; margin-top:6px; align-items:center; } .linkrow .x { border:none; background:transparent; color:inherit; opacity:.5; cursor:pointer; }
    .regions { display:grid; gap:14px; }
    .regions[data-shell='true'] { grid-template-columns:1fr 1fr; }
    .region { border:1.5px dashed rgba(120,120,140,.3); border-radius:12px; padding:12px; min-height:80px; cursor:pointer; } .region.on { border-color:#6750a4; background:rgba(103,80,164,.05); }
    .region.content { grid-column:1 / -1; background:rgba(120,120,140,.04); cursor:default; }
    .rhead { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; opacity:.7; margin-bottom:8px; }
    .block { display:flex; align-items:center; gap:9px; padding:8px 10px; margin-top:6px; border:1px solid rgba(120,120,140,.2); border-radius:9px; background:rgba(120,120,140,.03); } .block.sel { border-color:#6750a4; background:rgba(103,80,164,.08); }
    .block .x { margin-left:auto; border:none; background:transparent; color:inherit; opacity:.5; cursor:pointer; }
    .drop { font-size:12px; opacity:.45; padding:6px 2px; } .ph { border:1.5px dashed rgba(120,120,140,.25); border-radius:8px; padding:14px; text-align:center; font-size:12px; opacity:.5; }
  `],
})
export class PageDesignerComponent {
  private readonly caps = inject(CapabilityCatalogService);
  private readonly experiences = inject(ExperienceCatalogService);

  readonly id = input.required<string>();

  protected readonly contentLayouts = CONTENT_LAYOUTS;
  protected readonly name = signal('');
  protected readonly type = signal<PageType>('content');
  protected readonly layout = signal<PageLayout>('single');
  protected readonly regions = signal<Record<string, Surface[]>>({ main: [] });
  protected readonly activeRegion = signal('main');
  protected readonly selection = signal<{ region: string; index: number } | null>(null);
  protected readonly personas = signal('');
  protected readonly scopes = signal('');
  protected readonly surfacePalette = signal<PaletteGroup[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);

  protected readonly regionNames = computed(() => this.type() === 'shell' ? SHELL_REGIONS : TEMPLATE_REGIONS[this.layout()]);
  /** Both page types share the SAME palette — every surface + shell components. */
  protected readonly palette = computed<PaletteGroup[]>(() => this.surfacePalette());
  protected readonly selected = computed<Surface | null>(() => {
    const s = this.selection();
    return s ? this.regions()[s.region]?.[s.index] ?? null : null;
  });

  constructor() { queueMicrotask(() => this.load()); }

  protected glyph(kind: string): string { return KIND_GLYPH[kind] ?? '›'; }
  protected propFields(name: string): PropField[] { return PROP_FIELDS[name] ?? []; }
  protected asLinks(v: unknown): { label: string; href: string }[] { return (Array.isArray(v) ? v : []) as { label: string; href: string }[]; }
  protected propVal(s: Surface, key: string): unknown { return s.props[key]; }
  protected isSelected(r: string, i: number): boolean { const s = this.selection(); return !!s && s.region === r && s.index === i; }

  private load(): void {
    const groups: PaletteGroup[] = [
      { category: 'Experiences', items: [] }, { category: 'Dashboards', items: [] },
      { category: 'Forms', items: [] }, { category: 'Workflows', items: [] }, { category: 'Components', items: [] },
      { category: 'Shell components', items: [...SHELL_COMPONENTS] },
    ];
    const commit = () => this.surfacePalette.set(groups.map((g) => ({ ...g, items: [...g.items] })));
    this.experiences.list({ approvalState: 'approved' }).subscribe((r) => {
      for (const e of r.items) { const d = e.tags.includes('dashboard'); groups[d ? 1 : 0].items.push({ kind: d ? 'dashboard' : 'experience', name: e.name, title: e.title }); }
      commit();
    });
    const kinds: [SurfaceKind, number][] = [['form', 2], ['workflow', 3], ['component', 4]];
    for (const [k, gi] of kinds) this.caps.listByKind(k).subscribe((r) => { for (const c of r.items) groups[gi].items.push({ kind: k, name: c.name, title: (c.body?.['title'] as string) ?? c.name }); commit(); });

    this.caps.get(this.id()).subscribe((c) => {
      const b = c.body as { title?: string; type?: PageType; layout?: PageLayout; regions?: Record<string, Surface[]>; access?: { personas?: string[]; scopes?: string[] } };
      this.name.set(c.name);
      const type = b.type === 'shell' ? 'shell' : 'content';
      this.type.set(type);
      const l = (b.layout && TEMPLATE_REGIONS[b.layout]) ? b.layout : 'single';
      this.layout.set(l);
      const keys = type === 'shell' ? SHELL_REGIONS : TEMPLATE_REGIONS[l];
      const regions: Record<string, Surface[]> = {};
      for (const r of keys) regions[r] = (b.regions?.[r] ?? []).map((s) => ({ kind: s.kind ?? 'component', name: s.name, props: { ...(s.props ?? {}) } }));
      this.regions.set(regions);
      this.activeRegion.set(keys[0]);
      this.personas.set((b.access?.personas ?? []).join(', '));
      this.scopes.set((b.access?.scopes ?? []).join(', '));
      this.loading.set(false);
    });
  }

  protected setType(t: PageType): void {
    if (t === this.type()) return;
    const carried = Object.values(this.regions()).flat();
    const keys = t === 'shell' ? SHELL_REGIONS : TEMPLATE_REGIONS[this.layout()];
    const next: Record<string, Surface[]> = {};
    keys.forEach((r, i) => { next[r] = i === 0 ? carried : []; });
    this.type.set(t); this.regions.set(next); this.activeRegion.set(keys[0]); this.selection.set(null); this.saved.set(false);
  }
  protected setLayout(l: PageLayout): void {
    const carried = Object.values(this.regions()).flat();
    const keys = TEMPLATE_REGIONS[l]; const next: Record<string, Surface[]> = {};
    keys.forEach((r, i) => { next[r] = i === 0 ? carried : []; });
    this.layout.set(l); this.regions.set(next); this.activeRegion.set(keys[0]); this.saved.set(false);
  }
  protected add(it: PaletteItem): void {
    const r = this.activeRegion();
    this.regions.update((cur) => ({ ...cur, [r]: [...(cur[r] ?? []), { kind: it.kind, name: it.name, props: {} }] }));
    this.selection.set({ region: r, index: this.regions()[r].length - 1 });
    this.saved.set(false);
  }
  protected remove(r: string, i: number, e: Event): void { e.stopPropagation(); this.regions.update((cur) => ({ ...cur, [r]: cur[r].filter((_, idx) => idx !== i) })); this.selection.set(null); this.saved.set(false); }
  protected select(r: string, i: number, e: Event): void { e.stopPropagation(); this.activeRegion.set(r); this.selection.set({ region: r, index: i }); }

  private updateSelected(fn: (p: Record<string, unknown>) => Record<string, unknown>): void {
    const s = this.selection(); if (!s) return;
    this.regions.update((cur) => ({ ...cur, [s.region]: cur[s.region].map((x, idx) => (idx === s.index ? { ...x, props: fn({ ...x.props }) } : x)) }));
    this.saved.set(false);
  }
  protected setProp(key: string, v: unknown): void { this.updateSelected((p) => { p[key] = v; return p; }); }
  protected addLink(): void { this.updateSelected((p) => { p['links'] = [...this.asLinks(p['links']), { label: '', href: '' }]; return p; }); }
  protected removeLink(i: number): void { this.updateSelected((p) => { p['links'] = this.asLinks(p['links']).filter((_, idx) => idx !== i); return p; }); }
  protected editLink(i: number, key: 'label' | 'href', v: string): void { this.updateSelected((p) => { p['links'] = this.asLinks(p['links']).map((l, idx) => (idx === i ? { ...l, [key]: v } : l)); return p; }); }

  protected save(): void {
    this.saving.set(true);
    const list = (s: string) => s.split(/[\s,]+/).filter(Boolean);
    const regions: Record<string, Surface[]> = {};
    for (const r of this.regionNames()) if (this.regions()[r]?.length) regions[r] = this.regions()[r];
    const body: Record<string, unknown> = this.type() === 'shell'
      ? { title: this.name(), type: 'shell', regions }
      : { title: this.name(), type: 'content', layout: this.layout(), regions, access: { personas: list(this.personas()), scopes: list(this.scopes()) } };
    this.caps.update(this.id(), { body }).subscribe({
      next: () => { this.saving.set(false); this.saved.set(true); },
      error: () => { this.saving.set(false); },
    });
  }
}
