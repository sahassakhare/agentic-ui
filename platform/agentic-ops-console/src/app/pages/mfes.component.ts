import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { CatalogClientService, type MfeRemote } from '../services/catalog-client.service';

@Component({
  selector: 'ops-mfes',
  imports: [DatePipe],
  template: `
    <h1>MFE remotes</h1>
    @if (error(); as err) { <div class="error">Failed to load: {{ err }}</div> }
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
              <td class="mono">{{ exposesSummary(mfe) }}</td>
              <td class="dim">{{ mfe.lastHealthAt ? (mfe.lastHealthAt | date: 'short') : '—' }}</td>
            </tr>
          }
        </tbody>
      </table>
    }
  `,
})
export class MfesComponent {
  private readonly catalog = inject(CatalogClientService);

  readonly items = signal<readonly MfeRemote[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
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
}
