import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CatalogClientService, type Capability } from '../services/catalog-client.service';
import { ConfirmDialogComponent } from '../components/confirm-dialog.component';
import { autoRefresh } from '../services/auto-refresh.service';
import { autoStream } from '../services/catalog-stream.service';

const CAPABILITY_KINDS = [
  'tool', 'component', 'capability', 'backend', 'mfe', 'action', 'intent',
  'form', 'datasource', 'validation', 'persistence', 'layout',
  'schema-transformer', 'approval', 'operation',
] as const;
type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

const LIFECYCLES = ['draft', 'published', 'deprecated', 'disabled'] as const;
type Lifecycle = (typeof LIFECYCLES)[number];

@Component({
  selector: 'ops-capabilities',
  imports: [DatePipe, FormsModule, ConfirmDialogComponent],
  template: `
    <div class="header">
      <h1>Capabilities</h1>
      <button class="btn primary" type="button" (click)="openCreate()">+ Register capability</button>
    </div>

    @if (error(); as err) {
      <div class="error">Failed: {{ err }}</div>
    }
    @if (loading()) {
      <p class="dim">Loading…</p>
    } @else if (items().length === 0) {
      <div class="empty">No capabilities registered for this tenant yet.</div>
    } @else {
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th>Lifecycle</th>
            <th>Owner</th>
            <th>Tags</th>
            <th>Updated</th>
            <th class="actions-col">Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (cap of items(); track cap.id) {
            <tr>
              <td class="mono">{{ cap.name }}</td>
              <td>{{ cap.kind }}</td>
              <td>
                <select
                  [ngModel]="cap.lifecycle"
                  (ngModelChange)="changeLifecycle(cap, $event)"
                  class="lifecycle-select"
                  [class.good]="cap.lifecycle === 'published'"
                  [class.warn]="cap.lifecycle === 'deprecated'"
                  [class.bad]="cap.lifecycle === 'disabled'"
                >
                  @for (lc of lifecycles; track lc) {
                    <option [value]="lc">{{ lc }}</option>
                  }
                </select>
              </td>
              <td>{{ cap.owner ?? '—' }}</td>
              <td>{{ cap.tags.join(', ') || '—' }}</td>
              <td class="dim">{{ cap.updatedAt | date: 'short' }}</td>
              <td class="actions">
                <button class="btn small bad" type="button" (click)="askDelete(cap)">Delete</button>
              </td>
            </tr>
          }
        </tbody>
      </table>
      <p class="dim">Showing {{ items().length }} of {{ total() }}</p>
    }

    <!-- ── Create modal ────────────────────────────────────── -->
    @if (showCreate()) {
      <div class="backdrop" (click)="closeCreate()">
        <div class="dialog" (click)="$event.stopPropagation()">
          <h2>Register a capability</h2>
          <label class="dim small">Kind</label>
          <select [(ngModel)]="createKind">
            @for (k of kinds; track k) { <option [value]="k">{{ k }}</option> }
          </select>
          <label class="dim small">Name (must match [A-Za-z0-9_./:@-]+)</label>
          <input [(ngModel)]="createName" class="mono" placeholder="bookFlight" autofocus />
          <label class="dim small">Body (JSON object, capability-kind specific)</label>
          <textarea
            [(ngModel)]="createBodyJson"
            class="mono"
            rows="6"
            placeholder='{"description":"a tool for testing"}'
          ></textarea>
          <label class="dim small">Lifecycle</label>
          <select [(ngModel)]="createLifecycle">
            @for (lc of lifecycles; track lc) { <option [value]="lc">{{ lc }}</option> }
          </select>
          <label class="dim small">Tags (comma-separated, optional)</label>
          <input [(ngModel)]="createTags" placeholder="travel,booking" />
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

    <!-- ── Delete confirm ──────────────────────────────────── -->
    @if (deleteCandidate(); as cap) {
      <ops-confirm-dialog
        [title]="'Soft-delete capability ' + cap.name + '?'"
        message="Capability is removed from default lists. Audit history is retained. Use ?includeDeleted=true on the list endpoint to recover."
        confirmLabel="Delete"
        [destructive]="true"
        (confirm)="executeDelete(cap)"
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

    .lifecycle-select {
      background: var(--bg-elev);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 600;
    }
    .lifecycle-select.good { color: var(--good); border-color: var(--good); }
    .lifecycle-select.warn { color: var(--warn); border-color: var(--warn); }
    .lifecycle-select.bad  { color: var(--bad);  border-color: var(--bad);  }

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
    .dialog input, .dialog textarea, .dialog select {
      background: var(--bg);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      font: inherit;
      width: 100%;
    }
    .dialog textarea { resize: vertical; }
    .dialog input:focus, .dialog textarea:focus, .dialog select:focus {
      outline: none; border-color: var(--accent);
    }
    .dialog-actions {
      display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px;
    }
  `],
})
export class CapabilitiesComponent {
  private readonly catalog = inject(CatalogClientService);

