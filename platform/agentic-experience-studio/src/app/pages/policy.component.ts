import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PolicyCatalogService, type PolicyBundle } from '../services/policy-catalog.service';

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
    <h1>Policy Studio</h1>
    <p class="muted">Author OPA rego bundles. One bundle is active per tenant.</p>

    <details class="create" [open]="createOpen()">
      <summary (click)="toggleCreate($event)">+ New bundle</summary>
      <div class="form">
        <label>Name <input [(ngModel)]="name" placeholder="matter-access" /></label>
        <label>Rule path <input [(ngModel)]="rulePath" placeholder="maverick/allow" /></label>
        <label class="wide">Rego source
          <textarea rows="8" [(ngModel)]="rego" placeholder="package maverick&#10;&#10;default allow = false&#10;allow { input.subject.roles[_] == &quot;lead-counsel&quot; }"></textarea>
        </label>
        <label class="check"><input type="checkbox" [(ngModel)]="activateNow" /> Activate on create</label>
        <button [disabled]="!canCreate() || saving()" (click)="create()">{{ saving() ? 'Saving…' : 'Create' }}</button>
      </div>
    </details>

    @if (error()) { <p class="error">{{ error() }}</p> }
    @if (loading()) { <p>Loading…</p> }
    @if (!loading() && items().length === 0) { <p class="muted">No policy bundles yet.</p> }

    <ul class="list">
      @for (b of items(); track b.id) {
        <li [class.active]="b.isActive">
          <strong>{{ b.name }}</strong>
          <code>{{ b.rulePath }}</code>
          @if (b.isActive) { <span class="badge">active</span> }
          <span class="spacer"></span>
          @if (!b.isActive) { <button (click)="activate(b)">Activate</button> }
          <button class="del" (click)="remove(b)">Delete</button>
        </li>
      }
    </ul>
  `,
  styles: [`
    label { display: flex; flex-direction: column; font-size: .75rem; gap: .25rem; }
    input, textarea { padding: .35rem .5rem; font: inherit; }
    textarea { font-family: ui-monospace, monospace; }
    .create { margin-bottom: 1rem; }
    .create summary { cursor: pointer; padding: .4rem 0; font-weight: 600; }
    .create .form { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; padding: .5rem 0; }
    .create .form .wide { grid-column: 1 / -1; }
    .create .check { flex-direction: row; align-items: center; gap: .4rem; }
    .create button { grid-column: 1 / -1; justify-self: start; padding: .4rem 1rem; }
    .list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: .5rem; }
    .list li { display: flex; gap: .75rem; align-items: center; padding: .6rem .75rem;
      border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: 8px; }
    .list li.active { border-color: seagreen; }
    .spacer { margin-left: auto; }
    code { opacity: .7; font-size: .8rem; }
    .badge { font-size: .7rem; text-transform: uppercase; padding: .1rem .4rem; border-radius: 4px;
      background: color-mix(in srgb, green 30%, transparent); }
    .del { padding: .2rem .6rem; font-size: .8rem; }
    .error { color: crimson; } .muted { opacity: .6; }
  `],
})
export class PolicyComponent {
  private readonly policy = inject(PolicyCatalogService);

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

  canCreate(): boolean {
    return this.name.trim() !== '' && this.rego.trim() !== '';
  }

  toggleCreate(ev: Event): void { ev.preventDefault(); this.createOpen.update((v) => !v); }

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
    this.error.set(null);
    this.policy
      .create({ name: this.name.trim(), regoSource: this.rego, rulePath: this.rulePath.trim() || undefined, isActive: this.activateNow })
      .subscribe({
        next: () => { this.saving.set(false); this.createOpen.set(false); this.name = this.rego = ''; this.refresh(); },
        error: (err) => { this.error.set(msg(err)); this.saving.set(false); },
      });
  }

  activate(b: PolicyBundle): void {
    this.policy.setActive(b.id, true).subscribe({
      next: () => this.refresh(), // server deactivates the previous active bundle
      error: (err) => this.error.set(msg(err)),
    });
  }

  remove(b: PolicyBundle): void {
    this.policy.remove(b.id).subscribe({
      next: () => this.items.update((cur) => cur.filter((x) => x.id !== b.id)),
      error: (err) => this.error.set(msg(err)),
    });
  }
}

function msg(err: unknown): string {
  const e = err as { status?: number; error?: { message?: string } };
  if (e?.status === 401) return 'Session expired — please sign in again.';
  if (e?.status === 409) return e.error?.message ?? 'Conflict.';
  return e?.error?.message ?? 'Request failed.';
}
