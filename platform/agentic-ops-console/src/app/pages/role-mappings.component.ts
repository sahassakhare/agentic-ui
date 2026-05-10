import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogClientService, type RoleMapping } from '../services/catalog-client.service';
import { ConfirmDialogComponent } from '../components/confirm-dialog.component';
import { autoRefresh } from '../services/auto-refresh.service';
import { autoStream } from '../services/catalog-stream.service';

type ModalMode = 'create' | { kind: 'edit'; mapping: RoleMapping };

@Component({
  selector: 'ops-role-mappings',
  imports: [FormsModule, ConfirmDialogComponent],
  template: `
    <div class="header">
      <h1>Role mappings</h1>
      <button class="btn primary" type="button" (click)="openCreate()">+ Add mapping</button>
    </div>
    <p class="dim">
      IdP claim → runtime persona, ordered by priority (highest wins).
      The runtime adapter calls
      <code>POST /role-mappings/resolve</code> on every login.
      Mappings to protected personas (<code>platform-admin</code>,
      <code>lead-counsel</code> by default) require the
      <code>platform-admin</code> JWT role per
      <a href="https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0016-iam-role-mapping.md" target="_blank" rel="noopener">ADR-016</a>.
    </p>
    @if (error(); as err) { <div class="error">Failed: {{ err }}</div> }
    @if (loading()) {
      <p class="dim">Loading…</p>
    } @else if (items().length === 0) {
      <div class="empty">No role mappings configured for this tenant.</div>
    } @else {
      <table>
        <thead>
          <tr>
            <th>Priority</th>
            <th>Claim path</th>
            <th>Claim value</th>
            <th>Runtime persona</th>
            <th>Enabled</th>
            <th>Created by</th>
            <th class="actions-col">Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (m of items(); track m.id) {
            <tr [class.row-disabled]="!m.enabled">
              <td class="mono">{{ m.priority }}</td>
              <td class="mono">{{ m.claimPath }}</td>
              <td class="mono">{{ m.claimValue }}</td>
              <td>
                <span class="badge primary">{{ m.runtimePersona }}</span>
              </td>
              <td>
                @if (m.enabled) {
                  <span class="badge good">enabled</span>
                } @else {
                  <span class="badge bad">disabled</span>
                }
              </td>
              <td class="dim small">{{ m.createdBy }}</td>
              <td class="actions">
                <button class="btn small" type="button" (click)="toggle(m)">
                  {{ m.enabled ? 'Disable' : 'Enable' }}
                </button>
                <button class="btn small" type="button" (click)="openEdit(m)">Edit</button>
                <button class="btn small bad" type="button" (click)="askDelete(m)">Delete</button>
              </td>
            </tr>
          }
        </tbody>
      </table>
    }

    <!-- ── Create / Edit modal ─────────────────────────────── -->
    @if (modal(); as mode) {
      <div class="backdrop" (click)="closeModal()">
        <div class="dialog" (click)="$event.stopPropagation()">
          <h2>{{ mode === 'create' ? 'Add a role mapping' : 'Edit mapping' }}</h2>
          @if (mode === 'create') {
            <label class="dim small">Claim path (default 'groups')</label>
            <input [(ngModel)]="formClaimPath" class="mono" placeholder="groups" />
            <label class="dim small">Claim value (matches the JWT claim)</label>
            <input [(ngModel)]="formClaimValue" class="mono" placeholder="engineering@acme.com" autofocus />
          } @else {
            <p class="dim small mono">
              {{ mode.mapping.claimPath }} = {{ mode.mapping.claimValue }} <span class="dim">(immutable)</span>
            </p>
          }
          <label class="dim small">Runtime persona</label>
          <input [(ngModel)]="formRuntimePersona" class="mono" placeholder="paralegal" />
          <label class="dim small">Priority (0–10000; higher wins)</label>
          <input [(ngModel)]="formPriority" type="number" min="0" max="10000" class="mono" />
          <label class="dim small">Description (optional)</label>
          <input [(ngModel)]="formDescription" placeholder="why this mapping exists" />
          <label class="enabled-row dim small">
            <input type="checkbox" [(ngModel)]="formEnabled" /> enabled
          </label>
          @if (formError(); as err) { <div class="error">{{ err }}</div> }
          <div class="dialog-actions">
            <button class="btn" type="button" (click)="closeModal()">Cancel</button>
            <button class="btn primary" type="button" [disabled]="submitting()" (click)="submit()">
              {{ submitting() ? 'Saving…' : (mode === 'create' ? 'Create' : 'Save') }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- ── Delete confirm ──────────────────────────────────── -->
    @if (deleteCandidate(); as m) {
      <ops-confirm-dialog
        [title]="'Delete mapping?'"
        [message]="'Mapping ' + m.claimPath + '=' + m.claimValue + ' → ' + m.runtimePersona + ' will be removed. JWT-bearers no longer match this rule on the next login.'"
        confirmLabel="Delete"
        [destructive]="true"
        (confirm)="executeDelete(m)"
        (cancel)="deleteCandidate.set(null)"
      />
    }
  `,
  styles: [`
    .header { display: flex; justify-content: space-between; align-items: center; }
    .small { font-size: 11px; color: var(--fg-muted); }
    code { font-family: var(--mono); background: var(--bg-elev-2); padding: 1px 4px; border-radius: 4px; }
    tr.row-disabled td { opacity: 0.5; }
    .badge.primary { color: var(--accent); border-color: var(--accent); }
    .actions-col { width: 1%; white-space: nowrap; }
    .actions { display: flex; gap: 4px; }
    .btn.small { padding: 3px 8px; font-size: 11px; }
    .btn.bad { background: var(--bad); border-color: var(--bad); color: white; }
    .enabled-row { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
    .enabled-row input[type=checkbox] { width: auto; }
    /* Modal */
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
      display: flex; flex-direction: column; gap: 6px;
    }
    .dialog h2 { margin: 0 0 8px 0; }
    .dialog input {
      background: var(--bg);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      font: inherit;
      width: 100%;
    }
    .dialog input:focus { outline: none; border-color: var(--accent); }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  `],
})
export class RoleMappingsComponent {
  private readonly catalog = inject(CatalogClientService);

