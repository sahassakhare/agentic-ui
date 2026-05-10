import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CatalogStreamService,
  type CatalogMutationEvent,
} from '../services/catalog-stream.service';
import { CatalogClientService } from '../services/catalog-client.service';
import { AuthService } from '../services/auth.service';

const MAX_EVENTS = 200;

type EntityFilter = 'all' | CatalogMutationEvent['entityType'];
type OperationFilter = 'all' | CatalogMutationEvent['operation'];

interface FeedEntry {
  readonly id: string;
  readonly receivedAt: number;
  readonly event: CatalogMutationEvent;
}

@Component({
  selector: 'ops-activity',
  imports: [DatePipe, FormsModule],
  template: `
    <div class="header">
      <h1>Activity</h1>
      @if (!streamLive()) {
        <span class="badge warn">stream offline</span>
      } @else {
        <span class="badge good pulse">live</span>
      }
    </div>
    <p class="dim">
      Real-time feed of catalog mutations on this tenant. Each
      mutation lands here within 100ms via the SSE stream
      ({{ streamState() }}). The buffer holds the most recent
      {{ maxEvents }} events; older entries fall off the bottom.
    </p>

    <div class="filters">
      <label class="dim small">Entity</label>
      <select [(ngModel)]="entityFilter" class="filter-select">
        <option value="all">All</option>
        <option value="capability">Capability</option>
        <option value="mfe">MFE remote</option>
        <option value="role_mapping">Role mapping</option>
        <option value="tenant">Tenant</option>
        <option value="usage">Usage</option>
        <option value="audit">Audit</option>
      </select>

      <label class="dim small">Operation</label>
      <select [(ngModel)]="operationFilter" class="filter-select">
        <option value="all">All</option>
        <option value="create">Create</option>
        <option value="update">Update</option>
        <option value="delete">Delete</option>
        <option value="restore">Restore</option>
      </select>

      <button class="btn small" type="button" (click)="clear()">Clear</button>
      <span class="dim small spacer">{{ visible().length }} / {{ buffer().length }} shown</span>
    </div>

    @if (visible().length === 0) {
      <div class="empty">
        @if (buffer().length === 0) {
          @if (loadingBacklog()) {
            Loading recent activity from audit chain...
          } @else if (backlogError()) {
            Backlog unavailable — {{ backlogError() }}. Live SSE events will still appear here as mutations happen.
          } @else {
            No mutations recorded yet. Try registering a capability or onboarding a tenant from another browser tab.
          }
        } @else {
          No events match the current filter.
        }
      </div>
    } @else {
      <ul class="feed">
        @for (entry of visible(); track entry.id) {
          <li class="entry">
            <div class="dot" [class]="dotClass(entry.event)"></div>
            <div class="body">
              <div class="line1">
                <span class="badge" [class.good]="entry.event.operation === 'create'" [class.warn]="entry.event.operation === 'update'" [class.bad]="entry.event.operation === 'delete'">
                  {{ entry.event.operation }}
                </span>
                <span class="entity-type">{{ entry.event.entityType }}</span>
                <span class="entity-id mono">{{ entry.event.entityId }}</span>
              </div>
              @if (entry.event.summary && summaryEntries(entry.event.summary).length > 0) {
                <div class="line2 mono small">
                  @for (s of summaryEntries(entry.event.summary); track s.k) {
                    <span class="kv">{{ s.k }}=<span class="kv-v">{{ s.v }}</span></span>
                  }
                </div>
              }
            </div>
            <div class="time dim small">
              {{ entry.event.occurredAt | date: 'HH:mm:ss.SSS' }}
            </div>
          </li>
        }
      </ul>
    }
  `,
  styles: [`
    .header { display: flex; justify-content: space-between; align-items: center; }
    .filters {
      display: flex; align-items: center; gap: 8px;
      padding: 12px; border: 1px solid var(--border); border-radius: 8px;
      margin: 16px 0;
      background: var(--bg-elev);
    }
    .filter-select {
      background: var(--bg);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px 8px;
      font: inherit;
      font-size: 12px;
    }
    .small { font-size: 11px; }
    .spacer { margin-left: auto; }

    .pulse {
      animation: pulse 2.5s infinite;
    }
    @keyframes pulse {
      0%   { box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.5); }
      70%  { box-shadow: 0 0 0 8px rgba(63, 185, 80, 0); }
      100% { box-shadow: 0 0 0 0 rgba(63, 185, 80, 0); }
    }

    .feed { list-style: none; padding: 0; margin: 0; }
    .entry {
      display: grid;
      grid-template-columns: 16px 1fr auto;
      gap: 12px;
      align-items: start;
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
    }
    .dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: var(--fg-muted);
      margin-top: 6px;
    }
    .dot.create { background: var(--good); }
    .dot.update { background: var(--warn); }
    .dot.delete { background: var(--bad); }
    .body { min-width: 0; }
    .line1 { display: flex; align-items: center; gap: 8px; }
    .entity-type { color: var(--fg-muted); }
    .entity-id { color: var(--fg); }
    .line2 {
      margin-top: 4px;
      display: flex; flex-wrap: wrap; gap: 8px;
    }
    .kv { background: var(--bg-elev); border-radius: 4px; padding: 1px 6px; }
    .kv-v { color: var(--fg); }
    .time { white-space: nowrap; }
    .btn.small { padding: 3px 8px; font-size: 11px; }
  `],
})
export class ActivityComponent {
  private readonly stream = inject(CatalogStreamService);
  private readonly catalog = inject(CatalogClientService);
  private readonly auth = inject(AuthService);

