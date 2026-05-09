import { Component, inject, signal } from '@angular/core';
import { SlicePipe } from '@angular/common';
import { CatalogClientService, type AuditVerifyResult } from '../services/catalog-client.service';
import { autoRefresh } from '../services/auto-refresh.service';
import { autoStream } from '../services/catalog-stream.service';

@Component({
  selector: 'ops-audit',
  template: `
    <h1>Audit chain</h1>
    <p class="dim">
      Tamper-evident, hash-linked log of every catalog mutation.
      Run a verification any time; download the JSONL stream for SIEM
      ingest or auditor delivery.
    </p>

    <section class="card">
      <h2>Chain status</h2>
      @if (verifyError(); as err) {
        <div class="error">Verification failed: {{ err }}</div>
      } @else if (verifyResult(); as r) {
        @if (r.valid) {
          <div class="status good">
            <span class="badge good">VALID</span>
            <span>{{ r.checkedRows }} rows verified.</span>
            @if (r.chainHead) {
              <span class="dim mono">head @ {{ r.chainHead.chainPosition }} = {{ r.chainHead.entryHash | slice: 0:16 }}…</span>
            }
          </div>
        } @else {
          <div class="status bad">
            <span class="badge bad">BROKEN</span>
            @if (r.brokenAt) {
              <span>Chain broke at position <strong>{{ r.brokenAt.chainPosition }}</strong>: {{ r.brokenAt.reason }}</span>
            }
          </div>
        }
      } @else {
        <p class="dim">Click <em>Verify</em> to walk the chain.</p>
      }
      <div class="actions">
        <button class="btn" type="button" [disabled]="verifying()" (click)="verify()">
          {{ verifying() ? 'Verifying…' : 'Verify' }}
        </button>
      </div>
    </section>

    <section class="card">
      <h2>Export JSONL</h2>
      <p class="dim">
        One JSON object per line, in chronological order. Pipe to your
        SIEM or hand to your auditor — every row carries
        <span class="mono">chainPosition</span>,
        <span class="mono">prevHash</span>,
        <span class="mono">entryHash</span> so an external script can
        re-walk the chain end-to-end.
      </p>
      <div class="actions">
        <button class="btn primary" type="button" [disabled]="exporting()" (click)="exportJsonl()">
          {{ exporting() ? 'Preparing…' : 'Download JSONL' }}
        </button>
      </div>
      @if (exportError(); as err) {
        <div class="error">Export failed: {{ err }}</div>
      }
    </section>
  `,
  styles: [`
    .card {
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 20px;
      margin: 16px 0;
    }
    h2 { margin: 0 0 8px 0; font-size: 14px; color: var(--fg-muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .status { display: flex; align-items: center; gap: 12px; font-size: 14px; }
    .actions { margin-top: 12px; }
    .dim { color: var(--fg-muted); }
    .mono { font-family: var(--mono); }
  `],
  imports: [SlicePipe],
})
export class AuditComponent {
  private readonly catalog = inject(CatalogClientService);

  readonly verifyResult = signal<AuditVerifyResult | null>(null);
  readonly verifying = signal(false);
  readonly verifyError = signal<string | null>(null);

  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);

  constructor() {
    this.verify();
    // Re-walk the chain on every tick so operators see new
    // chain-position numbers as catalog mutations land elsewhere.
    autoStream(() => this.verify(true));
    autoRefresh(() => this.verify(true));
  }

  verify(silent = false): void {
    if (!silent) this.verifying.set(true);
    this.verifyError.set(null);
    this.catalog.verifyAuditChain().subscribe({
      next: (r) => { this.verifyResult.set(r); this.verifying.set(false); },
      error: (err) => {
        this.verifyError.set(err?.error?.detail ?? err?.message ?? 'unknown error');
        this.verifying.set(false);
      },
    });
  }

  exportJsonl(): void {
    this.exporting.set(true);
    this.exportError.set(null);
    this.catalog.exportAudit({ limit: 100_000 }).subscribe({
      next: (jsonl) => {
        this.triggerDownload(jsonl);
        this.exporting.set(false);
      },
      error: (err) => {
        this.exportError.set(err?.error?.detail ?? err?.message ?? 'unknown error');
        this.exporting.set(false);
      },
    });
  }

  private triggerDownload(content: string): void {
    const blob = new Blob([content], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
