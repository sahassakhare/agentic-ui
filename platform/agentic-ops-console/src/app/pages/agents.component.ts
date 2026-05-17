import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import {
  CatalogClientService,
  type Agent,
} from '../services/catalog-client.service';
import { autoStream } from '../services/catalog-stream.service';
import { autoRefresh } from '../services/auto-refresh.service';

/**
 * Agents page — slice AGT / ADR-039.
 *
 * Shows the per-tenant `agents` registry — runtime-level
 * AgenticBackend deployments. Distinct from MFE remotes; auto-
 * registered on agent-server boot via the
 * `@infra-tools/agentic-ui-server-registrar` package, with periodic
 * heartbeats so operators see "is it alive."
 *
 * Read-only in slice 1 — agents register themselves; ops console
 * just visualizes. Edit/delete buttons surface but call PATCH /
 * DELETE on the catalog (e.g. to flip status manually or retire a
 * stale row).
 */
@Component({
  selector: 'ops-agents',
  imports: [DatePipe],
  template: `
    <div class="header">
      <h1>Agents</h1>
      <p class="dim">
        Runtime-level AgenticBackend deployments. Agents register themselves
        via <code>&#64;maverick/agentic-ui-server-registrar</code> at boot.
      </p>
    </div>

    @if (error(); as err) { <div class="error">Failed: {{ err }}</div> }
    @if (loading()) {
      <p class="dim">Loading…</p>
    } @else if (agents().length === 0) {
      <div class="empty">
        No agents registered for this tenant yet. Wire <code>registerAgentWithCatalog(...)</code>
        into your agent server's bootstrap to get started — see ADR-039.
      </div>
    } @else {
      <div class="summary">
        <span class="chip">{{ activeCount() }} active</span>
        @if (degradedCount() > 0) { <span class="chip warn">{{ degradedCount() }} degraded</span> }
        @if (inactiveCount() > 0) { <span class="chip bad">{{ inactiveCount() }} inactive</span> }
        <span class="chip dim">{{ agents().length }} total</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th>Status</th>
            <th>Manifest URL</th>
            <th>Version</th>
            <th>Capabilities</th>
            <th>Last health</th>
            <th>Registered</th>
            <th class="actions-col">Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (agent of agents(); track agent.id) {
            <tr [class.stale]="isStale(agent)">
              <td class="mono">{{ agent.name }}</td>
              <td>{{ agent.kind }}</td>
              <td>
                <span class="status-pill status-{{ agent.status }}">{{ agent.status }}</span>
              </td>
              <td class="mono small">{{ agent.manifestUrl }}</td>
              <td>{{ agent.version ?? '—' }}</td>
              <td>
                @if (agent.capabilities.length === 0) {
                  <span class="dim">none advertised</span>
                } @else {
                  <details>
                    <summary>{{ agent.capabilities.length }} tool(s)</summary>
                    <ul class="cap-list">
                      @for (c of agent.capabilities; track c) {
                        <li class="mono small">{{ c }}</li>
                      }
                    </ul>
                  </details>
                }
              </td>
              <td class="dim small">
                {{ agent.lastHealthAt ? (agent.lastHealthAt | date: 'short') : '—' }}
              </td>
              <td class="dim small">{{ agent.registeredAt | date: 'short' }}</td>
              <td class="actions">
                <button class="btn small bad" type="button" (click)="askDelete(agent)">Retire</button>
              </td>
            </tr>
          }
        </tbody>
      </table>
    }
  `,
  styles: [`
    .header h1 { margin: 0 0 4px 0; }
    .header p { margin: 0 0 12px 0; }
    .header code {
      background: var(--bg-elev-2); padding: 1px 6px;
      border-radius: 3px; font-size: 0.85em;
    }
    .summary { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    .chip { background: var(--bg-elev-2); padding: 2px 8px; border-radius: 999px; font-size: 0.8125rem; }
    .chip.dim { color: var(--fg-muted); }
    .chip.warn { background: #713f12; color: #fcd34d; }
    .chip.bad { background: #7f1d1d; color: #fca5a5; }

    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border); }
    th { background: var(--bg-elev); color: var(--fg-muted); font-weight: 500; font-size: 0.875rem; }
    .actions-col { width: 120px; }
    .actions { white-space: nowrap; }
    .small { font-size: 0.8125rem; }
    .mono { font-family: var(--mono); }
    .dim { color: var(--fg-muted); }

    tr.stale { opacity: 0.6; }

    .status-pill {
      display: inline-block; padding: 2px 8px; border-radius: 999px;
      font-size: 0.75rem; text-transform: capitalize;
    }
    .status-pill.status-active { background: #14532d; color: #86efac; }
    .status-pill.status-degraded { background: #713f12; color: #fcd34d; }
    .status-pill.status-inactive { background: #7f1d1d; color: #fca5a5; }

    details summary { cursor: pointer; }
    .cap-list { margin: 4px 0 0 0; padding-left: 20px; max-height: 200px; overflow-y: auto; }
    .cap-list li { margin: 1px 0; }

    .btn { padding: 4px 10px; border-radius: 4px; cursor: pointer; }
    .btn.small { font-size: 0.8125rem; }
    .btn.bad { background: #7f1d1d; color: #fca5a5; border: 1px solid #991b1b; }

    .empty {
      padding: 24px; background: var(--bg-elev); border-radius: 8px;
      color: var(--fg-muted); text-align: center;
    }
    .empty code {
      background: var(--bg-elev-2); padding: 1px 6px;
      border-radius: 3px; font-size: 0.85em;
    }

    .error { background: #7f1d1d; color: #fca5a5; padding: 12px; border-radius: 6px; margin-bottom: 12px; }
  `],
})
export class AgentsComponent {
  private readonly catalog = inject(CatalogClientService);

  protected readonly agents = signal<readonly Agent[]>([]);
  protected readonly loading = signal<boolean>(true);
  protected readonly error = signal<string | null>(null);

  protected readonly activeCount = computed(() =>
    this.agents().filter((a) => a.status === 'active').length,
  );
  protected readonly degradedCount = computed(() =>
    this.agents().filter((a) => a.status === 'degraded').length,
  );
  protected readonly inactiveCount = computed(() =>
    this.agents().filter((a) => a.status === 'inactive').length,
  );

  constructor() {
    void this.refresh();
    autoStream(() => { void this.refresh(); });
    autoRefresh(() => { void this.refresh(); });
  }

  protected async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await firstValueFrom(this.catalog.listAgents());
      this.agents.set(res.items);
    } catch (err) {
      const e = err as { error?: { detail?: string }; message?: string };
      this.error.set(e?.error?.detail ?? e?.message ?? 'unknown error');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * "Stale" highlight — agents whose last heartbeat is more than
   * 90 seconds ago. Server-side sweeper would mark them inactive
   * but UI surfaces it earlier so operators don't react to dead
   * rows.
   */
  protected isStale(agent: Agent): boolean {
    if (!agent.lastHealthAt) return true;
    const last = new Date(agent.lastHealthAt).getTime();
    return Date.now() - last > 90_000;
  }

  protected async askDelete(agent: Agent): Promise<void> {
    if (!confirm(`Retire agent "${agent.name}"?\n\nMarks the row as soft-deleted in the catalog. The running agent server isn't affected — it'll re-register on next deploy.`)) {
      return;
    }
    try {
      await firstValueFrom(this.catalog.deleteAgent(agent.id));
      await this.refresh();
    } catch (err) {
      const e = err as { error?: { detail?: string }; message?: string };
      this.error.set(e?.error?.detail ?? e?.message ?? 'delete failed');
    }
  }
}
