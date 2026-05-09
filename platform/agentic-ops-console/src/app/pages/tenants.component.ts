import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { CatalogClientService, type Tenant } from '../services/catalog-client.service';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'ops-tenants',
  imports: [DatePipe],
  template: `
    @if (!isAdmin()) {
      <div class="error">
        Tenant lifecycle endpoints require the <code>platform-admin</code> role.
        Your token does not carry it.
      </div>
    } @else {
      <h1>Tenants</h1>
      <p class="dim">
        Platform-level tenant directory. Lifecycle transitions (suspend,
        activate, delete) emit audit rows scoped to the affected tenant.
        Quotas are recorded but not enforced — hosts apply them at the
        runtime / gateway boundary. See ADR-020.
      </p>

      @if (error(); as err) { <div class="error">Failed to load: {{ err }}</div> }
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
              </tr>
            }
          </tbody>
        </table>
        <p class="dim">{{ items().length }} tenants</p>
      }
    }
  `,
  styles: [`
    .small { font-size: 11px; color: var(--fg-muted); }
    code { font-family: var(--mono); background: var(--bg-elev-2); padding: 1px 4px; border-radius: 4px; }
  `],
})
export class TenantsComponent {
  private readonly catalog = inject(CatalogClientService);
  private readonly auth = inject(AuthService);

  readonly isAdmin = this.auth.isPlatformAdmin;
  readonly items = signal<readonly Tenant[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    if (!this.isAdmin()) {
      this.loading.set(false);
      return;
    }
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
}
