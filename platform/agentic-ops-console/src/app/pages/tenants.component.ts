import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CatalogClientService, type Tenant } from '../services/catalog-client.service';
import { AuthService } from '../services/auth.service';
import { ConfirmDialogComponent } from '../components/confirm-dialog.component';
import { autoRefresh } from '../services/auto-refresh.service';
import { autoStream } from '../services/catalog-stream.service';

interface ConfirmAction {
  readonly tenant: Tenant;
  readonly kind: 'suspend' | 'activate' | 'delete';
}

@Component({
  selector: 'ops-tenants',
  imports: [DatePipe, FormsModule, ConfirmDialogComponent],
  template: `
    @if (!isAdmin()) {
      <div class="error">
        Tenant lifecycle endpoints require the <code>platform-admin</code> role.
        Your token does not carry it.
      </div>
    } @else {
      <div class="header">
        <h1>Tenants</h1>
        <button class="btn primary" type="button" (click)="openCreate()">+ Onboard tenant</button>
      </div>
      <p class="dim">
        Platform-level tenant directory. Lifecycle transitions emit
        audit rows scoped to the affected tenant. Quotas are
        recorded but not enforced — hosts apply them at the runtime
        / gateway boundary. See ADR-020.
      </p>

      @if (error(); as err) { <div class="error">Failed: {{ err }}</div> }
      @if (loading()) {
        <p class="dim">Loading…</p>
      } @else if (items().length === 0) {
        <div class="empty">No tenants registered.</div>
      } @else {
        <table>
          <thead>
            <tr>
              <th>Id</th>
              <th>Display name</th>
              <th>Status</th>
              <th>Onboarded</th>
              <th>Suspended</th>
              <th>Quotas</th>
              <th class="actions-col">Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (t of items(); track t.id) {
              <tr [class.dim]="t.status === 'deleted'">
                <td class="mono">{{ t.id }}</td>
                <td>{{ t.displayName }}</td>
                <td>
                  <span class="badge" [class.good]="t.status === 'active'" [class.warn]="t.status === 'suspended'" [class.bad]="t.status === 'deleted'">
                    {{ t.status }}
                  </span>
                </td>
                <td class="dim">
                  @if (t.onboardedAt) {
                    {{ t.onboardedAt | date: 'short' }}
                    <div class="mono small">by {{ t.onboardedBy }}</div>
                  } @else { — }
                </td>
                <td class="dim">
                  @if (t.suspendedAt) {
                    {{ t.suspendedAt | date: 'short' }}
                    <div class="mono small">{{ t.suspendedReason }}</div>
                  } @else { — }
                </td>
                <td class="mono small">{{ quotaSummary(t) }}</td>
                <td class="actions">
                  @if (t.status === 'active') {
                    <button class="btn small" type="button" (click)="askSuspend(t)">Suspend</button>
                  } @else if (t.status === 'suspended') {
                    <button class="btn small" type="button" (click)="askActivate(t)">Activate</button>
                  }
                  @if (t.status !== 'deleted') {
                    <button class="btn small bad" type="button" (click)="askDelete(t)">Delete</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
        <p class="dim">{{ items().length }} tenants</p>
      }

      <!-- ── Create modal ────────────────────────────────────── -->
      @if (showCreate()) {
        <div class="backdrop" (click)="closeCreate()">
          <div class="dialog" (click)="$event.stopPropagation()">
            <h2>Onboard a tenant</h2>
            <label class="dim small">Tenant id (immutable)</label>
            <input
              [(ngModel)]="createId"
              class="mono"
              placeholder="acme"
              autofocus
            />
            <label class="dim small">Display name</label>
            <input [(ngModel)]="createDisplayName" placeholder="Acme Corp" />
            <label class="dim small">Quotas (optional, JSON)</label>
            <textarea
              [(ngModel)]="createQuotasJson"
              class="mono"
              rows="3"
              placeholder='{"monthlyTokens": 1000000}'
            ></textarea>
            @if (createError(); as err) { <div class="error">{{ err }}</div> }
            <div class="dialog-actions">
              <button class="btn" type="button" (click)="closeCreate()">Cancel</button>
              <button
                class="btn primary"
                type="button"
                [disabled]="createSubmitting()"
                (click)="submitCreate()"
              >
                {{ createSubmitting() ? 'Creating…' : 'Create' }}
              </button>
            </div>
          </div>
        </div>
      }

      <!-- ── Lifecycle confirm ───────────────────────────────── -->
      @if (pendingAction(); as a) {
        <ops-confirm-dialog
          [title]="confirmTitle(a)"
          [message]="confirmMessage(a)"
          [confirmLabel]="confirmLabel(a)"
          [destructive]="a.kind === 'delete'"
          [requireReason]="a.kind === 'suspend'"
          (confirm)="executeAction(a, $event.reason)"
          (cancel)="pendingAction.set(null)"
        />
      }
    }
  `,
  styles: [`
    .header { display: flex; justify-content: space-between; align-items: center; }
    .small { font-size: 11px; color: var(--fg-muted); }
    code { font-family: var(--mono); background: var(--bg-elev-2); padding: 1px 4px; border-radius: 4px; }
    .actions-col { width: 1%; white-space: nowrap; }
    .actions { display: flex; gap: 4px; }
    .btn.small { padding: 3px 8px; font-size: 11px; }
    .btn.bad {
      background: var(--bad); border-color: var(--bad); color: white;
    }
    /* Modal styles */
    .backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.6);
      display: grid; place-items: center; z-index: 100;
    }
    .dialog {
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      max-width: 480px;
      width: 90vw;
      display: flex; flex-direction: column; gap: 8px;
    }
    .dialog h2 { margin: 0 0 8px 0; }
    .dialog input, .dialog textarea {
      background: var(--bg);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      font: inherit;
      width: 100%;
      resize: vertical;
    }
    .dialog input:focus, .dialog textarea:focus { outline: none; border-color: var(--accent); }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  `],
})
export class TenantsComponent {
  private readonly catalog = inject(CatalogClientService);
  private readonly auth = inject(AuthService);

