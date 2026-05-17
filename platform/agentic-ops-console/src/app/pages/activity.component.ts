import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CatalogStreamService,
  type CatalogMutationEvent,
} from '../services/catalog-stream.service';
import {
  ActivityFeedService,
  type FeedEntry,
} from '../services/activity-feed.service';

type EntityFilter = 'all' | string;
type OperationFilter = 'all' | CatalogMutationEvent['operation'];

// Re-export so tests / callers can import the buffer entry shape
// from this page module if they prefer.
export type { FeedEntry } from '../services/activity-feed.service';

interface DayBucket {
  readonly dateKey: string;
  readonly dateLabel: string;
  readonly entries: readonly FeedEntry[];
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
      Audit-chain backed feed of catalog mutations on this tenant.
      Past entries are loaded from the immutable audit log; live
      mutations land within 100ms via the SSE stream
      ({{ streamState() }}). The buffer holds the most recent
      {{ maxEvents }} events.
    </p>

    <div class="filters">
      <label class="dim small">Entity</label>
      <select [ngModel]="entityFilter()" (ngModelChange)="entityFilter.set($event)" class="filter-select">
        <option value="all">All</option>
        <option value="capability">Capability</option>
        <option value="mfe">MFE remote</option>
        <option value="role_mapping">Role mapping</option>
        <option value="tenant">Tenant</option>
        <option value="agent">Agent</option>
        <option value="policy_bundle">Policy bundle</option>
        <option value="usage">Usage</option>
        <option value="audit">Audit</option>
      </select>

      <label class="dim small">Operation</label>
      <select [ngModel]="operationFilter()" (ngModelChange)="operationFilter.set($event)" class="filter-select">
        <option value="all">All</option>
        <option value="create">Create</option>
        <option value="update">Update</option>
        <option value="delete">Delete</option>
        <option value="restore">Restore</option>
      </select>

      <label class="dim small">Sort</label>
      <select [ngModel]="sortDir()" (ngModelChange)="sortDir.set($event)" class="filter-select">
        <option value="desc">Newest first</option>
        <option value="asc">Oldest first</option>
      </select>

      <button class="btn small" type="button" (click)="reload()">⟳ Reload</button>
      <button class="btn small" type="button" (click)="clear()">Clear</button>
      <span class="dim small spacer">{{ visibleCount() }} / {{ buffer().length }} shown</span>
    </div>

