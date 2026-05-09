import { Component, inject, signal } from '@angular/core';
import { CatalogClientService, type RoleMapping } from '../services/catalog-client.service';
import { autoRefresh } from '../services/auto-refresh.service';
import { autoStream } from '../services/catalog-stream.service';

@Component({
  selector: 'ops-role-mappings',
  template: `
    <h1>Role mappings</h1>
    <p class="dim">
      IdP claim → runtime persona, ordered by priority (highest wins).
      The runtime adapter calls
      <code>POST /role-mappings/resolve</code> on every login.
    </p>
    @if (error(); as err) { <div class="error">Failed to load: {{ err }}</div> }
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
          </tr>
        </thead>
        <tbody>
          @for (m of items(); track m.id) {
            <tr [class.disabled]="!m.enabled">
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
              <td class="dim">{{ m.createdBy }}</td>
            </tr>
          }
        </tbody>
      </table>
    }
  `,
  styles: [`
    code { font-family: var(--mono); background: var(--bg-elev-2); padding: 1px 4px; border-radius: 4px; }
    tr.disabled td { opacity: 0.5; }
    .badge.primary { color: var(--accent); border-color: var(--accent); }
  `],
})
export class RoleMappingsComponent {
  private readonly catalog = inject(CatalogClientService);

  readonly items = signal<readonly RoleMapping[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

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
}