  readonly isAdmin = this.auth.isPlatformAdmin;
  readonly items = signal<readonly Tenant[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  // ── create-modal state ────────────────────────────────────────
  readonly showCreate = signal(false);
  readonly createSubmitting = signal(false);
  readonly createError = signal<string | null>(null);
  createId = '';
  createDisplayName = '';
  createQuotasJson = '';

  // ── action-confirm state ──────────────────────────────────────
  readonly pendingAction = signal<ConfirmAction | null>(null);

  constructor() {
    if (!this.isAdmin()) {
      this.loading.set(false);
      return;
    }
    this.refresh();
    autoStream(() => this.refresh(true));
    autoRefresh(() => this.refresh(true));
  }

  refresh(silent = false): void {
    if (!silent) this.loading.set(true);
    this.catalog.listTenants(true).subscribe({
      next: (res) => { this.items.set(res.items); this.loading.set(false); },
      error: (err) => {
        this.error.set(err?.error?.detail ?? err?.message ?? 'unknown error');
        this.loading.set(false);
      },
    });
  }

  quotaSummary(t: Tenant): string {
    const entries = Object.entries(t.quotas);
    if (entries.length === 0) return '—';
    return entries.map(([k, v]) => `${k}=${v}`).join(', ');
  }

  // ── create ────────────────────────────────────────────────────
  openCreate(): void {
    this.createId = '';
    this.createDisplayName = '';
    this.createQuotasJson = '';
    this.createError.set(null);
    this.showCreate.set(true);
  }

  closeCreate(): void {
    this.showCreate.set(false);
  }

  submitCreate(): void {
    const id = this.createId.trim();
    const displayName = this.createDisplayName.trim();
    if (!id || !/^[a-zA-Z0-9_.-]+$/.test(id)) {
      this.createError.set('Tenant id must match [a-zA-Z0-9_.-]+');
      return;
    }
    if (!displayName) {
      this.createError.set('Display name is required');
      return;
    }
    let quotas: Record<string, unknown> | undefined;
    if (this.createQuotasJson.trim()) {
      try { quotas = JSON.parse(this.createQuotasJson) as Record<string, unknown>; }
      catch { this.createError.set('Quotas is not valid JSON'); return; }
    }
    this.createError.set(null);
    this.createSubmitting.set(true);
    const payload = quotas ? { id, displayName, quotas } : { id, displayName };
    this.catalog.createTenant(payload).subscribe({
      next: () => {
        this.createSubmitting.set(false);
        this.showCreate.set(false);
        this.refresh();
      },
      error: (err) => {
        this.createSubmitting.set(false);
        this.createError.set(err?.error?.detail ?? err?.message ?? 'unknown error');
      },
    });
  }

  // ── lifecycle actions ─────────────────────────────────────────
  askSuspend(t: Tenant): void { this.pendingAction.set({ tenant: t, kind: 'suspend' }); }
  askActivate(t: Tenant): void { this.pendingAction.set({ tenant: t, kind: 'activate' }); }
  askDelete(t: Tenant): void { this.pendingAction.set({ tenant: t, kind: 'delete' }); }

  confirmTitle(a: ConfirmAction): string {
    return ({
      suspend: `Suspend ${a.tenant.id}?`,
      activate: `Activate ${a.tenant.id}?`,
      delete: `Soft-delete ${a.tenant.id}?`,
    })[a.kind];
  }

  confirmMessage(a: ConfirmAction): string {
    return ({
      suspend: 'The tenant\'s status flips to "suspended". Catalog reads stay open (audit visibility); hosts that key on status will refuse new traffic.',
      activate: 'The tenant\'s status flips back to "active".',
      delete: 'Tenant data is preserved (soft-delete only). True purges are a manual psql operation. Audit history is retained.',
    })[a.kind];
  }

  confirmLabel(a: ConfirmAction): string {
    return ({ suspend: 'Suspend', activate: 'Activate', delete: 'Delete' })[a.kind];
  }

  executeAction(a: ConfirmAction, reason: string): void {
    const id = a.tenant.id;
    const after = () => {
      this.pendingAction.set(null);
      this.refresh();
    };
    const onError = (err: { error?: { detail?: string }; message?: string }) => {
      this.error.set(err?.error?.detail ?? err?.message ?? 'unknown error');
      this.pendingAction.set(null);
    };
    if (a.kind === 'suspend') {
      this.catalog.suspendTenant(id, reason).subscribe({ next: after, error: onError });
    } else if (a.kind === 'activate') {
      this.catalog.activateTenant(id).subscribe({ next: after, error: onError });
    } else {
      this.catalog.deleteTenant(id).subscribe({ next: after, error: onError });
    }
  }
}