  readonly kinds = CAPABILITY_KINDS;
  readonly lifecycles = LIFECYCLES;

  readonly items = signal<readonly Capability[]>([]);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  // ── create state ──────────────────────────────────────────────
  readonly showCreate = signal(false);
  readonly createSubmitting = signal(false);
  readonly createError = signal<string | null>(null);
  createKind: CapabilityKind = 'tool';
  createName = '';
  createBodyJson = '{}';
  createLifecycle: Lifecycle = 'published';
  createTags = '';

  // ── delete state ──────────────────────────────────────────────
  readonly deleteCandidate = signal<Capability | null>(null);

  constructor() {
    this.refresh();
    // Real-time: re-fetch on every catalog mutation pushed via SSE.
    // Falls back to the 8s polling tick when the stream is closed
    // (CatalogStreamService toggles AutoRefreshService accordingly).
    autoStream(() => this.refresh(true));
    autoRefresh(() => this.refresh(true));
  }

  /**
   * @param silent when true, don't flip the loading flag — keeps the
   *   table stable during background polls instead of flashing the
   *   "Loading…" placeholder every tick.
   */
  refresh(silent = false): void {
    if (!silent) this.loading.set(true);
    this.catalog.listCapabilities({ limit: 100 }).subscribe({
      next: (res) => {
        this.items.set(res.items);
        this.total.set(res.total);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.detail ?? err?.message ?? 'unknown error');
        this.loading.set(false);
      },
    });
  }

  // ── create flow ───────────────────────────────────────────────
  openCreate(): void {
    this.createKind = 'tool';
    this.createName = '';
    this.createBodyJson = '{}';
    this.createLifecycle = 'published';
    this.createTags = '';
    this.createError.set(null);
    this.showCreate.set(true);
  }

  closeCreate(): void { this.showCreate.set(false); }

  submitCreate(): void {
    const name = this.createName.trim();
    if (!name || !/^[A-Za-z0-9_./:@-]+$/.test(name)) {
      this.createError.set('Name is required and must match [A-Za-z0-9_./:@-]+');
      return;
    }
    let body: Record<string, unknown>;
    try { body = JSON.parse(this.createBodyJson) as Record<string, unknown>; }
    catch { this.createError.set('Body is not valid JSON'); return; }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      this.createError.set('Body must be a JSON object');
      return;
    }

    const tags = this.createTags
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    this.createError.set(null);
    this.createSubmitting.set(true);
    this.catalog.createCapability({
      kind: this.createKind,
      name,
      body,
      lifecycle: this.createLifecycle,
      tags,
    }).subscribe({
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

  // ── lifecycle change (in-row dropdown) ────────────────────────
  changeLifecycle(cap: Capability, lifecycle: Lifecycle): void {
    if (cap.lifecycle === lifecycle) return;
    this.catalog.patchCapability(cap.id, { lifecycle }).subscribe({
      next: () => this.refresh(),
      error: (err) => {
        this.error.set(err?.error?.detail ?? err?.message ?? 'unknown error');
      },
    });
  }

  // ── delete flow ───────────────────────────────────────────────
  askDelete(cap: Capability): void { this.deleteCandidate.set(cap); }

  executeDelete(cap: Capability): void {
    this.catalog.deleteCapability(cap.id).subscribe({
      next: () => {
        this.deleteCandidate.set(null);
        this.refresh();
      },
      error: (err) => {
        this.error.set(err?.error?.detail ?? err?.message ?? 'unknown error');
        this.deleteCandidate.set(null);
      },
    });
  }
}
