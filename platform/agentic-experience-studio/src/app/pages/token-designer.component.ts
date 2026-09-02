import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { wireDesignerLiveSync } from './designer-live-sync';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { tokensToCssVars, DEFAULT_TOKENS, type TokenSet, type ThemeMode } from '@infra-tools/agentic-ui';
import { CapabilityCatalogService, type Capability } from '../services/capability-catalog.service';
import { ToastService } from '../services/toast.service';
import { AuthService } from '../services/auth.service';
import { deriveBrand } from '../theme-colors';
import { LifecycleBarComponent, type BarAction } from '../lifecycle-bar.component';
import { HistoryPanelComponent } from '../history-panel.component';
import { applyCapability, canApproveWith, handleBarAction, reportWriteError, type GovState } from '../governance-actions';
import type { Lifecycle } from '../lifecycle';
import type { HasUnsavedChanges } from '../guards/unsaved-changes.guard';

interface ColorGroup { group: string; keys: { key: string; label: string }[] }
const COLOR_FIELDS: ColorGroup[] = [
  { group: 'Brand', keys: [{ key: 'brand', label: 'Brand' }, { key: 'brand-hover', label: 'Hover' }, { key: 'brand-soft', label: 'Soft' }, { key: 'on-brand', label: 'On-brand' }] },
  { group: 'Surface', keys: [{ key: 'bg', label: 'Background' }, { key: 'surface', label: 'Surface' }, { key: 'surface-2', label: 'Surface 2' }, { key: 'border', label: 'Border' }] },
  { group: 'Text', keys: [{ key: 'text', label: 'Text' }, { key: 'text-muted', label: 'Muted' }, { key: 'text-faint', label: 'Faint' }] },
  { group: 'Status', keys: [{ key: 'ok', label: 'Success' }, { key: 'warn', label: 'Warning' }, { key: 'danger', label: 'Danger' }, { key: 'info', label: 'Info' }] },
];

/**
 * Token Designer — authors a `kind:'theme'` capability (a design-token set). Edit
 * colors per light/dark mode, generate a brand ramp from one color, and preview a
 * live sample rendered from the tokens. Saves the TokenSet as the capability body;
 * the Hub applies it as CSS custom properties per application (hot over SSE).
 */