  readonly maxEvents = MAX_EVENTS;
  readonly buffer = signal<readonly FeedEntry[]>([]);
  readonly loadingBacklog = signal<boolean>(false);
  readonly backlogError = signal<string | null>(null);
  readonly streamLive = this.stream.isLive;
  readonly streamState = this.stream.state;

  private lastBacklogTenant: string | null = null;

  entityFilter: EntityFilter = 'all';
  operationFilter: OperationFilter = 'all';

  readonly visible = computed(() => {
    const ents = this.buffer();
    const e = this.entityFilter;
    const o = this.operationFilter;
    if (e === 'all' && o === 'all') return ents;
    return ents.filter((entry) =>
      (e === 'all' || entry.event.entityType === e) &&
      (o === 'all' || entry.event.operation === o),
    );
  });

  constructor() {
    // Live stream — every mutation prepends to the buffer.
    this.stream.onMutation((event) => this.append(event));

    // Backfill from the audit chain whenever the active tenant
    // changes. Without this, the page only shows events that
    // happened *while open* — past mutations look invisible.
    effect(() => {
      const principal = this.auth.principal();
      const tenantId = principal?.tenantId ?? null;
      if (!tenantId || tenantId === this.lastBacklogTenant) return;
      this.lastBacklogTenant = tenantId;
      this.loadBacklog();
    });
  }

  private loadBacklog(): void {
    this.loadingBacklog.set(true);
    this.backlogError.set(null);
    this.catalog.recentAudit(MAX_EVENTS).subscribe({
      next: (resp) => {
        // Server returns newest-first already. Seed only entries
        // not already present (in case a live SSE event raced us).
        const seen = new Set(this.buffer().map((e) => e.id));
        const seeded: FeedEntry[] = [];
        for (const raw of resp.items) {
          // /audit/recent returns the audit row's entity_type as a
          // free-form string (it may include rows for entity types
          // older than the SSE union). Coerce to CatalogMutationEvent
          // by widening the type — display code tolerates unknown
          // entity types.
          const event = raw as unknown as CatalogMutationEvent;
          const entry: FeedEntry = {
            id: this.makeId(event),
            receivedAt: Date.parse(event.occurredAt) || Date.now(),
            event,
          };
          if (seen.has(entry.id)) continue;
          seen.add(entry.id);
          seeded.push(entry);
        }
        // Live events sit at the top; backlog appends below.
        const merged = [...this.buffer(), ...seeded];
        if (merged.length > MAX_EVENTS) merged.length = MAX_EVENTS;
        this.buffer.set(merged);
        this.loadingBacklog.set(false);
      },
      error: (err: { status?: number; message?: string }) => {
        this.loadingBacklog.set(false);
        // 404 from older catalogs that don't have /audit/recent yet —
        // surface a soft message; the live feed still works.
        const msg = err?.status === 404
          ? 'this catalog is older than /audit/recent (deploy needs refresh)'
          : err?.message ?? 'request failed';
        this.backlogError.set(msg);
      },
    });
  }

  private append(event: CatalogMutationEvent): void {
    const entry: FeedEntry = {
      id: this.makeId(event),
      receivedAt: Date.now(),
      event,
    };
    // Dedup against backlog rows (same id from /audit/recent).
    if (this.buffer().some((e) => e.id === entry.id)) return;
    const next = [entry, ...this.buffer()];
    if (next.length > MAX_EVENTS) next.length = MAX_EVENTS;
    this.buffer.set(next);
  }

  private makeId(event: CatalogMutationEvent): string {
    // Composite id: occurredAt + entityId + operation should be
    // unique within the buffer window. Avoids extra UUID dep.
    return `${event.occurredAt}-${event.entityId}-${event.operation}`;
  }

  dotClass(event: CatalogMutationEvent): string {
    return event.operation;
  }

  summaryEntries(summary: Readonly<Record<string, unknown>>): { k: string; v: string }[] {
    return Object.entries(summary)
      .filter(([, v]) => v != null)
      .map(([k, v]) => ({ k, v: String(v) }));
  }

  clear(): void {
    this.buffer.set([]);
  }
}
