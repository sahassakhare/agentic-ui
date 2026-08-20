import { Component, computed, inject, input, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CapabilityCatalogService, type Capability } from '../services/capability-catalog.service';
import { CapabilityGraphService, type Usage } from '../services/capability-graph.service';
import { kindMeta } from '../services/kind-meta';
import { ToastService } from '../services/toast.service';
import { AuthService } from '../services/auth.service';
import { PreviewHostComponent } from '../preview-host.component';
import { SchemaFormComponent } from '../schema-form.component';
import { LifecycleBarComponent, type BarAction } from '../lifecycle-bar.component';
import { HistoryPanelComponent } from '../history-panel.component';
import { canApproveWith, reportWriteError } from '../governance-actions';

/** A field in a capability authoring form. */
export interface StudioField {
  readonly key: string;
  readonly label: string;
  /** `list` splits whitespace/commas into a string[] stored in body; `json`
   *  parses to an object (compose an entry declaratively). */
  readonly type: 'text' | 'textarea' | 'number' | 'checkbox' | 'list' | 'json';
  readonly required?: boolean;
  readonly placeholder?: string;
}

/** Route-data config that parameterizes the generic capability studio. */
export interface StudioConfig {
  readonly kind: string;        // 'prompt' | 'navigation' | …
  readonly title: string;       // "Prompt Studio"
  readonly noun: string;        // "prompt"
  readonly bodyFields: readonly StudioField[]; // fields stored in body
  /** Optional sibling sections shown as sub-tabs (e.g. Pages ↔ Master Pages). */
  readonly siblings?: readonly { readonly label: string; readonly path: string }[];
}

/**
 * Generic authoring studio for a capability kind (AEP Seam B/E). Lists existing
 * capabilities of `config.kind`, filters them, and creates / deletes them via
 * the catalog `/capabilities` API. Parameterized by route `data.config` so one
 * component powers the Prompt / Skill / Knowledge / Memory / Navigation studios.
 *
 * Product-quality surface: skeleton loading, empty state with CTA, live search,
 * per-field validation, a confirm-before-delete dialog, and undoable delete
 * feedback via toasts. All visuals reuse the design-system classes.
 */