@Component({
  selector: 'aes-token-designer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, LifecycleBarComponent, HistoryPanelComponent, MatButtonModule],
  template: `
    <div class="wrap">
      <header class="head">
        <a routerLink="/themes" class="back">← Themes</a>
        <h1>{{ name() || 'Theme' }} · Tokens</h1>
        <div class="modes">
          <button [class.on]="mode() === 'light'" (click)="mode.set('light')">Light</button>
          <button [class.on]="mode() === 'dark'" (click)="mode.set('dark')">Dark</button>
        </div>
        <span class="sp"></span>
        <aes-lifecycle-bar [lifecycle]="lifecycle()" [approvalState]="approvalState()" [canApprove]="canApprove()"
          [busy]="saving()" (action)="onBarAction($event)" (history)="showHistory.set(true)" />
        @if (saved()) { <span class="ok">✓ saved</span> }
        <button matButton="filled" (click)="save()" [disabled]="saving()">Save theme</button>
      </header>

      @if (loading()) { <p class="muted">Loading…</p> }
      @else {
        <div class="grid">
          <section class="card editors">
            <div class="eyebrow">Colors · <b>{{ mode() }}</b> mode</div>
            <button matButton class="gen" (click)="generateFromBrand()">✦ Generate ramp from brand</button>
            @for (g of colorFields; track g.group) {
              <div class="cgroup">{{ g.group }}</div>
              <div class="cgrid">
                @for (k of g.keys; track k.key) {
                  <label class="citem">
                    <input type="color" [value]="colorVal(k.key)" (input)="setColor(k.key, $any($event.target).value)" />
                    <span class="cl">{{ k.label }}</span>
                    <input class="chex" [ngModel]="colorVal(k.key)" (ngModelChange)="setColor(k.key, $event)" />
                  </label>
                }
              </div>
            }
            <p class="muted sm">Spacing, radius, type + shadow tokens use the platform defaults; override them in the raw <code>body</code> if needed.</p>
          </section>

          <section class="card preview" [style]="previewStyle()">
            <div class="eyebrow">Live preview</div>
            <div class="pv">
              <div class="pv-card">
                <h3>Aa Sample surface</h3>
                <p class="pv-muted">Rendered from your tokens. Muted text and a border.</p>
                <div class="pv-row">
                  <button class="pv-btn">Primary</button>
                  <button class="pv-btn ghost">Secondary</button>
                  <span class="pv-badge">Badge</span>
                </div>
                <input class="pv-input" placeholder="Input field" />
                <div class="pv-row">
                  <span class="pv-chip ok">Success</span>
                  <span class="pv-chip warn">Warning</span>
                  <span class="pv-chip danger">Danger</span>
                  <span class="pv-chip info">Info</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      }
      @if (showHistory()) { <aes-history-panel [capabilityId]="id()" (close)="showHistory.set(false)" (changed)="reload()" /> }
    </div>
  `,
  styles: [`
    .wrap { padding:20px 24px; max-width:1150px; margin:0 auto; }
    .head { display:flex; align-items:center; gap:14px; margin-bottom:18px; flex-wrap:wrap; }
    .head h1 { font-size:18px; margin:0; } .back { font-size:13px; text-decoration:none; opacity:.7; } .sp { flex:1; }
    .modes { display:inline-flex; border:1px solid rgba(120,120,140,.3); border-radius:9px; overflow:hidden; }
    .modes button { font:inherit; font-size:12.5px; padding:5px 12px; border:none; background:transparent; color:inherit; cursor:pointer; }
    .modes button.on { background:#6750a4; color:#fff; }
    .ok { color:#0a7d32; font-size:13px; }
    .btn { font:inherit; padding:8px 14px; border-radius:9px; border:1px solid rgba(120,120,140,.3); background:transparent; color:inherit; cursor:pointer; }
    .btn.primary { background:#6750a4; color:#fff; border-color:#6750a4; font-weight:600; } .btn[disabled] { opacity:.5; }
    .btn.ghost.sm { font-size:12px; padding:6px 10px; } .gen { margin-bottom:12px; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:18px; align-items:start; } @media (max-width:900px){ .grid { grid-template-columns:1fr; } }
    .card { border:1px solid rgba(120,120,140,.18); border-radius:14px; padding:16px; }
    .eyebrow { font-size:11px; text-transform:uppercase; letter-spacing:.06em; opacity:.55; margin-bottom:10px; }
    .muted { opacity:.6; } .sm { font-size:12px; }
    .cgroup { font-size:11px; text-transform:uppercase; letter-spacing:.05em; opacity:.5; margin:12px 0 6px; }
    .cgrid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .citem { display:flex; align-items:center; gap:8px; }
    .citem input[type=color] { width:28px; height:28px; border:1px solid rgba(120,120,140,.3); border-radius:7px; background:transparent; padding:0; cursor:pointer; }
    .cl { font-size:12px; flex:1; } .chex { width:82px; font:inherit; font-size:11px; font-family:ui-monospace,Menlo,monospace; padding:5px 6px; border:1px solid rgba(120,120,140,.3); border-radius:7px; background:transparent; color:inherit; }
    /* preview is themed by inline [style] tokens on the section */
    .preview { background:var(--surface); color:var(--text); }
    .pv-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--r-lg,14px); padding:18px; box-shadow:var(--shadow-2); }
    .pv-card h3 { margin:0 0 4px; color:var(--text); font-size:16px; }
    .pv-muted { color:var(--text-muted); font-size:13px; margin:0 0 14px; }
    .pv-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:12px 0; }
    .pv-btn { font:inherit; font-size:13px; padding:8px 14px; border-radius:var(--r-md,9px); border:1px solid var(--brand); background:var(--brand); color:var(--on-brand); cursor:pointer; }
    .pv-btn.ghost { background:var(--surface-2); color:var(--text); border-color:var(--border); }
    .pv-badge { font-size:11px; font-weight:700; text-transform:uppercase; padding:3px 9px; border-radius:999px; background:var(--brand-soft); color:var(--brand-hover); }
    .pv-input { width:100%; padding:9px 11px; border:1px solid var(--border); border-radius:var(--r-md,9px); background:var(--surface); color:var(--text); font:inherit; }
    .pv-chip { font-size:11px; padding:3px 9px; border-radius:999px; }
    .pv-chip.ok { background:var(--ok-soft); color:var(--ok); } .pv-chip.warn { background:var(--warn-soft); color:var(--warn); }
    .pv-chip.danger { background:var(--danger-soft); color:var(--danger); } .pv-chip.info { background:var(--info-soft); color:var(--info); }
  `],
})
export class TokenDesignerComponent implements HasUnsavedChanges {
  private readonly caps = inject(CapabilityCatalogService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  readonly id = input.required<string>();
  protected readonly colorFields = COLOR_FIELDS;

  protected readonly name = signal('');
  protected readonly tokens = signal<TokenSet>(DEFAULT_TOKENS);
  protected readonly mode = signal<ThemeMode>('light');
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly lifecycle = signal<Lifecycle>('draft');
  protected readonly approvalState = signal<'draft' | 'review' | 'approved' | 'rejected' | 'deprecated'>('draft');
  protected readonly capVersion = signal(0);
  protected readonly showHistory = signal(false);
  protected readonly canApprove = computed(() => canApproveWith(this.auth.roles()));
  private pristine = '';

  /** The token set compiled to CSS vars for the preview mode, as an inline style. */
  protected readonly previewStyle = computed(() =>
    Object.entries(tokensToCssVars(this.tokens(), this.mode())).map(([k, v]) => `${k}:${v}`).join(';'));

  constructor() { wireDesignerLiveSync({ id: () => this.id(), reload: () => this.reload(), isDirty: () => this.hasUnsavedChanges() }); }

  private load(): void {
    this.caps.get(this.id()).subscribe({
      next: (c) => {
        this.name.set(c.name);
        const body = c.body as Partial<TokenSet>;
        this.tokens.set(body && body.base ? { title: body.title, base: body.base, dark: body.dark } : structuredClone(DEFAULT_TOKENS));
        applyCapability(this.gov(), c);
        this.loading.set(false);
        this.pristine = this.snapshot();
      },
      error: () => { this.loading.set(false); this.toast.error('Load failed', 'Could not load the theme.'); },
    });
  }

  protected colorVal(key: string): string {
    const t = this.tokens();
    const v = (this.mode() === 'dark' ? t.dark?.color?.[key] : undefined) ?? t.base.color?.[key];
    return v ?? '#000000';
  }
  protected setColor(key: string, value: string): void {
    this.tokens.update((t) => {
      if (this.mode() === 'dark') {
        return { ...t, dark: { ...t.dark, color: { ...(t.dark?.color ?? {}), [key]: value } } };
      }
      return { ...t, base: { ...t.base, color: { ...(t.base.color ?? {}), [key]: value } } };
    });
    this.saved.set(false);
  }
  protected generateFromBrand(): void {
    const ramp = deriveBrand(this.colorVal('brand'), this.mode() === 'dark');
    for (const [k, v] of Object.entries(ramp)) this.setColor(k, v);
    this.toast.success('Generated', 'Brand ramp derived from the brand color.');
  }

  // ── governance + unsaved-changes ────────────────────────────────────────────
  private snapshot(): string { return JSON.stringify(this.tokens()); }
  hasUnsavedChanges(): boolean { return !this.loading() && this.snapshot() !== this.pristine; }
  private gov(): GovState { return { lifecycle: this.lifecycle, approvalState: this.approvalState, version: this.capVersion }; }
  protected onBarAction(a: BarAction): void { handleBarAction(a, this.id(), this.gov(), this.caps, this.toast); }
  protected reload(): void { this.load(); }

  save(): void {
    this.saving.set(true);
    this.caps.update(this.id(), { body: this.tokens() as unknown as Record<string, unknown> }, this.capVersion()).subscribe({
      next: (c: Capability) => { this.saving.set(false); this.saved.set(true); this.pristine = this.snapshot(); applyCapability(this.gov(), c); },
      error: (e) => { this.saving.set(false); reportWriteError(this.toast, e); },
    });
  }
}
