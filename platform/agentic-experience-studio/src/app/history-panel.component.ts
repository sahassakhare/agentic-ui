import { ChangeDetectionStrategy, Component, HostListener, inject, input, output, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { CapabilityCatalogService, type CapabilityVersion } from './services/capability-catalog.service';
import { ToastService } from './services/toast.service';

/**
 * Version-history modal for a capability: lists the immutable snapshots, restores
 * a prior one (rollback), and compares a selected snapshot against the latest
 * (pretty-printed side by side + a changed-keys summary — the draft-vs-published
 * diff). Emits `changed` after a rollback so the host designer can reload.
 */
@Component({
  selector: 'aes-history-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    <div class="backdrop" (click)="close.emit()"></div>
    <div class="panel" role="dialog" aria-label="Version history">
      <header><h3>Version history</h3><button class="x" (click)="close.emit()" aria-label="Close">✕</button></header>
      @if (loading()) { <p class="muted">Loading…</p> }
      @else if (!versions().length) { <p class="muted">No versions yet.</p> }
      @else {
        <div class="cols">
          <ul class="vlist">
            @for (v of versions(); track v.versionNo) {
              <li [class.sel]="selected()?.versionNo === v.versionNo" (click)="selected.set(v)"
                  tabindex="0" role="button" [attr.aria-pressed]="selected()?.versionNo === v.versionNo"
                  [attr.aria-label]="'Version ' + v.versionNo" (keydown.enter)="selected.set(v)" (keydown.space)="selected.set(v); $event.preventDefault()">
                <div class="vrow">
                  <span class="vno">v{{ v.versionNo }}</span>
                  <span class="vr">{{ v.reason }}</span>
                  @if (v.versionNo !== latestNo()) {
                    <button class="btn-sm" (click)="doRollback(v, $event)" [disabled]="busy()">Restore</button>
                  } @else { <span class="cur">current</span> }
                </div>
                <div class="vmeta">{{ v.createdBy }} · {{ v.createdAt | date:'short' }}</div>
              </li>
            }
          </ul>
          <div class="cmp">
            @if (selected(); as sel) {
              @if (changedKeys().length) {
                <div class="chg">Changed vs latest: @for (k of changedKeys(); track k) { <span class="k">{{ k }}</span> }</div>
              } @else { <div class="chg none">Identical to latest.</div> }
              <div class="side">
                <div class="col"><div class="ch">v{{ sel.versionNo }}</div><pre>{{ pretty(sel.snapshot) }}</pre></div>
                <div class="col"><div class="ch">v{{ latestNo() }} · latest</div><pre>{{ pretty(latest()?.snapshot) }}</pre></div>
              </div>
            } @else { <p class="muted pick">Select a version to compare with the latest.</p> }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .backdrop { position:fixed; inset:0; background:rgba(0,0,0,.4); z-index:40; }
    .panel { position:fixed; z-index:41; top:5vh; left:50%; transform:translateX(-50%); width:min(920px,94vw); max-height:88vh; overflow:auto;
      background:var(--surface,#fff); color:inherit; border:1px solid rgba(120,120,140,.25); border-radius:14px; padding:18px; box-shadow:0 20px 60px rgba(0,0,0,.3); }
    header { display:flex; align-items:center; gap:12px; margin-bottom:12px; } header h3 { margin:0; font-size:16px; flex:1; }
    .x { border:none; background:transparent; color:inherit; opacity:.6; cursor:pointer; font-size:15px; }
    .muted { opacity:.6; } .muted.pick { padding:24px; text-align:center; }
    .cols { display:grid; grid-template-columns:260px 1fr; gap:16px; }
    @media (max-width:760px){ .cols { grid-template-columns:1fr; } }
    .vlist { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; max-height:70vh; overflow:auto; }
    .vlist li { border:1px solid rgba(120,120,140,.2); border-radius:9px; padding:8px 10px; cursor:pointer; }
    .vlist li.sel { border-color:#6750a4; background:rgba(103,80,164,.07); }
    .vrow { display:flex; align-items:center; gap:8px; } .vno { font-weight:700; font-size:12px; } .vr { flex:1; font-size:12px; opacity:.8; font-family:ui-monospace,Menlo,monospace; }
    .vmeta { font-size:11px; opacity:.55; margin-top:2px; }
    .cur { font-size:10px; text-transform:uppercase; letter-spacing:.04em; opacity:.5; }
    .btn-sm { font:inherit; font-size:11px; padding:3px 9px; border:1px solid rgba(120,120,140,.3); border-radius:7px; background:transparent; color:inherit; cursor:pointer; }
    .btn-sm:hover:not([disabled]) { border-color:#6750a4; color:#6750a4; }
    .chg { font-size:12px; margin-bottom:8px; } .chg.none { opacity:.6; } .chg .k { font-family:ui-monospace,Menlo,monospace; font-size:11px; background:rgba(203,143,0,.15); color:#a86a00; padding:1px 6px; border-radius:5px; margin-left:5px; }
    .side { display:grid; grid-template-columns:1fr 1fr; gap:10px; } @media (max-width:760px){ .side { grid-template-columns:1fr; } }
    .col .ch { font-size:11px; text-transform:uppercase; letter-spacing:.04em; opacity:.6; margin-bottom:4px; }
    .col pre { margin:0; background:rgba(120,120,140,.06); border:1px solid rgba(120,120,140,.18); border-radius:9px; padding:10px; font-size:11.5px; font-family:ui-monospace,Menlo,monospace; overflow:auto; max-height:56vh; white-space:pre-wrap; word-break:break-word; }
  `],
})
export class HistoryPanelComponent {
  private readonly catalog = inject(CapabilityCatalogService);
  private readonly toast = inject(ToastService);

  readonly capabilityId = input.required<string>();
  readonly close = output<void>();
  readonly changed = output<void>();

  /** Keyboard dismiss — matches the backdrop click and the ✕ button. */
  @HostListener('document:keydown.escape')
  protected onEscape(): void { this.close.emit(); }

  protected readonly versions = signal<readonly CapabilityVersion[]>([]);
  protected readonly selected = signal<CapabilityVersion | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);

  protected readonly latest = computed(() => this.versions()[0] ?? null);
  protected readonly latestNo = computed(() => this.latest()?.versionNo ?? 0);
  protected readonly changedKeys = computed(() => {
    const a = this.selected()?.snapshot, b = this.latest()?.snapshot;
    if (!a || !b) return [];
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  });

  constructor() { queueMicrotask(() => this.load()); }

  private load(): void {
    this.catalog.versions(this.capabilityId()).subscribe({
      next: (r) => { this.versions.set(r.items); this.loading.set(false); },
      error: () => { this.loading.set(false); this.toast.error('History failed', 'Could not load version history.'); },
    });
  }

  protected pretty(o: unknown): string { return o == null ? '' : JSON.stringify(o, null, 2); }

  protected doRollback(v: CapabilityVersion, e: Event): void {
    e.stopPropagation();
    this.busy.set(true);
    this.catalog.rollback(this.capabilityId(), v.versionNo).subscribe({
      next: () => { this.busy.set(false); this.toast.success('Restored', `Rolled back to v${v.versionNo} (re-enters review).`); this.changed.emit(); this.close.emit(); },
      error: () => { this.busy.set(false); this.toast.error('Rollback failed', 'Could not restore that version.'); },
    });
  }
}