@Component({
  selector: 'aes-capability-studio',
  imports: [FormsModule, RouterLink, RouterLinkActive, PreviewHostComponent, SchemaFormComponent, LifecycleBarComponent, HistoryPanelComponent],
  template: `
    <div class="page">
      <div class="page-header">
        <div class="titles">
          <span class="eyebrow">Capability · {{ cfg().kind }}</span>
          <h1>{{ cfg().title }}</h1>
          <p class="subtitle">Author and govern reusable <strong>{{ cfg().noun }}</strong> capabilities.
            An Experience resolves against whatever is published here.</p>
        </div>
        <div class="row" style="gap:var(--s2); align-items:center">
          @if (cfg().kind === 'component') { <a class="btn" routerLink="/components/upload">⬆ Upload library</a> }
          <button class="btn btn-primary" type="button" (click)="toggleCreate()" [attr.aria-expanded]="createOpen()">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            New {{ cfg().noun }}
          </button>
        </div>
      </div>

      @if (cfg().siblings; as sibs) {
        <div class="subtabs">
          @for (s of sibs; track s.path) {
            <a [routerLink]="s.path" routerLinkActive="on">{{ s.label }}</a>
          }
        </div>
      }

      @if (formOpen()) {
        <form class="card card-pad create" (ngSubmit)="save()">
          @if (editTarget()) { <div class="eyebrow" style="margin-bottom:var(--s3)">Editing · {{ editTarget()!.name }}</div> }
          <div class="grid-2">
            <div class="field" [class.wide]="false">
              <label class="label" [attr.for]="fid('name')">Name (id) @if (!editTarget()) { <span class="req" aria-hidden="true">*</span> }</label>
              <input class="input" [id]="fid('name')" name="name" [(ngModel)]="values['name']" [disabled]="!!editTarget()"
                     [attr.aria-invalid]="touched() && !editTarget() && !nameValid()" [placeholder]="cfg().noun + 'Name'"
                     autocomplete="off" spellcheck="false" />
              @if (editTarget()) { <span class="help">Name and kind are immutable.</span> }
              @else if (touched() && !nameValid()) { <span class="err">A unique name is required.</span> }
            </div>
            @for (f of cfg().bodyFields; track f.key) {
              <div class="field" [style.grid-column]="isWide(f) ? '1 / -1' : null">
                <label class="label" [attr.for]="fid(f.key)">
                  {{ f.label }} @if (f.required) { <span class="req" aria-hidden="true">*</span> }
                </label>
                @switch (f.type) {
                  @case ('textarea') {
                    <textarea class="textarea" rows="4" [id]="fid(f.key)" [name]="f.key" [(ngModel)]="values[f.key]"
                      [attr.aria-invalid]="touched() && f.required && !filled(f.key)" [placeholder]="f.placeholder ?? ''"></textarea>
                  }
                  @case ('list') {
                    <textarea class="textarea" rows="2" [id]="fid(f.key)" [name]="f.key" [(ngModel)]="values[f.key]"
                      [attr.aria-invalid]="touched() && f.required && !filled(f.key)" [placeholder]="f.placeholder ?? ''"></textarea>
                    <span class="help">Separate with spaces or commas.</span>
                  }
                  @case ('json') {
                    <textarea class="textarea mono" rows="10" [id]="fid(f.key)" [name]="f.key" [(ngModel)]="values[f.key]"
                      [attr.aria-invalid]="!jsonOk(f.key)" [placeholder]="f.placeholder ?? '{ }'" spellcheck="false" autocomplete="off"></textarea>
                    @if (!jsonOk(f.key)) { <span class="err">Invalid JSON.</span> }
                    @else { <span class="help">Declarative JSON — the same shape the renderer, agents, and cross-registry composition consume.</span> }
                  }
                  @case ('checkbox') {
                    <label class="checkbox"><input type="checkbox" [id]="fid(f.key)" [name]="f.key" [(ngModel)]="values[f.key]" /> Enabled</label>
                  }
                  @case ('number') {
                    <input class="input" type="number" [id]="fid(f.key)" [name]="f.key" [(ngModel)]="values[f.key]" [placeholder]="f.placeholder ?? ''" />
                  }
                  @default {
                    <input class="input" [id]="fid(f.key)" [name]="f.key" [(ngModel)]="values[f.key]"
                      [attr.aria-invalid]="touched() && f.required && !filled(f.key)" [placeholder]="f.placeholder ?? ''" autocomplete="off" />
                  }
                }
                @if (touched() && f.required && !filled(f.key)) { <span class="err">{{ f.label }} is required.</span> }
              </div>
            }
          </div>

          @if (editTarget(); as et) {
            <div class="lifebar">
              <div class="stack" style="gap:3px">
                <span class="eyebrow">Governance</span>
                <span class="muted" style="font-size:var(--fs-sm)">Review chain: draft → submit → review → approve → publish. The Hub resolves <strong>published</strong> entries.</span>
              </div>
              <div class="row spacer" style="gap:var(--s2); flex-wrap:wrap; justify-content:flex-end; align-items:center">
                <aes-lifecycle-bar [lifecycle]="et.lifecycle" [approvalState]="et.approvalState" [canApprove]="canApprove()"
                  [busy]="transitioning()" (action)="onBarAction(et, $event)" (history)="historyFor.set(et.id)" />
              </div>
            </div>
          }

          <div class="row" style="margin-top:var(--s5)">
            <button class="btn btn-primary" type="submit" [disabled]="saving()">
              @if (saving()) { <span class="spinner" aria-hidden="true"></span> Saving… }
              @else if (editTarget()) { Save changes } @else { Create {{ cfg().noun }} }
            </button>
            <button class="btn btn-ghost" type="button" (click)="cancelForm()">Cancel</button>
          </div>
        </form>
      }

      <div class="toolbar">
        <div class="search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="m20 20-3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          <input class="input" type="search" [(ngModel)]="query" [attr.aria-label]="'Search ' + cfg().noun + 's'" [placeholder]="'Search ' + cfg().noun + 's…'" />
        </div>
        <span class="count faint">{{ filtered().length }} of {{ items().length }}</span>
      </div>

      @if (loading()) {
        <ul class="rows" aria-hidden="true">
          @for (i of [1,2,3]; track i) { <li class="skeleton skeleton-row"></li> }
        </ul>
      } @else if (error()) {
        <div class="empty" role="alert">
          <div class="empty-icon" style="background:var(--danger-soft);color:var(--danger)">!</div>
          <h3>Couldn’t load {{ cfg().noun }}s</h3>
          <p class="muted">{{ error() }}</p>
          <button class="btn" type="button" (click)="refresh()">Retry</button>
        </div>
      } @else if (items().length === 0) {
        <div class="empty">
          <div class="empty-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </div>
          <h3>No {{ cfg().noun }}s yet</h3>
          <p>Create your first {{ cfg().noun }} — it becomes available to every Experience in this tenant.</p>
          <button class="btn btn-primary" type="button" (click)="openCreate()">New {{ cfg().noun }}</button>
        </div>
      } @else if (filtered().length === 0) {
        <div class="empty">
          <h3>No matches</h3>
          <p>Nothing matches “{{ query() }}”.</p>
          <button class="btn btn-ghost" type="button" (click)="query.set('')">Clear search</button>
        </div>
      } @else {
        <ul class="rows">
          @for (c of filtered(); track c.id) {
            <li class="rowcard">
              <div class="stack" style="gap:2px; flex:1; min-width:0">
                <div class="row" style="gap:var(--s2)">
                  <span class="name">{{ c.name }}</span>
                  <span class="badge" [class.badge-ok]="c.lifecycle === 'published'" [class.badge-warn]="c.lifecycle === 'draft'" [class.badge-danger]="c.lifecycle === 'deprecated' || c.lifecycle === 'disabled'">{{ c.lifecycle }}</span>
                </div>
                @if (summarize(c)) { <span class="desc" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ summarize(c) }}</span> }
                @let u = usageOf(c);
                @if (u.uses.length || u.usedBy.length || u.unmet.length) {
                  <button type="button" class="usebtn" (click)="toggleUsage(c)" [attr.aria-expanded]="expandedUsage() === c.kind + ':' + c.name">
                    @if (u.uses.length) { <span title="Composed of">↳ uses {{ u.uses.length }}</span> }
                    @if (u.usedBy.length) { <span title="Referenced by">↰ used by {{ u.usedBy.length }}</span> }
                    @if (u.unmet.length) { <span class="unmet" title="References that aren't defined">⚠ {{ u.unmet.length }} unmet</span> }
                  </button>
                  @if (expandedUsage() === c.kind + ':' + c.name) {
                    <div class="usedetail">
                      @if (u.uses.length) {
                        <div class="ugrp"><span class="ulbl">Uses</span>
                          @for (r of u.uses; track r.kind + r.name) { <span class="kchip" [style.--h]="km(r.kind).hue">{{ km(r.kind).glyph }} {{ r.name }} <em>{{ km(r.kind).label }}</em></span> }</div>
                      }
                      @if (u.unmet.length) {
                        <div class="ugrp"><span class="ulbl unmet">Unmet</span>
                          @for (r of u.unmet; track r.kind + r.name) { <span class="kchip unmet" [style.--h]="km(r.kind).hue">{{ km(r.kind).glyph }} {{ r.name }} <em>{{ km(r.kind).label }}?</em></span> }</div>
                      }
                      @if (u.usedBy.length) {
                        <div class="ugrp"><span class="ulbl">Used by</span>
                          @for (r of u.usedBy; track r.kind + r.name) { <span class="kchip" [style.--h]="km(r.kind).hue">{{ km(r.kind).glyph }} {{ r.name }} <em>{{ km(r.kind).label }}</em></span> }</div>
                      }
                    </div>
                  }
                }
              </div>
              @for (t of c.tags; track t) { <span class="badge plain badge-brand">{{ t }}</span> }
              <div class="row" style="gap:var(--s2)">
                <button class="btn btn-ghost btn-sm" type="button" (click)="preview(c)">Preview</button>
                @if (cfg().kind === 'form') { <a class="btn btn-sm" [routerLink]="['/forms', c.id, 'design']">Design</a> }
                @if (cfg().kind === 'application') { <a class="btn btn-sm" [routerLink]="['/applications', c.id, 'design']">Design</a> }
                @if (cfg().kind === 'page') { <a class="btn btn-sm" [routerLink]="['/pages', c.id, 'design']">Design</a> }
                @if (cfg().kind === 'decision') { <a class="btn btn-sm" [routerLink]="['/decisions', c.id, 'design']">Design</a> }
                @if (cfg().kind === 'theme') { <a class="btn btn-sm" [routerLink]="['/themes', c.id, 'design']">Design</a> }
                <button class="btn btn-sm" type="button" (click)="startEdit(c)">Edit</button>
                <button class="btn btn-danger btn-sm" type="button" (click)="askDelete(c)">Delete</button>
              </div>
            </li>
          }
        </ul>
      }
    </div>

    @if (previewTarget(); as pv) {
      <div class="scrim" (click)="previewTarget.set(null)">
        <div class="dialog preview" role="dialog" aria-modal="true" aria-labelledby="pv-title" (click)="$event.stopPropagation()">
          <div class="row" style="justify-content:space-between; align-items:flex-start; gap:var(--s3)">
            <div class="stack" style="gap:2px; min-width:0">
              <span class="eyebrow">{{ cfg().kind }} · preview</span>
              <h3 id="pv-title" style="word-break:break-all">{{ pv.name }}</h3>
            </div>
            <span class="badge" [class.badge-ok]="pv.lifecycle === 'published'" [class.badge-warn]="pv.lifecycle === 'draft'" [class.badge-danger]="pv.lifecycle === 'deprecated' || pv.lifecycle === 'disabled'">{{ pv.lifecycle }}</span>
          </div>
          @if (pv.tags.length) { <div class="row" style="gap:6px; flex-wrap:wrap; margin-top:var(--s2)">@for (t of pv.tags; track t) { <span class="badge plain badge-brand">{{ t }}</span> }</div> }
          <div style="margin-top:var(--s4)">
            @if (hasSchema(pv)) { <aes-schema-form [body]="pv.body" /> }
            @else { <aes-preview-host [capability]="pv" /> }
          </div>
          <dl class="pvfields">
            @for (f of cfg().bodyFields; track f.key) {
              @if (previewValue(pv, f.key); as val) {
                <dt>{{ f.label }}</dt>
                <dd [class.mono]="f.type === 'textarea' || f.type === 'list'">{{ val }}</dd>
              }
            }
          </dl>
          <details class="pvraw">
            <summary>Raw JSON</summary>
            <pre>{{ pretty(pv.body) }}</pre>
          </details>
          <div class="actions">
            <button class="btn btn-ghost" type="button" (click)="previewTarget.set(null)">Close</button>
            <button class="btn btn-primary" type="button" (click)="editFromPreview(pv)">Edit</button>
          </div>
        </div>
      </div>
    }

    @if (pendingDelete(); as target) {
      <div class="scrim" (click)="pendingDelete.set(null)">
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="del-title" (click)="$event.stopPropagation()">
          <h3 id="del-title">Delete “{{ target.name }}”?</h3>
          <p>This {{ cfg().noun }} will be removed from the catalog. Experiences that require it will show it as unmet. You can undo right after.</p>
          <div class="actions">
            <button class="btn btn-ghost" type="button" (click)="pendingDelete.set(null)">Cancel</button>
            <button class="btn btn-danger" type="button" (click)="confirmDelete(target)" [disabled]="deleting()">
              @if (deleting()) { <span class="spinner" aria-hidden="true"></span> Deleting… } @else { Delete }
            </button>
          </div>
        </div>
      </div>
    }
    @if (historyFor(); as hid) { <aes-history-panel [capabilityId]="hid" (close)="historyFor.set(null)" (changed)="onHistoryChanged(hid)" /> }
  `,
  styles: [`
    .usebtn { margin-top: 4px; border: none; background: none; padding: 0; cursor: pointer; display: inline-flex; gap: 12px; font-size: 11.5px; color: var(--text-muted); }
    .usebtn span { display: inline-flex; align-items: center; gap: 3px; }
    .usebtn:hover { color: var(--text); }
    .usebtn .unmet { color: var(--danger); font-weight: 600; }
    .usedetail { margin-top: 7px; display: flex; flex-direction: column; gap: 6px; padding: 9px 11px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 9px; }
    .ugrp { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .ulbl { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; opacity: .55; min-width: 52px; }
    .ulbl.unmet { color: var(--danger); opacity: 1; }
    .kchip { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; padding: 2px 9px; border-radius: 999px;
      background: hsl(var(--h) 55% 50% / .15); color: var(--text); }
    .kchip em { opacity: .6; font-style: normal; font-size: 10.5px; }
    .kchip.unmet { background: hsl(2 60% 50% / .1); color: var(--danger); border: 1px dashed hsl(2 55% 50% / .5); }
    .subtabs { display: flex; gap: var(--s1); margin: var(--s3) 0 0; border-bottom: 1px solid var(--border); }
    .subtabs a { font-size: var(--fs-sm); font-weight: 550; color: var(--text-muted); text-decoration: none;
      padding: .5rem .8rem; border-bottom: 2px solid transparent; }
    .subtabs a:hover { color: var(--text); }
    .subtabs a.on { color: var(--brand); border-bottom-color: var(--brand); }
    .create { margin-bottom: var(--s5); }
    .toolbar { display: flex; align-items: center; gap: var(--s4); margin: var(--s5) 0 var(--s4); }
    .toolbar .search { flex: 1; max-width: 380px; }
    .toolbar .count { font-size: var(--fs-sm); white-space: nowrap; }
    .textarea.mono { font-family: var(--font-mono); font-size: var(--fs-sm); line-height: 1.5; }
    .lifebar { display: flex; align-items: center; gap: var(--s4); flex-wrap: wrap; margin-top: var(--s5);
      padding: var(--s4); border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface-2); }
    .dialog.preview { max-width: 560px; width: 100%; }
    .pvfields { display: grid; grid-template-columns: max-content 1fr; gap: var(--s2) var(--s4); margin: var(--s4) 0 0; }
    .pvfields dt { font-size: var(--fs-sm); color: var(--text-muted); }
    .pvfields dd { margin: 0; font-size: var(--fs-sm); word-break: break-word; }
    .pvfields dd.mono { font-family: var(--font-mono); white-space: pre-wrap; }
    .pvraw { margin-top: var(--s4); }
    .pvraw summary { cursor: pointer; font-size: var(--fs-sm); color: var(--text-muted); }
    .pvraw pre { margin-top: var(--s2); background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r-sm);
      padding: var(--s3); font-size: var(--fs-xs); overflow-x: auto; max-height: 260px; }
    @media (max-width: 520px) {
      .pvfields { grid-template-columns: 1fr; gap: 2px var(--s4); }
      .pvfields dd { margin-bottom: var(--s2); }
    }
  `],
})
export class CapabilityStudioComponent {
  private readonly catalog = inject(CapabilityCatalogService);
  private readonly graph = inject(CapabilityGraphService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  protected readonly km = kindMeta;
  protected readonly expandedUsage = signal<string | null>(null);
  readonly canApprove = computed(() => canApproveWith(this.auth.roles()));
  readonly historyFor = signal<string | null>(null);

  /** Bound from route `data.config` via withComponentInputBinding(). */
  readonly config = input.required<StudioConfig>();
  cfg = () => this.config();

  readonly items = signal<readonly Capability[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly transitioning = signal(false);
  readonly error = signal<string | null>(null);
  readonly createOpen = signal(false);
  readonly editTarget = signal<Capability | null>(null);
  readonly previewTarget = signal<Capability | null>(null);
  readonly touched = signal(false);
  readonly query = signal('');
  readonly pendingDelete = signal<Capability | null>(null);
  /** The authoring form is shown for either a create or an edit. */
  readonly formOpen = computed(() => this.createOpen() || this.editTarget() !== null);

  values: Record<string, unknown> = {};

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.items();
    return this.items().filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.tags.some((t) => t.toLowerCase().includes(q)) ||
      JSON.stringify(c.body).toLowerCase().includes(q));
  });

  constructor() {
    // Reload whenever the kind changes (navigating Prompt → Navigation).
    effect(() => {
      this.config();
      this.createOpen.set(false);
      this.editTarget.set(null);
      this.previewTarget.set(null);
      this.resetForm();
      this.refresh();
    });
  }

  fid(key: string): string { return `f-${this.cfg().kind}-${key}`; }
  isWide(f: StudioField): boolean { return f.type === 'textarea' || f.type === 'list' || f.type === 'json'; }
  filled(key: string): boolean { return String(this.values[key] ?? '').trim() !== ''; }
  nameValid(): boolean { return this.filled('name'); }

  /** A JSON field is OK when empty or when it parses. */
  jsonOk(key: string): boolean {
    const raw = this.values[key];
    if (raw == null || String(raw).trim() === '') return true;
    try { JSON.parse(String(raw)); return true; } catch { return false; }
  }
  /** True when a capability carries a form schema to render live. */
  hasSchema(c: Capability): boolean {
    const s = (c.body?.['schema'] ?? c.body) as { fields?: unknown } | undefined;
    return !!s && Array.isArray(s.fields) && (s.fields as unknown[]).length > 0;
  }

  canCreate(): boolean {
    if (!this.nameValid()) return false;
    if (this.cfg().bodyFields.some((f) => f.type === 'json' && !this.jsonOk(f.key))) return false;
    return this.cfg().bodyFields.filter((f) => f.required).every((f) => this.filled(f.key));
  }

  toggleCreate(): void {
    if (this.formOpen()) { this.cancelForm(); return; }
    this.createOpen.set(true);
  }
  openCreate(): void { this.editTarget.set(null); this.resetForm(); this.createOpen.set(true); }
  cancelForm(): void { this.createOpen.set(false); this.editTarget.set(null); this.resetForm(); }
  private resetForm(): void { this.values = {}; this.touched.set(false); }

  /** Open the form in EDIT mode, pre-filled from the capability's body. */
  startEdit(c: Capability): void {
    this.createOpen.set(false);
    this.editTarget.set(c);
    const v: Record<string, unknown> = { name: c.name };
    for (const f of this.cfg().bodyFields) {
      const raw = c.body[f.key];
      if (raw === undefined || raw === null) continue;
      v[f.key] = f.type === 'list' && Array.isArray(raw) ? raw.join(' ')
        : f.type === 'json' ? JSON.stringify(raw, null, 2)
        : raw;
    }
    this.values = v;
    this.touched.set(false);
  }


  /** Governance bar action: an approval-chain transition or a lifecycle move. */
  onBarAction(et: Capability, a: BarAction): void {
    this.transitioning.set(true);
    const done = (updated: Capability) => {
      this.transitioning.set(false);
      this.editTarget.set(updated);
      this.items.update((cur) => cur.map((x) => (x.id === updated.id ? updated : x)));
      this.toast.success('Updated', `“${updated.name}” is now ${updated.approvalState} · ${updated.lifecycle}.`);
    };
    const fail = (err: unknown) => { this.transitioning.set(false); reportWriteError(this.toast, err, 'Transition'); };
    if (a.type === 'approval') this.catalog.transition(et.id, a.value).subscribe({ next: done, error: fail });
    else this.catalog.update(et.id, { lifecycle: a.value }, et.version).subscribe({ next: done, error: fail });
  }

  /** After a rollback in the history panel, refetch the edited capability + list. */
  onHistoryChanged(id: string): void {
    this.catalog.get(id).subscribe({
      next: (c) => { this.editTarget.set(c); this.items.update((cur) => cur.map((x) => (x.id === c.id ? c : x))); },
      error: () => this.refresh(),
    });
  }

  preview(c: Capability): void { this.previewTarget.set(c); }
  editFromPreview(c: Capability): void { this.previewTarget.set(null); this.startEdit(c); }
  previewValue(c: Capability, key: string): string {
    const v = c.body[key];
    if (v == null || v === '') return '';
    // Objects (e.g. a form `schema`) are shown as the live render + in Raw JSON.
    if (Array.isArray(v)) return v.some((x) => x && typeof x === 'object') ? '' : v.join(', ');
    return typeof v === 'object' ? '' : String(v);
  }
  pretty(body: Record<string, unknown>): string { return JSON.stringify(body, null, 2); }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.catalog.listByKind(this.cfg().kind).subscribe({
      next: (res) => { this.items.set(res.items); this.loading.set(false); },
      error: (err) => { this.error.set(msg(err)); this.loading.set(false); },
    });
    this.graph.load();   // (re)build the cross-registry dependency graph
  }

  /** What this capability uses / is used by / references but isn't defined. */
  protected usageOf(c: Capability): Usage {
    this.graph.version();   // re-read when the graph (re)builds
    return this.graph.usage(c);
  }
  protected toggleUsage(c: Capability): void {
    const k = `${c.kind}:${c.name}`;
    this.expandedUsage.set(this.expandedUsage() === k ? null : k);
  }

  /** Create or update depending on whether the form is in edit mode. */
  save(): void {
    this.touched.set(true);
    const target = this.editTarget();
    if (target) { this.saveEdit(target); return; }
    if (!this.canCreate()) return;
    this.saving.set(true);
    const name = String(this.values['name']).trim();
    const body = this.buildBody();
    this.catalog.create({ kind: this.cfg().kind, name, body }).subscribe({
      next: (created) => {
        this.saving.set(false);
        this.createOpen.set(false);
        this.resetForm();
        this.items.update((cur) => [created, ...cur]);
        this.toast.success(`${cap(this.cfg().noun)} created`, `“${created.name}” is now published.`);
      },
      error: (err) => { this.saving.set(false); this.toast.error('Create failed', msg(err)); },
    });
  }

  private saveEdit(target: Capability): void {
    if (!this.canCreate()) return; // required body fields still apply on edit
    this.saving.set(true);
    this.catalog.update(target.id, { body: this.buildEditBody(target) }).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.editTarget.set(null);
        this.resetForm();
        this.items.update((cur) => cur.map((x) => (x.id === updated.id ? updated : x)));
        this.toast.success(`${cap(this.cfg().noun)} updated`, `“${updated.name}” saved.`);
      },
      error: (err) => { this.saving.set(false); this.toast.error('Update failed', msg(err)); },
    });
  }

  askDelete(c: Capability): void { this.pendingDelete.set(c); }

  confirmDelete(c: Capability): void {
    this.deleting.set(true);
    this.catalog.remove(c.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.pendingDelete.set(null);
        this.items.update((cur) => cur.filter((x) => x.id !== c.id));
        this.toast.withAction('info', `Deleted “${c.name}”`, 'Undo', () => this.undoDelete(c));
      },
      error: (err) => { this.deleting.set(false); this.pendingDelete.set(null); this.toast.error('Delete failed', msg(err)); },
    });
  }

  private undoDelete(c: Capability): void {
    this.catalog.create({ kind: c.kind, name: c.name, body: c.body, tags: [...c.tags] }).subscribe({
      next: (restored) => { this.items.update((cur) => [restored, ...cur]); this.toast.success('Restored', `“${restored.name}” is back.`); },
      error: (err) => this.toast.error('Undo failed', msg(err)),
    });
  }

  private buildBody(): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    for (const f of this.cfg().bodyFields) {
      const raw = this.values[f.key];
      if (raw === undefined || raw === '' || raw === null) continue;
      if (f.type === 'number') body[f.key] = Number(raw);
      else if (f.type === 'checkbox') body[f.key] = Boolean(raw);
      else if (f.type === 'list') {
        const arr = String(raw).split(/[\s,]+/).filter(Boolean);
        if (arr.length) body[f.key] = arr;
      } else if (f.type === 'json') {
        try { body[f.key] = JSON.parse(String(raw)); } catch { /* blocked by canCreate */ }
      } else body[f.key] = raw;
    }
    return body;
  }

  /**
   * Body for an EDIT: start from the existing body so keys the form doesn't
   * manage (e.g. `preview`, `library`, federation pointers) survive, then apply
   * the managed fields — an empty managed field clears its key.
   */
  private buildEditBody(target: Capability): Record<string, unknown> {
    const body: Record<string, unknown> = { ...target.body };
    for (const f of this.cfg().bodyFields) {
      const raw = this.values[f.key];
      const empty = raw === undefined || raw === null || String(raw).trim() === '';
      if (empty) { delete body[f.key]; continue; }
      if (f.type === 'number') body[f.key] = Number(raw);
      else if (f.type === 'checkbox') body[f.key] = Boolean(raw);
      else if (f.type === 'list') {
        const arr = String(raw).split(/[\s,]+/).filter(Boolean);
        if (arr.length) body[f.key] = arr; else delete body[f.key];
      } else if (f.type === 'json') {
        try { body[f.key] = JSON.parse(String(raw)); } catch { /* blocked by canCreate */ }
      } else body[f.key] = raw;
    }
    return body;
  }

  summarize(c: Capability): string {
    const first = this.cfg().bodyFields[0]?.key;
    const v = first ? c.body[first] : undefined;
    if (v == null) return '';
    const s = Array.isArray(v) ? v.join(', ') : String(v);
    return s.length > 96 ? s.slice(0, 96) + '…' : s;
  }
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

function msg(err: unknown): string {
  const e = err as { status?: number; error?: { message?: string; detail?: string } };
  if (e?.status === 0) return 'Cannot reach the catalog server.';
  if (e?.status === 401) return 'Session expired — please sign in again.';
  if (e?.status === 409) return e.error?.message ?? 'A capability with that name already exists.';
  return e?.error?.detail ?? e?.error?.message ?? 'Request failed. Please try again.';
}