  readonly items = signal<readonly RoleMapping[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  // ── modal + form state ────────────────────────────────────────
  readonly modal = signal<ModalMode | null>(null);
  readonly submitting = signal(false);
  readonly formError = signal<string | null>(null);
  readonly deleteCandidate = signal<RoleMapping | null>(null);
  formClaimPath = 'groups';
  formClaimValue = '';
  formRuntimePersona = '';
  formPriority = 100;
  formEnabled = true;
  formDescription = '';

  constructor() {
    this.fetch();
    autoStream(() => this.fetch(true));
    autoRefresh(() => this.fetch(true));
  }

  private fetch(silent = false): void {
    if (!silent) this.loading.set(true);
    this.catalog.listRoleMappings().subscribe({
      next: (res) => { this.items.set(res.items); this.loading.set(false); },
      error: (err) => {
        this.error.set(err?.error?.detail ?? err?.message ?? 'unknown error');
        this.loading.set(false);
      },
    });
  }

  openCreate(): void {
    this.formClaimPath = 'groups';
    this.formClaimValue = '';
    this.formRuntimePersona = '';
    this.formPriority = 100;
    this.formEnabled = true;
    this.formDescription = '';
    this.formError.set(null);
    this.modal.set('create');
  }

  openEdit(mapping: RoleMapping): void {
    this.formRuntimePersona = mapping.runtimePersona;
    this.formPriority = mapping.priority;
    this.formEnabled = mapping.enabled;
    this.formDescription = mapping.description ?? '';
    this.formError.set(null);
    this.modal.set({ kind: 'edit', mapping });
  }

  closeModal(): void { this.modal.set(null); }

  submit(): void {
    const m = this.modal();
    if (!m) return;
    const persona = this.formRuntimePersona.trim();
    if (!persona) { this.formError.set('Runtime persona is required'); return; }
    const priority = Number(this.formPriority);
    if (!Number.isInteger(priority) || priority < 0 || priority > 10_000) {
      this.formError.set('Priority must be an integer between 0 and 10000');
      return;
    }
    const description = this.formDescription.trim() || null;

    this.formError.set(null);
    this.submitting.set(true);
    const after = () => {
      this.submitting.set(false);
      this.modal.set(null);
      this.fetch();
    };
    const onError = (err: { error?: { detail?: string }; message?: string }) => {
      this.submitting.set(false);
      this.formError.set(err?.error?.detail ?? err?.message ?? 'unknown error');
    };

    if (m === 'create') {
      const claimValue = this.formClaimValue.trim();
      const claimPath = this.formClaimPath.trim() || 'groups';
      if (!claimValue) { this.submitting.set(false); this.formError.set('Claim value is required'); return; }
      this.catalog.createRoleMapping({
        claimPath, claimValue, runtimePersona: persona,
        priority, enabled: this.formEnabled, description,
      }).subscribe({ next: after, error: onError });
    } else {
      this.catalog.patchRoleMapping(m.mapping.id, {
        runtimePersona: persona, priority,
        enabled: this.formEnabled, description,
      }).subscribe({ next: after, error: onError });
    }
  }

  toggle(m: RoleMapping): void {
    this.catalog.patchRoleMapping(m.id, { enabled: !m.enabled }).subscribe({
      next: () => this.fetch(),
      error: (err) => {
        this.error.set(err?.error?.detail ?? err?.message ?? 'unknown error');
      },
    });
  }

  askDelete(m: RoleMapping): void { this.deleteCandidate.set(m); }

  executeDelete(m: RoleMapping): void {
    this.catalog.deleteRoleMapping(m.id).subscribe({
      next: () => { this.deleteCandidate.set(null); this.fetch(); },
      error: (err) => {
        this.error.set(err?.error?.detail ?? err?.message ?? 'unknown error');
        this.deleteCandidate.set(null);
      },
    });
  }
}
