import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PolicyCatalogService, type PolicyBundle } from '../services/policy-catalog.service';
import { ToastService } from '../services/toast.service';

/**
 * Policy Studio (AEP Seam E) — authors OPA rego bundles via the catalog
 * `/policy/bundles` API. At most one bundle is active per tenant (enforced
 * server-side); activating one is how an experience's `policies` get enforced.
 * OPA evaluation runs in the sidecar; no OPA ships in this client.
 */
@Component({
  selector: 'aes-policy',
  imports: [FormsModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div class="titles">
          <span class="eyebrow">Governance · OPA</span>
          <h1>Policy Studio</h1>
          <p class="subtitle">Author OPA rego bundles. One bundle is active per tenant — the sidecar
            evaluates it; the runtime forwards each experience’s <code>policies</code> for a decision.</p>
        </div>
        <button class="btn btn-primary" type="button" (click)="toggleCreate()" [attr.aria-expanded]="createOpen()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          New bundle
        </button>
      </div>

      @if (createOpen()) {
        <form class="card card-pad create" (ngSubmit)="create()">
          <div class="grid-2">
            <div class="field"><label class="label" for="p-name">Name <span class="req" aria-hidden="true">*</span></label>
              <input class="input" id="p-name" name="name" [(ngModel)]="name" placeholder="matter-access" autocomplete="off" spellcheck="false" /></div>
            <div class="field"><label class="label" for="p-path">Rule path</label>
              <input class="input mono" id="p-path" name="path" [(ngModel)]="rulePath" placeholder="maverick/allow" autocomplete="off" spellcheck="false" /></div>
            <div class="field" style="grid-column:1 / -1"><label class="label" for="p-rego">Rego source <span class="req" aria-hidden="true">*</span></label>
              <textarea class="textarea mono" id="p-rego" name="rego" rows="9" [(ngModel)]="rego" spellcheck="false"
                placeholder="package maverick&#10;&#10;default allow = false&#10;allow { input.subject.roles[_] == &quot;lead-counsel&quot; }"></textarea></div>
          </div>
          <label class="checkbox" style="margin-top:var(--s4)"><input type="checkbox" name="act" [(ngModel)]="activateNow" /> Activate on create (replaces the current active bundle)</label>
          <div class="row" style="margin-top:var(--s5)">
            <button class="btn btn-primary" type="submit" [disabled]="!canCreate() || saving()">
              @if (saving()) { <span class="spinner" aria-hidden="true"></span> Saving… } @else { Create bundle }
            </button>
            <button class="btn btn-ghost" type="button" (click)="cancelCreate()">Cancel</button>
          </div>
        </form>
      }

      @if (loading()) {
        <ul class="rows" aria-hidden="true">@for (i of [1,2]; track i) { <li class="skeleton skeleton-row"></li> }</ul>
      } @else if (error()) {
        <div class="empty" role="alert"><div class="empty-icon" style="background:var(--danger-soft);color:var(--danger)">!</div>
          <h3>Couldn’t load bundles</h3><p class="muted">{{ error() }}</p><button class="btn" (click)="refresh()">Retry</button></div>
      } @else if (items().length === 0) {
        <div class="empty">
          <div class="empty-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3 4 6v5c0 5 3.4 8 8 10 4.6-2 8-5 8-10V6l-8-3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></div>
          <h3>No policy bundles yet</h3><p>Author a rego bundle and activate it to enforce experience policies.</p>
          <button class="btn btn-primary" (click)="openCreate()">New bundle</button>
        </div>
      } @else {
        <ul class="rows" style="margin-top:var(--s5)">
          @for (b of items(); track b.id) {
            <li class="rowcard" [class.is-active]="b.isActive">
              <div class="stack" style="gap:2px; flex:1">
                <div class="row" style="gap:var(--s3)">
                  <span class="name">{{ b.name }}</span>
                  @if (b.isActive) { <span class="badge badge-ok">active</span> }
                </div>
                <span class="mono-id">{{ b.rulePath }}</span>
              </div>
              @if (!b.isActive) { <button class="btn btn-sm" type="button" (click)="activate(b)">Activate</button> }
              <button class="btn btn-danger btn-sm" type="button" (click)="remove(b)">Delete</button>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    .create { margin-bottom: var(--s5); }
    .rowcard.is-active { border-color: var(--ok-border); box-shadow: 0 0 0 1px var(--ok-border); }
  `],
})
export class PolicyComponent {
  private readonly policy = inject(PolicyCatalogService);
  private readonly toast = inject(ToastService);

  readonly items = signal<readonly PolicyBundle[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly createOpen = signal(false);

  name = '';
  rulePath = 'maverick/allow';
  rego = '';
  activateNow = false;

  constructor() { this.refresh(); }

  canCreate(): boolean { return this.name.trim() !== '' && this.rego.trim() !== ''; }
  toggleCreate(): void { this.createOpen.update((v) => !v); if (!this.createOpen()) this.reset(); }
  openCreate(): void { this.createOpen.set(true); }
  cancelCreate(): void { this.createOpen.set(false); this.reset(); }
  private reset(): void { this.name = ''; this.rego = ''; this.rulePath = 'maverick/allow'; this.activateNow = false; }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.policy.list().subscribe({
      next: (res) => { this.items.set(res.items); this.loading.set(false); },
      error: (err) => { this.error.set(msg(err)); this.loading.set(false); },
    });
  }

  create(): void {
    if (!this.canCreate()) return;
    this.saving.set(true);
    this.policy.create({ name: this.name.trim(), regoSource: this.rego, rulePath: this.rulePath.trim() || undefined, isActive: this.activateNow })
      .subscribe({
        next: () => { this.saving.set(false); this.createOpen.set(false); this.reset(); this.refresh(); this.toast.success('Bundle created'); },
        error: (err) => { this.saving.set(false); this.toast.error('Create failed', msg(err)); },
      });
  }

  activate(b: PolicyBundle): void {
    this.policy.setActive(b.id, true).subscribe({
      next: () => { this.refresh(); this.toast.success('Activated', `“${b.name}” is now the active bundle.`); },
      error: (err) => this.toast.error('Activate failed', msg(err)),
    });
  }

  remove(b: PolicyBundle): void {
    this.policy.remove(b.id).subscribe({
      next: () => { this.items.update((cur) => cur.filter((x) => x.id !== b.id)); this.toast.info(`Deleted “${b.name}”`); },
      error: (err) => this.toast.error('Delete failed', msg(err)),
    });
  }
}

function msg(err: unknown): string {
  const e = err as { status?: number; error?: { message?: string; detail?: string } };
  if (e?.status === 0) return 'Cannot reach the catalog server.';
  if (e?.status === 401) return 'Session expired — please sign in again.';
  if (e?.status === 409) return e.error?.message ?? 'A bundle with that name already exists.';
  return e?.error?.detail ?? e?.error?.message ?? 'Request failed.';
}
