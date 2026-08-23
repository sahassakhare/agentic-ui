import { ChangeDetectionStrategy, Component, computed, effect, HostListener, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CdkDrag, CdkDropList, moveItemInArray, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { CapabilityCatalogService } from '../services/capability-catalog.service';
import { ExperienceCatalogService } from '../services/experience-catalog.service';
import { SchemaFormComponent } from '../schema-form.component';
import { LifecycleBarComponent, type BarAction } from '../lifecycle-bar.component';
import { HistoryPanelComponent } from '../history-panel.component';
import { applyCapability, canApproveWith, handleBarAction, reportWriteError, type GovState } from '../governance-actions';
import { AuthService } from '../services/auth.service';
import { ToastService } from '../services/toast.service';
import { kindMeta } from '../services/kind-meta';
import type { ApprovalState } from '../services/capability-catalog.service';
import type { Lifecycle } from '../lifecycle';
import type { HasUnsavedChanges } from '../guards/unsaved-changes.guard';

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
  imports: [FormsModule, RouterLink, LifecycleBarComponent, HistoryPanelComponent, CdkDropList, CdkDrag, MatTooltipModule, MatButtonModule, MatButtonToggleModule, MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule, SchemaFormComponent],
  template: `
    <div class="wrap">
      <header class="head">
        <a routerLink="/pages" class="back">← Pages</a>
        <h1>{{ name() || 'Page' }} · Designer</h1>
        <mat-button-toggle-group class="typetoggle" [value]="type()" (change)="setType($event.value)" hideSingleSelectionIndicator aria-label="Page type">
          <mat-button-toggle value="content">Content page</mat-button-toggle>
          <mat-button-toggle value="shell">Master (shell)</mat-button-toggle>
        </mat-button-toggle-group>
        <span class="sp"></span>
        <aes-lifecycle-bar [lifecycle]="lifecycle()" [approvalState]="approvalState()" [canApprove]="canApprove()"
          [busy]="saving()" (action)="onBarAction($event)" (history)="showHistory.set(true)" />
        @if (saved()) { <span class="ok">✓ saved</span> }
        <button matButton="filled" (click)="save()" [disabled]="saving()">Save page</button>
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
                <mat-form-field appearance="outline" class="af" style="width:100%">
                  <mat-label>Access — personas</mat-label>
                  <input matInput [(ngModel)]="personas" placeholder="admin, ops-manager" />
                </mat-form-field>
                <mat-form-field appearance="outline" class="af" style="width:100%">
                  <mat-label>Access — scopes</mat-label>
                  <input matInput [(ngModel)]="scopes" placeholder="ops:read" />
                </mat-form-field>
              </section>
            }

            <section class="card">
              <div class="eyebrow">Add to <b>{{ activeRegion() }}</b> <span class="muted sm">— click a region then a block, or drag a block onto one</span></div>
              <div class="palscroll" cdkDropList id="palette" [cdkDropListData]="paletteSource"
                   [cdkDropListConnectedTo]="regionListIds()" [cdkDropListSortingDisabled]="true">
                @for (g of palette(); track g.category) {
                  <div class="cat">{{ g.category }}</div>
                  @for (it of g.items; track it.kind + ':' + it.name) {
                    <button class="palette" cdkDrag [cdkDragData]="it" (click)="add(it)">
                      <span class="ic" [class.dash]="it.kind === 'dashboard'"><mat-icon>{{ km(it.kind).icon }}</mat-icon></span>
                      <span class="pt"><span class="nm">{{ it.title }}</span><span class="gl">{{ it.kind }} · {{ it.name }}</span></span>
                      <span class="plus">＋</span>
                    </button>
                  }
                }
              </div>
            </section>

            @if (selected(); as sel) {
              <section class="card">
                <div class="eyebrow">Properties · {{ sel.name }} <span class="muted sm">{{ sel.kind }}</span></div>

                @if (regionNames().length > 1) {
                  <mat-form-field appearance="outline" class="af" style="width:100%">
                    <mat-label>Region</mat-label>
                    <mat-select [ngModel]="selection()?.region" (ngModelChange)="moveToRegion($event)">
                      @for (r of regionNames(); track r) { <mat-option [value]="r">{{ r }}</mat-option> }
                    </mat-select>
                  </mat-form-field>
                }

                @if (propFields(sel.name).length) {
                  <!-- Typed editor for the built-in shell components. -->
                  @for (f of propFields(sel.name); track f.key) {
                    @switch (f.type) {
                      @case ('links') {
                        <label class="lbl">{{ f.label }}</label>
                        @for (l of asLinks(propVal(sel, f.key)); track $index) {
                          <div class="linkrow">
                            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af flex"><mat-label>Label</mat-label><input matInput [ngModel]="l.label" (ngModelChange)="editLink($index, 'label', $event)" /></mat-form-field>
                            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af flex"><mat-label>URL</mat-label><input matInput [ngModel]="l.href" (ngModelChange)="editLink($index, 'href', $event)" placeholder="https://…" /></mat-form-field>
                            <button class="x" (click)="removeLink($index)" aria-label="Remove link"><mat-icon>close</mat-icon></button>
                          </div>
                        }
                        <button matButton (click)="addLink()">＋ Add link</button>
                      }
                      @default { <mat-form-field appearance="outline" class="af" style="width:100%"><mat-label>{{ f.label }}</mat-label><input matInput [ngModel]="propVal(sel, f.key)" (ngModelChange)="setProp(f.key, $event)" /></mat-form-field> }
                    }
                  }
                } @else {
                  <!-- Universal props editor: any surface, any prop. Values are parsed
                       as JSON when possible (numbers, booleans, objects, arrays) else kept
                       as strings — so authors can configure a surface without limits. -->
                  <label class="lbl">Properties <span class="muted sm">— passed to this {{ sel.kind }}</span></label>
                  @for (row of propEntries(sel); track row.key) {
                    <div class="proprow">
                      <span class="pkey" [title]="row.key">{{ row.key }}</span>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af flex"><mat-label>value</mat-label><input matInput [ngModel]="displayVal(row.value)" (ngModelChange)="setPropRaw(row.key, $event)" /></mat-form-field>
                      <button class="x" (click)="removeProp(row.key)" aria-label="Remove property"><mat-icon>close</mat-icon></button>
                    </div>
                  }
                  <div class="proprow add">
                    <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af flex"><mat-label>prop name</mat-label><input matInput [ngModel]="newPropKey()" (ngModelChange)="newPropKey.set($event)" /></mat-form-field>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af flex"><mat-label>value / JSON</mat-label><input matInput [ngModel]="newPropValue()" (ngModelChange)="newPropValue.set($event)" /></mat-form-field>
                    <button matButton class="addp" (click)="addProp()" [disabled]="!newPropKey().trim()" aria-label="Add property">＋</button>
                  </div>
                  @if (sel.kind === 'form') { <p class="muted sm">Add <code>initialValues</code> or <code>context</code> (a JSON object) to prefill the form.</p> }
                }
              </section>
            }
          </aside>

          <main class="col">
            <section class="card">
              <div class="eyebrow rowbar">
                <span>
                  @if (type() === 'shell') { Shell regions <span class="muted sm">— content (pages) renders in the centre</span> }
                  @else { Regions · <span class="muted">{{ layout() }}</span> }
                </span>
                <span class="hbtns">
                  <button type="button" class="hb" (click)="undo()" [disabled]="!canUndo()" matTooltip="Undo (⌘Z)" aria-label="Undo"><mat-icon>undo</mat-icon></button>
                  <button type="button" class="hb" (click)="redo()" [disabled]="!canRedo()" matTooltip="Redo (⌘⇧Z)" aria-label="Redo"><mat-icon>redo</mat-icon></button>
                </span>
              </div>
              <div class="regions" [attr.data-shell]="type() === 'shell'">
                @for (r of regionNames(); track r) {
                  <div class="region" cdkDropList [id]="'region-' + r" [cdkDropListData]="regions()[r] || []"
                       [cdkDropListConnectedTo]="regionListIds()" (cdkDropListDropped)="onDrop($event, r)"
                       [class.on]="activeRegion() === r" (click)="activeRegion.set(r)">
                    <div class="rhead">{{ r }} <span class="muted sm">{{ (regions()[r] || []).length }}</span></div>
                    @for (s of regions()[r]; track $index) {
                      <div class="block" cdkDrag [cdkDragData]="s" [class.sel]="isSelected(r, $index)" (click)="select(r, $index, $event)">
                        <span class="ic" [class.dash]="s.kind === 'dashboard'"><mat-icon>{{ km(s.kind).icon }}</mat-icon></span>
                        <span class="bm"><span class="nm">{{ s.name }}</span><span class="gl">{{ s.kind }}</span></span>
                        <span class="ctrls">
                          <button class="mv" (click)="moveSurface(r, $index, -1, $event)" [disabled]="$index === 0" matTooltip="Move up" aria-label="Move up"><mat-icon>keyboard_arrow_up</mat-icon></button>
                          <button class="mv" (click)="moveSurface(r, $index, 1, $event)" [disabled]="$index === (regions()[r] || []).length - 1" matTooltip="Move down" aria-label="Move down"><mat-icon>keyboard_arrow_down</mat-icon></button>
                          <button class="x" (click)="remove(r, $index, $event)" aria-label="Remove"><mat-icon>close</mat-icon></button>
                        </span>
                      </div>
                    } @empty { <div class="drop">click, then add →</div> }
                  </div>
                }
                @if (type() === 'shell') { <div class="region content"><div class="rhead">content</div><div class="ph">Pages (router-outlet)</div></div> }
              </div>
            </section>
          </main>

          <aside class="preview">
            <div class="pv-head">
              <div class="eyebrow">Preview <span class="muted sm">— {{ livePreview() ? 'live surfaces' : 'layout & composition' }}</span></div>
              <mat-button-toggle-group class="pv-seg" [value]="livePreview() ? 'live' : 'struct'"
                (change)="livePreview.set($event.value === 'live')" hideSingleSelectionIndicator aria-label="Preview mode">
                <mat-button-toggle value="struct" matTooltip="Structural wireframe">Structure</mat-button-toggle>
                <mat-button-toggle value="live" matTooltip="Render surfaces live">Live</mat-button-toggle>
              </mat-button-toggle-group>
            </div>
            @if (livePreview()) {
              <div class="pv-live" [attr.data-layout]="type() === 'shell' ? 'shell' : layout()">
                @for (r of regionNames(); track r) {
                  <div class="pvl-r" [style.grid-area]="type() === 'shell' ? null : r">
                    <div class="pv-rlbl">{{ r }}</div>
                    @for (s of tilesFor(r); track $index) {
                      @if (s.kind === 'form' && formBody(s.name)) {
                        <div class="pvl-surface"><div class="pvl-cap"><mat-icon>{{ km(s.kind).icon }}</mat-icon> {{ s.name }}</div>
                          <aes-schema-form [body]="formBody(s.name)!" /></div>
                      } @else {
                        <div class="pvl-card" [style.--h]="km(s.kind).hue">
                          <span class="pvl-glyph"><mat-icon>{{ km(s.kind).icon }}</mat-icon></span>
                          <span class="pvl-meta"><span class="pvl-nm">{{ s.name }}</span><span class="pvl-kind">{{ km(s.kind).label }}</span></span>
                          <span class="pvl-hub">renders in Hub</span>
                        </div>
                      }
                    } @empty { <span class="pv-empty">empty</span> }
                  </div>
                }
                @if (type() === 'shell') { <div class="pvl-r pvl-outlet">Page content <span class="muted sm">router-outlet</span></div> }
              </div>
              <div class="muted sm pv-note">Forms render live from the catalog. Experiences, dashboards, workflows &amp; components render in the Hub runtime.</div>
            } @else {
            <div class="pv-frame" [attr.data-layout]="type() === 'shell' ? 'shell' : layout()">
              @if (type() === 'shell') {
                <div class="pv-r pv-header"><div class="pv-rlbl">header</div>
                  @for (s of tilesFor('header'); track $index) { <span class="pv-tile" [style.--h]="km(s.kind).hue"><mat-icon class="pv-tile-ic">{{ km(s.kind).icon }}</mat-icon> {{ s.name }}</span> }</div>
                <div class="pv-mid">
                  <div class="pv-r pv-side"><div class="pv-rlbl">sidenav</div>
                    @for (s of tilesFor('sidenav'); track $index) { <span class="pv-tile" [style.--h]="km(s.kind).hue"><mat-icon class="pv-tile-ic">{{ km(s.kind).icon }}</mat-icon></span> }</div>
                  <div class="pv-r pv-content">Page content<span class="muted sm">router-outlet</span></div>
                  <div class="pv-r pv-aside"><div class="pv-rlbl">aside</div>
                    @for (s of tilesFor('aside'); track $index) { <span class="pv-tile" [style.--h]="km(s.kind).hue"><mat-icon class="pv-tile-ic">{{ km(s.kind).icon }}</mat-icon></span> }</div>
                </div>
                <div class="pv-r pv-footer"><div class="pv-rlbl">footer</div>
                  @for (s of tilesFor('footer'); track $index) { <span class="pv-tile" [style.--h]="km(s.kind).hue"><mat-icon class="pv-tile-ic">{{ km(s.kind).icon }}</mat-icon> {{ s.name }}</span> }</div>
              } @else {
                @for (r of regionNames(); track r) {
                  <div class="pv-r" [style.grid-area]="r">
                    <div class="pv-rlbl">{{ r }}</div>
                    @for (s of tilesFor(r); track $index) { <span class="pv-tile" [style.--h]="km(s.kind).hue" [title]="km(s.kind).label + ' · ' + s.name"><mat-icon class="pv-tile-ic">{{ km(s.kind).icon }}</mat-icon> {{ s.name }}</span> }
                    @empty { <span class="pv-empty">empty</span> }
                  </div>
                }
              }
            </div>
            <div class="muted sm pv-note">Structural preview — switch to <strong>Live</strong> to render surfaces.</div>
            }
          </aside>
        </div>
      }
      @if (showHistory()) { <aes-history-panel [capabilityId]="id()" (close)="showHistory.set(false)" (changed)="reload()" /> }
    </div>
  `,
  styles: [`
    .wrap { padding:20px 24px; max-width:1150px; margin:0 auto; }
    .head { display:flex; align-items:center; gap:14px; margin-bottom:18px; }
    .head h1 { font-size:18px; margin:0; } .back { font-size:13px; text-decoration:none; opacity:.7; } .sp { flex:1; }
    .typetoggle { --mat-standard-button-toggle-height:34px; }
    .ok { color:#0a7d32; font-size:13px; }
    .btn { font:inherit; padding:9px 16px; border-radius:9px; border:1px solid rgba(120,120,140,.3); background:transparent; color:inherit; cursor:pointer; }
    .btn.primary { background:#6750a4; color:#fff; border-color:#6750a4; font-weight:600; } .btn[disabled] { opacity:.5; }
    .btn.ghost.sm { font-size:12px; padding:6px 10px; margin-top:8px; }
    .grid { display:grid; grid-template-columns:300px minmax(0,1fr) minmax(280px,360px); gap:16px; align-items:start; }
    .col { position:sticky; top:16px; }
    .palscroll { max-height:46vh; overflow-y:auto; margin-top:6px; }
    @media (max-width:1180px){ .grid { grid-template-columns:280px minmax(0,1fr); } .preview { grid-column:1 / -1; } }
    @media (max-width:820px){ .grid { grid-template-columns:1fr; } .col,.preview { position:static; } .palscroll { max-height:none; } }
    .preview { position:sticky; top:16px; align-self:start; }
    .pv-frame { display:grid; gap:8px; margin-top:8px; padding:10px; min-height:200px; border:1px solid var(--border); border-radius:12px; background:var(--surface-2); }
    .pv-frame[data-layout='single']{ grid-template-areas:'main'; }
    .pv-frame[data-layout='two-column']{ grid-template-areas:'left right'; grid-template-columns:1fr 1fr; }
    .pv-frame[data-layout='sidebar-right']{ grid-template-areas:'main aside'; grid-template-columns:2fr 1fr; }
    .pv-frame[data-layout='sidebar-left']{ grid-template-areas:'aside main'; grid-template-columns:1fr 2fr; }
    .pv-frame[data-layout='stacked']{ grid-template-areas:'top' 'main'; }
    .pv-frame[data-layout='grid']{ grid-template-areas:'a a' 'b c'; grid-template-columns:1fr 1fr; }
    .pv-frame[data-layout='shell']{ display:flex; flex-direction:column; }
    .pv-r { display:flex; flex-direction:column; gap:5px; min-height:52px; padding:8px; border:1px dashed var(--border); border-radius:8px; background:var(--surface); }
    .pv-rlbl { font-size:10px; text-transform:uppercase; letter-spacing:.06em; opacity:.5; }
    .pv-tile { display:inline-flex; align-items:center; gap:5px; font-size:11.5px; padding:3px 8px; border-radius:6px; background:hsl(var(--h) 55% 50% / .16); color:var(--text); }
    .pv-empty { font-size:11px; opacity:.4; font-style:italic; }
    .pv-mid { display:grid; grid-template-columns:56px 1fr 56px; gap:8px; }
    .pv-content { display:grid; place-content:center; text-align:center; gap:2px; min-height:80px; font-size:11px; opacity:.65; }
    .pv-note { margin-top:8px; text-align:center; }
    /* preview header + mode toggle */
    .pv-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .pv-head .eyebrow { margin-bottom:0; }
    .pv-seg { --mat-standard-button-toggle-height:28px; font-size:11px; }
    /* live preview render */
    .pv-live { display:grid; gap:10px; margin-top:8px; padding:10px; min-height:200px; border:1px solid var(--border); border-radius:12px; background:var(--surface-2); }
    .pv-live[data-layout='two-column']{ grid-template-areas:'left right'; grid-template-columns:1fr 1fr; }
    .pv-live[data-layout='sidebar-right']{ grid-template-areas:'main aside'; grid-template-columns:2fr 1fr; }
    .pv-live[data-layout='sidebar-left']{ grid-template-areas:'aside main'; grid-template-columns:1fr 2fr; }
    .pv-live[data-layout='stacked']{ grid-template-areas:'top' 'main'; }
    .pv-live[data-layout='grid']{ grid-template-areas:'a a' 'b c'; grid-template-columns:1fr 1fr; }
    .pvl-r { display:flex; flex-direction:column; gap:8px; min-width:0; }
    .pvl-surface { border:1px solid var(--border); border-radius:10px; background:var(--surface); padding:12px; min-width:0; }
    .pvl-cap { font-size:11px; color:var(--text-muted); margin-bottom:8px; display:flex; align-items:center; gap:5px; }
    .pvl-card { display:flex; align-items:center; gap:10px; padding:12px; border:1px solid var(--border); border-radius:10px;
      background:linear-gradient(0deg, hsl(var(--h) 55% 50% / .06), hsl(var(--h) 55% 50% / .06)), var(--surface); }
    .pvl-glyph { display:grid; place-items:center; width:30px; height:30px; border-radius:8px; font-size:15px; flex:none;
      background:hsl(var(--h) 55% 50% / .16); color:hsl(var(--h) 55% 45%); }
    .pvl-meta { display:flex; flex-direction:column; min-width:0; flex:1; }
    .pvl-nm { font-size:13px; font-weight:600; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pvl-kind { font-size:11px; color:var(--text-muted); text-transform:capitalize; }
    .pvl-hub { font-size:10px; color:var(--text-faint); border:1px solid var(--border); border-radius:999px; padding:2px 7px; flex:none; }
    .pvl-outlet { display:grid; place-content:center; text-align:center; gap:2px; min-height:80px; font-size:12px;
      border:1px dashed var(--border); border-radius:8px; background:var(--surface); opacity:.7; }
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
    .block .ctrls { margin-left:auto; display:inline-flex; gap:2px; }
    .block .mv, .block .x, .proprow .x { border:none; background:transparent; color:inherit; opacity:.5; cursor:pointer; }
    .block .mv, .block .x { padding:2px 4px; font-size:11px; line-height:1; }
    .block .mv:hover:not([disabled]), .block .x:hover, .proprow .x:hover { opacity:1; }
    .block .mv[disabled] { opacity:.18; cursor:default; }
    /* CDK drag-drop canvas states (Studio-token styled). */
    .block { cursor:grab; }
    .block.cdk-drag-dragging { cursor:grabbing; }
    .block.cdk-drag-preview { box-shadow:0 8px 24px -8px rgba(0,0,0,.35); border-color:var(--brand); background:var(--surface); border-radius:9px; }
    .block.cdk-drag-placeholder { opacity:.35; border-style:dashed; }
    .palette[cdkdrag] { cursor:grab; } .palette.cdk-drag-dragging { cursor:grabbing; }
    .region.cdk-drop-list-dragging { border-color:var(--brand); background:var(--brand-soft); }
    .region.cdk-drop-list-receiving { border-color:var(--brand); }
    .cdk-drag-animating, .block.cdk-drag-placeholder { transition:transform .18s cubic-bezier(0,0,.2,1); }
    .rowbar { display:flex; align-items:center; justify-content:space-between; gap:10px; }
    .hbtns { display:inline-flex; gap:4px; }
    .hb { border:1px solid var(--border); background:var(--surface); color:var(--text-muted); border-radius:var(--r-sm); width:26px; height:24px; font-size:14px; line-height:1; cursor:pointer; }
    .hb:hover:not([disabled]) { border-color:var(--brand); color:var(--brand); }
    .hb[disabled] { opacity:.35; cursor:default; }
    /* compact mat-icon sizing per context (custom-classed buttons keep their tight layout) */
    .ic mat-icon { font-size:16px; width:16px; height:16px; }
    .pvl-glyph mat-icon { font-size:18px; width:18px; height:18px; }
    .pvl-cap mat-icon { font-size:14px; width:14px; height:14px; }
    .pv-tile-ic { font-size:13px; width:13px; height:13px; }
    .block .mv mat-icon, .block .x mat-icon, .linkrow .x mat-icon, .proprow .x mat-icon { font-size:16px; width:16px; height:16px; }
    .hb mat-icon { font-size:16px; width:16px; height:16px; }
    .block .mv, .block .x { display:inline-grid; place-items:center; }
    .hb { display:inline-grid; place-items:center; }
    .proprow { display:grid; grid-template-columns:auto 1fr auto; gap:6px; margin-top:6px; align-items:center; }
    .proprow.add { grid-template-columns:1fr 1fr auto; }
    .pkey { font-size:12px; opacity:.8; max-width:96px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .btn.ghost.sm.addp { margin-top:0; }
    .drop { font-size:12px; opacity:.45; padding:6px 2px; } .ph { border:1.5px dashed rgba(120,120,140,.25); border-radius:8px; padding:14px; text-align:center; font-size:12px; opacity:.5; }
  `],
})
export class PageDesignerComponent implements HasUnsavedChanges {
  private readonly caps = inject(CapabilityCatalogService);
  private readonly experiences = inject(ExperienceCatalogService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

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
  /** Draft row for the universal props editor (add-property sub-form). */
  protected readonly newPropKey = signal('');
  protected readonly newPropValue = signal('');
  protected readonly surfacePalette = signal<PaletteGroup[]>([]);
  /** Form capability bodies (name → body) so form surfaces render live in the preview. */
  protected readonly formBodies = signal<Record<string, Record<string, unknown>>>({});
  /** Preview mode: structural wireframe (default) vs live surface render. */
  protected readonly livePreview = signal(false);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly lifecycle = signal<Lifecycle>('draft');
  protected readonly approvalState = signal<ApprovalState>('draft');
  protected readonly capVersion = signal(0);
  protected readonly showHistory = signal(false);
  protected readonly canApprove = computed(() => canApproveWith(this.auth.roles()));
  private pristine = '';
  // Undo/redo history over the regions() model (drag canvas + manual edits share it).
  private readonly past = signal<Record<string, Surface[]>[]>([]);
  private readonly future = signal<Record<string, Surface[]>[]>([]);
  protected readonly canUndo = computed(() => this.past().length > 0);
  protected readonly canRedo = computed(() => this.future().length > 0);
  private historyReady = false;
  private lastRegions: Record<string, Surface[]> | null = null;

  protected readonly regionNames = computed(() => this.type() === 'shell' ? SHELL_REGIONS : TEMPLATE_REGIONS[this.layout()]);
  /** Both page types share the SAME palette — every surface + shell components. */
  protected readonly palette = computed<PaletteGroup[]>(() => this.surfacePalette());
  protected readonly selected = computed<Surface | null>(() => {
    const s = this.selection();
    return s ? this.regions()[s.region]?.[s.index] ?? null : null;
  });

  constructor() {
    queueMicrotask(() => this.load());
    // Record a history snapshot whenever regions() changes through an edit. undo/
    // redo and load pre-set lastRegions so their own writes aren't re-recorded.
    effect(() => {
      const cur = this.regions();
      if (!this.historyReady) { this.lastRegions = cur; return; }
      if (this.lastRegions && this.lastRegions !== cur) {
        this.past.update((h) => [...h.slice(-49), this.lastRegions!]);
        this.future.set([]);
      }
      this.lastRegions = cur;
    });
  }

  /** Undo the last regions edit (⌘Z). */
  protected undo(): void {
    const h = this.past();
    if (!h.length) return;
    const prev = h[h.length - 1]!;
    this.future.update((f) => [this.regions(), ...f]);
    this.past.set(h.slice(0, -1));
    this.lastRegions = prev; // pre-set so the history effect ignores this write
    this.regions.set(prev);
    this.selection.set(null);
    this.saved.set(false);
  }

  /** Redo the last undone regions edit (⌘⇧Z). */
  protected redo(): void {
    const f = this.future();
    if (!f.length) return;
    const next = f[0]!;
    this.past.update((p) => [...p, this.regions()]);
    this.future.set(f.slice(1));
    this.lastRegions = next;
    this.regions.set(next);
    this.selection.set(null);
    this.saved.set(false);
  }

  @HostListener('document:keydown', ['$event'])
  protected onKey(e: KeyboardEvent): void {
    if (this.loading()) return;
    const el = e.target as HTMLElement | null;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); this.redo(); }
  }
  protected readonly km = kindMeta;
  protected tilesFor(r: string): Surface[] { return this.regions()[r] ?? []; }
  /** The catalog body for a form surface (by name), or null if not yet loaded / not a form. */
  protected formBody(name: string): Record<string, unknown> | null { return this.formBodies()[name] ?? null; }
  protected propFields(name: string): PropField[] { return PROP_FIELDS[name] ?? []; }
  protected asLinks(v: unknown): { label: string; href: string }[] { return (Array.isArray(v) ? v : []) as { label: string; href: string }[]; }
  protected propVal(s: Surface, key: string): unknown { return s.props[key]; }
  protected isSelected(r: string, i: number): boolean { const s = this.selection(); return !!s && s.region === r && s.index === i; }

  private load(): void {
    this.historyReady = false; // don't record the load itself as an undoable edit
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
    for (const [k, gi] of kinds) this.caps.listByKind(k).subscribe((r) => {
      for (const c of r.items) groups[gi].items.push({ kind: k, name: c.name, title: (c.body?.['title'] as string) ?? c.name });
      // Keep form bodies so the live preview can render each form surface for real.
      if (k === 'form') this.formBodies.update((m) => { const next = { ...m }; for (const c of r.items) next[c.name] = c.body ?? {}; return next; });
      commit();
    });

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
      applyCapability(this.gov(), c);
      this.loading.set(false);
      this.pristine = this.snapshot();
      // Start history clean from the loaded state.
      this.past.set([]); this.future.set([]);
      this.lastRegions = this.regions();
      this.historyReady = true;
    });
  }

  // ── governance + unsaved-changes guard ──────────────────────────────────────
  private snapshot(): string {
    return JSON.stringify({ type: this.type(), layout: this.layout(), regions: this.regions(), personas: this.personas(), scopes: this.scopes() });
  }
  hasUnsavedChanges(): boolean { return !this.loading() && this.snapshot() !== this.pristine; }
  private gov(): GovState { return { lifecycle: this.lifecycle, approvalState: this.approvalState, version: this.capVersion }; }
  protected onBarAction(a: BarAction): void { handleBarAction(a, this.id(), this.gov(), this.caps, this.toast); }
  protected reload(): void { this.load(); }

  protected setType(t: PageType): void {
    if (t === this.type()) return;
    const carried = Object.values(this.regions()).flat();
    const keys = t === 'shell' ? SHELL_REGIONS : TEMPLATE_REGIONS[this.layout()];
    const next: Record<string, Surface[]> = {};
    keys.forEach((r, i) => { next[r] = i === 0 ? carried : []; });
    this.type.set(t); this.regions.set(next); this.activeRegion.set(keys[0]); this.selection.set(null); this.saved.set(false);
    this.lastRegions = next; this.past.set([]); this.future.set([]); // structural change resets history
  }
  protected setLayout(l: PageLayout): void {
    const carried = Object.values(this.regions()).flat();
    const keys = TEMPLATE_REGIONS[l]; const next: Record<string, Surface[]> = {};
    keys.forEach((r, i) => { next[r] = i === 0 ? carried : []; });
    this.layout.set(l); this.regions.set(next); this.activeRegion.set(keys[0]); this.saved.set(false);
    this.lastRegions = next; this.past.set([]); this.future.set([]); // structural change resets history
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

  // ── universal props editor (any surface) ──────────────────────────────────
  protected propEntries(s: Surface): { key: string; value: unknown }[] {
    return Object.entries(s.props).map(([key, value]) => ({ key, value }));
  }
  /** Render a value for editing: strings as-is, everything else as JSON. */
  protected displayVal(v: unknown): string {
    if (v === null || v === undefined) return '';
    return typeof v === 'string' ? v : JSON.stringify(v);
  }
  /** Parse an edited value: JSON when it parses (number/bool/object/array), else string. */
  private coerce(raw: string): unknown {
    const t = raw.trim();
    if (t === '') return '';
    try { return JSON.parse(t); } catch { return raw; }
  }
  protected setPropRaw(key: string, raw: string): void { this.updateSelected((p) => { p[key] = this.coerce(raw); return p; }); }
  protected removeProp(key: string): void { this.updateSelected((p) => { delete p[key]; return p; }); }
  protected addProp(): void {
    const k = this.newPropKey().trim();
    if (!k) return;
    const raw = this.newPropValue();
    this.updateSelected((p) => { p[k] = this.coerce(raw); return p; });
    this.newPropKey.set(''); this.newPropValue.set('');
  }

  // ── reorder + move across regions ─────────────────────────────────────────
  protected moveSurface(r: string, i: number, dir: -1 | 1, e: Event): void {
    e.stopPropagation();
    const arr = this.regions()[r];
    const j = i + dir;
    if (!arr || j < 0 || j >= arr.length) return;
    const next = [...arr];
    const [x] = next.splice(i, 1);
    next.splice(j, 0, x!);
    this.regions.update((cur) => ({ ...cur, [r]: next }));
    // Keep the selection following the moved (or displaced) block.
    if (this.isSelected(r, i)) this.selection.set({ region: r, index: j });
    else if (this.isSelected(r, j)) this.selection.set({ region: r, index: i });
    this.saved.set(false);
  }
  protected moveToRegion(toR: string): void {
    const s = this.selection();
    if (!s || s.region === toR) return;
    const from = this.regions()[s.region] ?? [];
    const item = from[s.index];
    if (!item) return;
    const nextFrom = from.filter((_, idx) => idx !== s.index);
    const nextTo = [...(this.regions()[toR] ?? []), item];
    this.regions.update((cur) => ({ ...cur, [s.region]: nextFrom, [toR]: nextTo }));
    this.selection.set({ region: toR, index: nextTo.length - 1 });
    this.activeRegion.set(toR);
    this.saved.set(false);
  }

  // ── drag-drop canvas (CDK) — additive over the same regions() model ──────────
  /** DropList ids the palette and every region connect to. */
  protected readonly regionListIds = computed(() => this.regionNames().map((r) => 'region-' + r));
  /** Inert source array for the palette list — palette items are copied, never moved out. */
  protected readonly paletteSource: readonly PaletteItem[] = [];

  /** Drop a block: reorder within a region, move across regions, or copy from the palette. */
  protected onDrop(event: CdkDragDrop<Surface[]>, toRegion: string): void {
    const cur = this.regions();
    if (event.previousContainer === event.container) {
      const arr = [...(cur[toRegion] ?? [])];
      moveItemInArray(arr, event.previousIndex, event.currentIndex);
      this.regions.set({ ...cur, [toRegion]: arr });
      this.selection.set({ region: toRegion, index: event.currentIndex });
    } else if (event.previousContainer.id === 'palette') {
      const it = event.item.data as PaletteItem;
      const arr = [...(cur[toRegion] ?? [])];
      arr.splice(event.currentIndex, 0, { kind: it.kind, name: it.name, props: {} });
      this.regions.set({ ...cur, [toRegion]: arr });
      this.activeRegion.set(toRegion);
      this.selection.set({ region: toRegion, index: event.currentIndex });
    } else {
      const fromRegion = event.previousContainer.id.replace('region-', '');
      const fromArr = [...(cur[fromRegion] ?? [])];
      const toArr = fromRegion === toRegion ? fromArr : [...(cur[toRegion] ?? [])];
      const [moved] = fromArr.splice(event.previousIndex, 1);
      if (!moved) return;
      toArr.splice(event.currentIndex, 0, moved);
      this.regions.set({ ...cur, [fromRegion]: fromArr, [toRegion]: toArr });
      this.activeRegion.set(toRegion);
      this.selection.set({ region: toRegion, index: event.currentIndex });
    }
    this.saved.set(false);
  }

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
    this.caps.update(this.id(), { body }, this.capVersion()).subscribe({
      next: (c) => { this.saving.set(false); this.saved.set(true); this.pristine = this.snapshot(); applyCapability(this.gov(), c); },
      error: (e) => { this.saving.set(false); reportWriteError(this.toast, e); },
    });
  }
}
