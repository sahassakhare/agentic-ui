import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
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
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatCheckboxModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div class="titles">
          <span class="eyebrow">Governance · OPA</span>
          <h1>Policy Studio</h1>
          <p class="subtitle">Author OPA rego bundles. One bundle is active per tenant — the sidecar
            evaluates it; the runtime forwards each experience’s <code>policies</code> for a decision.</p>
        </div>
        <button matButton="filled" type="button" (click)="toggleCreate()" [attr.aria-expanded]="createOpen()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          New bundle
        </button>
      </div>

      @if (formOpen()) {
        <form class="card card-pad create" (ngSubmit)="save()">
          @if (editTarget()) { <div class="eyebrow" style="margin-bottom:var(--s3)">Editing · {{ editTarget()!.name }}</div> }
          <div class="grid-2">
            <mat-form-field appearance="outline" class="mf">
              <mat-label>Name</mat-label>
              <input matInput name="name" [(ngModel)]="name" [disabled]="!!editTarget()" placeholder="matter-access" autocomplete="off" spellcheck="false" />
              @if (editTarget()) { <mat-hint>Name is immutable.</mat-hint> }
            </mat-form-field>
            <mat-form-field appearance="outline" class="mf">
              <mat-label>Rule path</mat-label>
              <input matInput class="mono" name="path" [(ngModel)]="rulePath" placeholder="maverick/allow" autocomplete="off" spellcheck="false" />
            </mat-form-field>
            <mat-form-field appearance="outline" class="mf" style="grid-column:1 / -1">
              <mat-label>Rego source</mat-label>
              <textarea matInput class="mono" name="rego" rows="9" [(ngModel)]="rego" spellcheck="false"
                placeholder="package maverick&#10;&#10;default allow = false&#10;allow { input.subject.roles[_] == &quot;lead-counsel&quot; }"></textarea>
            </mat-form-field>
          </div>
          @if (!editTarget()) { <mat-checkbox name="act" [(ngModel)]="activateNow" style="margin-top:var(--s4)">Activate on create (replaces the current active bundle)</mat-checkbox> }
          <div class="row" style="margin-top:var(--s5)">
            <button matButton="filled" type="submit" [disabled]="!canSave() || saving()">
              @if (saving()) { <span class="spinner" aria-hidden="true"></span> Saving… }
              @else if (editTarget()) { Save changes } @else { Create bundle }
            </button>
            <button matButton type="button" (click)="cancelForm()">Cancel</button>
          </div>
        </form>
      }

      @if (loading()) {
        <ul class="rows" aria-hidden="true">@for (i of [1,2]; track i) { <li class="skeleton skeleton-row"></li> }</ul>
      } @else if (error()) {
        <div class="empty" role="alert"><div class="empty-icon" style="background:var(--danger-soft);color:var(--danger)">!</div>
          <h3>Couldn’t load bundles</h3><p class="muted">{{ error() }}</p><button matButton (click)="refresh()">Retry</button></div>
      } @else if (items().length === 0) {
        <div class="empty">
          <div class="empty-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3 4 6v5c0 5 3.4 8 8 10 4.6-2 8-5 8-10V6l-8-3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></div>
          <h3>No policy bundles yet</h3><p>Author a rego bundle and activate it to enforce experience policies.</p>
          <button matButton="filled" (click)="openCreate()">New bundle</button>
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
              @if (!b.isActive) { <button matButton type="button" (click)="activate(b)">Activate</button> }
              <button matButton type="button" (click)="startEdit(b)">Edit</button>
              <button matButton class="danger-btn" type="button" (click)="remove(b)">Delete</button>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    .mf { width: 100%; }
    .danger-btn { color: var(--danger); }
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
  readonly editTarget = signal<PolicyBundle | null>(null);
  readonly formOpen = computed(() => this.createOpen() || this.editTarget() !== null);

  name = '';
  rulePath = 'maverick/allow';
  rego = '';
  activateNow = false;

  constructor() { this.refresh(); }

  canSave(): boolean { return (!!this.editTarget() || this.name.trim() !== '') && this.rego.trim() !== ''; }
  toggleCreate(): void { if (this.formOpen()) { this.cancelForm(); return; } this.createOpen.set(true); }
  openCreate(): void { this.editTarget.set(null); this.reset(); this.createOpen.set(true); }
  cancelForm(): void { this.createOpen.set(false); this.editTarget.set(null); this.reset(); }
  private reset(): void { this.name = ''; this.rego = ''; this.rulePath = 'maverick/allow'; this.activateNow = false; }

  startEdit(b: PolicyBundle): void {
    this.createOpen.set(false);
    this.editTarget.set(b);
    this.name = b.name;
    this.rulePath = b.rulePath;
    this.rego = b.regoSource;
  }

  save(): void {
    const target = this.editTarget();
    if (target) { this.saveEdit(target); return; }
    this.create();
  }

  private saveEdit(target: PolicyBundle): void {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.policy.update(target.id, { regoSource: this.rego, rulePath: this.rulePath.trim() || undefined }).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.editTarget.set(null);
        this.reset();
        this.items.update((cur) => cur.map((x) => (x.id === updated.id ? updated : x)));
        this.toast.success('Bundle updated', `“${updated.name}” saved.`);
      },
      error: (err) => { this.saving.set(false); this.toast.error('Update failed', msg(err)); },
    });
  }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.policy.list().subscribe({
      next: (res) => { this.items.set(res.items); this.loading.set(false); },
      error: (err) => { this.error.set(msg(err)); this.loading.set(false); },
    });
  }

  create(): void {
    if (!this.canSave()) return;
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
