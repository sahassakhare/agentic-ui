import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { CatalogClientService, type Capability } from '../services/catalog-client.service';

@Component({
  selector: 'ops-capabilities',
  imports: [DatePipe],
  template: `
    <h1>Capabilities</h1>
    @if (error(); as err) {
      <div class="error">Failed to load: {{ err }}</div>
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
          </tr>
        </thead>
        <tbody>
          @for (cap of items(); track cap.id) {
            <tr>
              <td class="mono">{{ cap.name }}</td>
              <td>{{ cap.kind }}</td>
              <td>
                <span class="badge" [class.good]="cap.lifecycle === 'published'" [class.warn]="cap.lifecycle === 'deprecated'" [class.bad]="cap.lifecycle === 'disabled'">
                  {{ cap.lifecycle }}
                </span>
              </td>
              <td>{{ cap.owner ?? '—' }}</td>
              <td>{{ cap.tags.join(', ') || '—' }}</td>
              <td class="dim">{{ cap.updatedAt | date: 'short' }}</td>
            </tr>
          }
        </tbody>
      </table>
      <p class="dim">Showing {{ items().length }} of {{ total() }}</p>
    }
  `,
})
export class CapabilitiesComponent {
  private readonly catalog = inject(CatalogClientService);

  readonly items = signal<readonly Capability[]>([]);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
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
}