    @if (visibleCount() === 0) {
      <div class="empty">
        @if (buffer().length === 0) {
          @if (loadingBacklog()) {
            Loading recent activity from audit chain...
          } @else if (backlogError()) {
            Backlog unavailable — {{ backlogError() }}. Live SSE events will still appear here as mutations happen.
          } @else {
            No mutations recorded yet for this tenant.
          }
        } @else {
          No events match the current filter.
        }
      </div>
    } @else {
      @for (bucket of grouped(); track bucket.dateKey) {
        <h3 class="day-header">
          <span>{{ bucket.dateLabel }}</span>
          <span class="dim small">{{ bucket.entries.length }} events</span>
        </h3>
        <ul class="feed">
          @for (entry of bucket.entries; track entry.id) {
            <li class="entry" [class.op-create]="entry.event.operation === 'create'"
                              [class.op-update]="entry.event.operation === 'update'"
                              [class.op-delete]="entry.event.operation === 'delete'"
                              [class.op-restore]="entry.event.operation === 'restore'">
              <div class="rail"></div>
              <div class="body">
                <div class="line1">
                  <span class="op-badge">{{ entry.event.operation }}</span>
                  <span class="entity-type">{{ entityLabel(entry.event.entityType) }}</span>
                  <span class="title">{{ describeEntry(entry) }}</span>
                </div>
                <div class="line2">
                  <span class="meta-item" title="Actor">
                    <span class="meta-icon">●</span>
                    {{ entry.actor ?? 'unknown' }}
                  </span>
                  <span class="meta-item mono" title="Entity id">
                    {{ shortId(entry.event.entityId) }}
                  </span>
                  @if (entry.chainPosition != null) {
                    <span class="meta-item mono dim" title="Audit chain position">
                      #{{ entry.chainPosition }}
                    </span>
                  }
                  @if (entry.requestId) {
                    <span class="meta-item mono dim" title="Request id">
                      req {{ shortId(entry.requestId) }}
                    </span>
                  }
                </div>
                @if (changedFields(entry).length > 0) {
                  <div class="line3">
                    @for (f of changedFields(entry); track f.field) {
                      <span class="diff-chip">
                        <span class="diff-field">{{ f.field }}</span>
                        @if (entry.event.operation === 'update') {
                          <span class="diff-before">{{ f.before }}</span>
                          <span class="diff-arrow">→</span>
                          <span class="diff-after">{{ f.after }}</span>
                        } @else {
                          <span class="diff-after">{{ f.after }}</span>
                        }
                      </span>
                    }
                  </div>
                }
              </div>
              <div class="time-block">
                <div class="time-abs">{{ entry.event.occurredAt | date: 'HH:mm:ss' }}</div>
                <div class="time-rel dim small">{{ relativeTime(entry.event.occurredAt) }}</div>
              </div>
            </li>
          }
        </ul>
      }
    }
  `,
  styles: [`
    .header { display: flex; justify-content: space-between; align-items: center; }
    .filters {
      display: flex; align-items: center; gap: 8px;
      padding: 12px; border: 1px solid var(--border); border-radius: 8px;
      margin: 16px 0;
      background: var(--bg-elev);
      flex-wrap: wrap;
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

    .day-header {
      display: flex; justify-content: space-between; align-items: baseline;
      margin: 24px 0 8px 0;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
      font-weight: 600;
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .day-header:first-child { margin-top: 0; }

    .feed { list-style: none; padding: 0; margin: 0; }
    .entry {
      display: grid;
      grid-template-columns: 4px 1fr auto;
      gap: 12px;
      align-items: stretch;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      transition: background 120ms;
    }
    .entry:hover { background: var(--bg-elev); }

    .rail {
      border-radius: 2px;
      background: var(--fg-muted);
    }
    .entry.op-create  .rail { background: var(--good); }
    .entry.op-update  .rail { background: var(--warn); }
    .entry.op-delete  .rail { background: var(--bad); }
    .entry.op-restore .rail { background: var(--accent); }

    .body { min-width: 0; }
    .line1 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .op-badge {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: var(--bg-elev-2);
      color: var(--fg);
    }
    .op-create  .op-badge { background: rgba(63,185,80,0.18);  color: var(--good); }
    .op-update  .op-badge { background: rgba(210,153,34,0.18); color: var(--warn); }
    .op-delete  .op-badge { background: rgba(248,81,73,0.18);  color: var(--bad); }
    .op-restore .op-badge { background: rgba(88,166,255,0.18); color: var(--accent); }

    .entity-type {
      font-size: 12px;
      color: var(--fg-muted);
      text-transform: lowercase;
    }
    .title { font-weight: 500; color: var(--fg); }

    .line2 {
      margin-top: 4px;
      display: flex; flex-wrap: wrap; gap: 12px;
      font-size: 12px;
      color: var(--fg-muted);
    }
    .meta-item { display: inline-flex; align-items: center; gap: 4px; }
    .meta-icon { font-size: 8px; opacity: 0.6; }
    .mono { font-family: var(--mono); font-size: 11.5px; }

    .line3 { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; }
    .diff-chip {
      display: inline-flex; align-items: center; gap: 4px;
      background: var(--bg-elev-2);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 11px;
    }
    .diff-field { color: var(--fg-muted); font-family: var(--mono); }
    .diff-before { color: var(--bad); text-decoration: line-through; opacity: 0.85; max-width: 14ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .diff-arrow { color: var(--fg-muted); }
    .diff-after { color: var(--good); max-width: 22ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .time-block { text-align: right; white-space: nowrap; }
    .time-abs { font-size: 12px; font-family: var(--mono); color: var(--fg); }
    .time-rel { font-size: 11px; }
    .btn.small { padding: 3px 8px; font-size: 11px; }
  `],
})
export class ActivityComponent {
  private readonly stream = inject(CatalogStreamService);
  private readonly feed = inject(ActivityFeedService);

  readonly maxEvents = this.feed.maxEvents;
  readonly buffer = this.feed.buffer;
  readonly loadingBacklog = this.feed.loadingBacklog;
  readonly backlogError = this.feed.backlogError;
  readonly streamLive = this.stream.isLive;
  readonly streamState = this.stream.state;

  /** Filters are signals so the `visible` computed reacts to them
   *  (and the [ngModel] / (ngModelChange) accessor keeps the
   *  template in sync). */
  readonly entityFilter = signal<EntityFilter>('all');
  readonly operationFilter = signal<OperationFilter>('all');
  readonly sortDir = signal<'asc' | 'desc'>('desc');

  readonly visible = computed(() => {
    const ents = this.buffer();
    const e = this.entityFilter();
    const o = this.operationFilter();
    const filtered = (e === 'all' && o === 'all')
      ? ents
      : ents.filter((entry) =>
          (e === 'all' || entry.event.entityType === e) &&
          (o === 'all' || entry.event.operation === o),
        );
    if (this.sortDir() === 'asc') {
      return [...filtered].reverse();
    }
    return filtered;
  });

  readonly visibleCount = computed(() => this.visible().length);

  readonly grouped = computed<readonly DayBucket[]>(() => {
    const buckets = new Map<string, FeedEntry[]>();
    const labels = new Map<string, string>();
    for (const entry of this.visible()) {
      const date = new Date(entry.event.occurredAt);
      if (Number.isNaN(date.getTime())) continue;
      const key = date.toISOString().slice(0, 10); // YYYY-MM-DD
      if (!buckets.has(key)) {
        buckets.set(key, []);
        labels.set(key, formatDayLabel(date));
      }
      buckets.get(key)!.push(entry);
    }
    return Array.from(buckets.entries()).map(([dateKey, entries]) => ({
      dateKey,
      dateLabel: labels.get(dateKey) ?? dateKey,
      entries,
    }));
  });

  reload(): void {
    this.feed.reload();
  }

  clear(): void {
    this.feed.clear();
  }

  /**
   * Human-readable headline for the entry. Pulls `name`/`kind` from
   * the audit row's diff so the operator sees "place-hold-custodians"
   * instead of a UUID. Falls back gracefully when the diff shape is
   * missing or unfamiliar.
   */
  describeEntry(entry: FeedEntry): string {
    const obj = pickEntityObject(entry.event.summary);
    if (obj) {
      const name = stringField(obj, 'name');
      const kind = stringField(obj, 'kind');
      if (name && kind) return `${name} (${kind})`;
      if (name) return name;
    }
    return entry.event.entityId;
  }

  /**
   * Field-level changes shown as diff chips. For `update` ops, list
   * fields whose `before`/`after` differ. For other ops, surface the
   * top scalar fields of the after-object (name, kind, lifecycle,
   * status) so the operator gets context without a click-through.
   */
  changedFields(entry: FeedEntry): { field: string; before: string; after: string }[] {
    const summary = entry.event.summary;
    if (!summary) return [];
    const before = summary['before'] as Record<string, unknown> | undefined;
    const after = summary['after'] as Record<string, unknown> | undefined;

    if (entry.event.operation === 'update' && before && after) {
      const out: { field: string; before: string; after: string }[] = [];
      const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
      for (const k of keys) {
        if (HIDDEN_DIFF_KEYS.has(k)) continue;
        const b = scalarize(before[k]);
        const a = scalarize(after[k]);
        if (b === a) continue;
        out.push({ field: k, before: b, after: a });
        if (out.length >= 5) break;
      }
      return out;
    }

    // Non-update — show salient fields from the surviving object.
    const obj = after ?? before;
    if (!obj) return [];
    const out: { field: string; before: string; after: string }[] = [];
    for (const k of SALIENT_FIELDS) {
      const v = scalarize(obj[k]);
      if (v && v !== '—') out.push({ field: k, before: '', after: v });
      if (out.length >= 4) break;
    }
    return out;
  }

  entityLabel(entityType: string): string {
    return ENTITY_LABELS[entityType] ?? entityType;
  }

  shortId(id: string): string {
    if (id.length <= 12) return id;
    return id.slice(0, 8) + '…';
  }

  relativeTime(iso: string): string {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    const ms = Date.now() - t;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    return `${d}d ago`;
  }
}

const HIDDEN_DIFF_KEYS = new Set([
  'id', 'tenantId', 'createdAt', 'updatedAt', 'createdBy',
  'softDeletedAt', 'registeredAt', 'registeredBy', 'lastHealthAt',
]);

const SALIENT_FIELDS = ['name', 'kind', 'lifecycle', 'status', 'manifestUrl', 'owner'];

const ENTITY_LABELS: Record<string, string> = {
  capability: 'capability',
  mfe: 'MFE remote',
  role_mapping: 'role mapping',
  tenant: 'tenant',
  agent: 'agent',
  policy_bundle: 'policy bundle',
  usage: 'usage',
  audit: 'audit',
};

function pickEntityObject(summary: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!summary) return null;
  const after = summary['after'];
  if (after && typeof after === 'object' && !Array.isArray(after)) {
    return after as Record<string, unknown>;
  }
  const before = summary['before'];
  if (before && typeof before === 'object' && !Array.isArray(before)) {
    return before as Record<string, unknown>;
  }
  return null;
}

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function scalarize(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.length === 0 ? '[]' : `[${v.length}]`;
  if (typeof v === 'object') return '{…}';
  return String(v);
}

function formatDayLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
