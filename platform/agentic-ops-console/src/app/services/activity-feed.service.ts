import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  CatalogStreamService,
  type CatalogMutationEvent,
} from './catalog-stream.service';
import {
  CatalogClientService,
  type AuditRecentEntry,
} from './catalog-client.service';
import { AuthService } from './auth.service';

const MAX_EVENTS = 200;

export interface FeedEntry {
  readonly id: string;
  readonly receivedAt: number;
  readonly event: CatalogMutationEvent;
  readonly actor: string | null;
  readonly requestId: string | null;
  readonly chainPosition: number | null;
}

/**
 * Root-scoped activity buffer. Survives navigation between pages
 * (component teardown), so an operator can leave the activity page
 * for a minute and come back without an empty feed or a flicker
 * while the backlog re-loads.
 *
 * Lifecycle:
 *   - Subscribes to SSE mutations once at construction; appends each
 *     to the buffer (newest first).
 *   - Fetches /audit/recent backlog the first time a tenant becomes
 *     available, and again whenever the active tenant changes.
 *   - Buffer caps at MAX_EVENTS; older entries fall off.
 *
 * The component reads `buffer()`, `loadingBacklog()`, and
 * `backlogError()` to render. `reload()` clears + re-fetches.
 */
@Injectable({ providedIn: 'root' })
export class ActivityFeedService {
  private readonly stream = inject(CatalogStreamService);
  private readonly catalog = inject(CatalogClientService);
  private readonly auth = inject(AuthService);

  readonly maxEvents = MAX_EVENTS;
  readonly buffer = signal<readonly FeedEntry[]>([]);
  readonly loadingBacklog = signal<boolean>(false);
  readonly backlogError = signal<string | null>(null);
  /** Server time of the most recent backlog fetch — informational. */
  readonly lastSyncedAt = signal<number | null>(null);

  private lastBacklogTenant: string | null = null;

  readonly count = computed(() => this.buffer().length);

  constructor() {
    // SSE — every mutation prepends to the buffer.
    this.stream.onMutation((event) => this.append(event));

    // Backfill from the audit chain whenever the active tenant
    // changes (login, tenant switcher, page reload). The principal
    // signal is what triggers re-evaluation; lastBacklogTenant
    // dedups within a single tenant session.
    effect(() => {
      const principal = this.auth.principal();
      const tenantId = principal?.tenantId ?? null;
      if (!tenantId || tenantId === this.lastBacklogTenant) return;
      this.lastBacklogTenant = tenantId;
      this.loadBacklog();
    });
  }

  /** Force a clear + re-fetch — exposed for the activity page's
   *  reload button. */
  reload(): void {
    this.buffer.set([]);
    this.lastBacklogTenant = null;
    const principal = this.auth.principal();
    if (principal?.tenantId) {
      this.lastBacklogTenant = principal.tenantId;
      this.loadBacklog();
    }
  }

  clear(): void {
    this.buffer.set([]);
  }

  private loadBacklog(): void {
    this.loadingBacklog.set(true);
    this.backlogError.set(null);
    this.catalog.recentAudit(MAX_EVENTS).subscribe({
      next: (resp) => {
        const seen = new Set(this.buffer().map((e) => e.id));
        const seeded: FeedEntry[] = [];
        for (const raw of resp.items) {
          const entry = this.fromAuditRow(raw);
          if (seen.has(entry.id)) continue;
          seen.add(entry.id);
          seeded.push(entry);
        }
        // Live events (already in buffer) keep their position at
        // the top; backlog appends below.
        const merged = [...this.buffer(), ...seeded];
        if (merged.length > MAX_EVENTS) merged.length = MAX_EVENTS;
        this.buffer.set(merged);
        this.loadingBacklog.set(false);
        this.lastSyncedAt.set(Date.now());
      },
      error: (err: { status?: number; message?: string }) => {
        this.loadingBacklog.set(false);
        const msg = err?.status === 404
          ? 'this catalog is older than /audit/recent (deploy needs refresh)'
          : err?.message ?? 'request failed';
        this.backlogError.set(msg);
      },
    });
  }

  private append(event: CatalogMutationEvent): void {
    const entry: FeedEntry = {
      id: makeId(event),
      receivedAt: Date.now(),
      event,
      actor: null,
      requestId: null,
      chainPosition: null,
    };
    if (this.buffer().some((e) => e.id === entry.id)) return;
    const next = [entry, ...this.buffer()];
    if (next.length > MAX_EVENTS) next.length = MAX_EVENTS;
    this.buffer.set(next);
  }

  private fromAuditRow(raw: AuditRecentEntry): FeedEntry {
    const event = raw as unknown as CatalogMutationEvent;
    return {
      id: makeId(event),
      receivedAt: Date.parse(event.occurredAt) || Date.now(),
      event,
      actor: raw.actor ?? null,
      requestId: raw.requestId ?? null,
      chainPosition: raw.chainPosition ?? null,
    };
  }
}

function makeId(event: CatalogMutationEvent): string {
  return `${event.occurredAt}-${event.entityId}-${event.operation}`;
}
