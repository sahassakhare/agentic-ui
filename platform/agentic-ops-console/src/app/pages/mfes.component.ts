import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CatalogClientService, type MfeRemote } from '../services/catalog-client.service';
import { ConfirmDialogComponent } from '../components/confirm-dialog.component';
import { autoRefresh } from '../services/auto-refresh.service';
import { autoStream } from '../services/catalog-stream.service';

type ModalMode = 'create' | { kind: 'edit'; mfe: MfeRemote };

@Component({
  selector: 'ops-mfes',
  imports: [DatePipe, FormsModule, ConfirmDialogComponent],
  template: `
    <div class="header">
      <h1>MFE remotes</h1>
      <button class="btn primary" type="button" (click)="openCreate()">+ Register remote</button>
    </div>

    @if (error(); as err) { <div class="error">Failed: {{ err }}</div> }
    @if (loading()) {
      <p class="dim">Loading…</p>
    } @else if (items().length === 0) {
      <div class="empty">No MFE remotes registered for this tenant.</div>
    } @else {
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Manifest URL</th>
            <th>Version</th>
            <th>Status</th>
            <th>Exposes</th>
            <th>Last health</th>
            <th class="actions-col">Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (mfe of items(); track mfe.id) {
            <tr>
              <td class="mono">{{ mfe.name }}</td>
              <td class="mono"><a [href]="mfe.manifestUrl" target="_blank" rel="noopener">{{ mfe.manifestUrl }}</a></td>
              <td>{{ mfe.version ?? '—' }}</td>
              <td>
                <span class="badge" [class.good]="mfe.status === 'active'" [class.warn]="mfe.status === 'degraded'" [class.bad]="mfe.status === 'inactive'">
                  {{ mfe.status }}
                </span>
              </td>
              <td class="mono small">{{ exposesSummary(mfe) }}</td>
              <td class="dim">{{ mfe.lastHealthAt ? (mfe.lastHealthAt | date: 'short') : '—' }}</td>
              <td class="actions">
                <button class="btn small" type="button" (click)="openEdit(mfe)">Edit</button>
                <button class="btn small bad" type="button" (click)="askDelete(mfe)">Delete</button>
              </td>
            </tr>
          }
        </tbody>
      </table>
    }

    <!-- ── Create / Edit modal ─────────────────────────────── -->
    @if (modal(); as m) {
      <div class="backdrop" (click)="closeModal()">
        <div class="dialog" (click)="$event.stopPropagation()">
          <h2>{{ m === 'create' ? 'Register an MFE remote' : 'Edit ' + m.mfe.name }}</h2>
          @if (m === 'create') {
            <label class="dim small">Name (immutable)</label>
            <input [(ngModel)]="formName" class="mono" placeholder="bookings" autofocus />
          }
          <label class="dim small">Manifest URL</label>
          <input [(ngModel)]="formManifestUrl" class="mono" placeholder="https://bookings.example.com/remoteEntry.json" />
          <label class="dim small">Version (optional)</label>
          <input [(ngModel)]="formVersion" class="mono" placeholder="1.2.3" />
          <label class="dim small">Required host version (optional, semver range)</label>
          <input [(ngModel)]="formRequiredHostVersion" class="mono" placeholder="^1.0.0" />
          <label class="dim small">Exposes (JSON; default {{ '{}' }})</label>
          <textarea [(ngModel)]="formExposesJson" class="mono" rows="3" placeholder='{"tools":["bookFlight"]}'></textarea>
          @if (formError(); as err) { <div class="error">{{ err }}</div> }
          <div class="dialog-actions">
            <button class="btn" type="button" (click)="closeModal()">Cancel</button>
            <button class="btn primary" type="button" [disabled]="submitting()" (click)="submit()">
              {{ submitting() ? 'Saving…' : (m === 'create' ? 'Register' : 'Save') }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- ── Delete confirm ──────────────────────────────────── -->
    @if (deleteCandidate(); as mfe) {
      <ops-confirm-dialog
        [title]="'Delete ' + mfe.name + '?'"
        message="MFE remote rows are hard-deleted (federation-manifest entries don't carry historical value)."
        confirmLabel="Delete"
        [destructive]="true"
        (confirm)="executeDelete(mfe)"
        (cancel)="deleteCandidate.set(null)"
      />
    }
  `,
  styles: [`
    .header { display: flex; justify-content: space-between; align-items: center; }
    .small { font-size: 11px; color: var(--fg-muted); }
    .actions-col { width: 1%; white-space: nowrap; }
    .actions { display: flex; gap: 4px; }
    .btn.small { padding: 3px 8px; font-size: 11px; }
    .btn.bad { background: var(--bad); border-color: var(--bad); color: white; }
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
      max-width: 540px;
      width: 90vw;
      max-height: 90vh;
      overflow: auto;
      display: flex; flex-direction: column; gap: 6px;
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
    }
    .dialog textarea { resize: vertical; }
    .dialog input:focus, .dialog textarea:focus { outline: none; border-color: var(--accent); }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  `],
})
export class MfesComponent {
  private readonly catalog = inject(CatalogClientService);

  readonly items = signal<readonly MfeRemote[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  // ── modal + form state ────────────────────────────────────────
  readonly modal = signal<ModalMode | null>(null);
  readonly submitting = signal(false);
  readonly formError = signal<string | null>(null);
  readonly deleteCandidate = signal<MfeRemote | null>(null);
  formName = '';
  formManifestUrl = '';
  formVersion = '';
  formRequiredHostVersion = '';
  formExposesJson = '{}';

  constructor() {
    this.fetch();
    autoStream(() => this.fetch(true));
    autoRefresh(() => this.fetch(true));
  }

  private fetch(silent = false): void {
    if (!silent) this.loading.set(true);
    this.catalog.listMfes().subscribe({
      next: (res) => { this.items.set(res.items); this.loading.set(false); },
      error: (err) => {
        this.error.set(err?.error?.detail ?? err?.message ?? 'unknown error');
        this.loading.set(false);
      },
    });
  }

  exposesSummary(mfe: MfeRemote): string {
    const entries = Object.entries(mfe.exposes);
    if (entries.length === 0) return '—';
    return entries.map(([k, v]) => `${k}: ${v.length}`).join(', ');
  }

  openCreate(): void {
    this.formName = '';
    this.formManifestUrl = '';
    this.formVersion = '';
    this.formRequiredHostVersion = '';
    this.formExposesJson = '{}';
    this.formError.set(null);
    this.modal.set('create');
  }

  openEdit(mfe: MfeRemote): void {
    this.formName = mfe.name;
    this.formManifestUrl = mfe.manifestUrl;
    this.formVersion = mfe.version ?? '';
    this.formRequiredHostVersion = mfe.requiredHostVersion ?? '';
    this.formExposesJson = JSON.stringify(mfe.exposes ?? {}, null, 2);
    this.formError.set(null);
    this.modal.set({ kind: 'edit', mfe });
  }

  closeModal(): void { this.modal.set(null); }

  submit(): void {
    const m = this.modal();
    if (!m) return;
    const manifestUrl = this.formManifestUrl.trim();
    if (!manifestUrl) { this.formError.set('Manifest URL is required'); return; }
    let exposes: Record<string, readonly string[]>;
    try { exposes = JSON.parse(this.formExposesJson || '{}') as Record<string, readonly string[]>; }
    catch { this.formError.set('Exposes is not valid JSON'); return; }
    const version = this.formVersion.trim() || null;
    const requiredHostVersion = this.formRequiredHostVersion.trim() || null;

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
      const name = this.formName.trim();
      if (!name) { this.submitting.set(false); this.formError.set('Name is required'); return; }
      this.catalog.createMfe({
        name, manifestUrl, version, requiredHostVersion, exposes,
      }).subscribe({ next: after, error: onError });
    } else {
      this.catalog.patchMfe(m.mfe.name, {
        manifestUrl, version, requiredHostVersion, exposes,
      }).subscribe({ next: after, error: onError });
    }
  }

  askDelete(mfe: MfeRemote): void { this.deleteCandidate.set(mfe); }

  executeDelete(mfe: MfeRemote): void {
    this.catalog.deleteMfe(mfe.name).subscribe({
      next: () => { this.deleteCandidate.set(null); this.fetch(); },
      error: (err) => {
        this.error.set(err?.error?.detail ?? err?.message ?? 'unknown error');
        this.deleteCandidate.set(null);
      },
    });
  }
}
