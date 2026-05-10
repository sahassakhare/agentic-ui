import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { ActivityComponent } from './activity.component';
import {
  CatalogStreamService,
  type CatalogMutationEvent,
} from '../services/catalog-stream.service';
import {
  CatalogClientService,
  type AuditRecentEntry,
} from '../services/catalog-client.service';
import { AuthService } from '../services/auth.service';

class StubStreamService {
  private listeners: ((e: CatalogMutationEvent) => void)[] = [];
  state = vi.fn(() => 'live' as const);
  isLive = vi.fn(() => true);

  onMutation(handler: (e: CatalogMutationEvent) => void): () => void {
    this.listeners.push(handler);
    return () => {
      this.listeners = this.listeners.filter((h) => h !== handler);
    };
  }

  fire(event: CatalogMutationEvent): void {
    for (const h of this.listeners) h(event);
  }
}

function makeEvent(overrides: Partial<CatalogMutationEvent> = {}): CatalogMutationEvent {
  return {
    tenantId: 'demo',
    entityType: 'capability',
    operation: 'create',
    entityId: 'cap-1',
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAuditRow(overrides: Partial<AuditRecentEntry> = {}): AuditRecentEntry {
  return {
    tenantId: 'demo',
    entityType: 'capability',
    operation: 'create',
    entityId: 'audit-1',
    occurredAt: new Date().toISOString(),
    actor: 'system',
    requestId: null,
    chainPosition: 1,
    ...overrides,
  };
}

describe('ActivityComponent', () => {
  let stream: StubStreamService;
  let recentAudit: ReturnType<typeof vi.fn>;
  let principal: ReturnType<typeof signal<{ tenantId: string } | null>>;

  beforeEach(() => {
    stream = new StubStreamService();
    recentAudit = vi.fn(() => of({ items: [] as readonly AuditRecentEntry[] }));
    principal = signal<{ tenantId: string } | null>({ tenantId: 'demo' });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: CatalogStreamService, useValue: stream },
        { provide: CatalogClientService, useValue: { recentAudit } },
        { provide: AuthService, useValue: { principal } },
      ],
    });
  });

  it('starts with an empty buffer', () => {
    const fixture = TestBed.createComponent(ActivityComponent);
    expect(fixture.componentInstance.buffer().length).toBe(0);
    expect(fixture.componentInstance.visible().length).toBe(0);
  });

  it('appends events at the head as they arrive', () => {
    const fixture = TestBed.createComponent(ActivityComponent);
    const cmp = fixture.componentInstance;
    stream.fire(makeEvent({ entityId: 'cap-1', operation: 'create' }));
    stream.fire(makeEvent({ entityId: 'cap-2', operation: 'update' }));
    stream.fire(makeEvent({ entityId: 'cap-3', operation: 'delete' }));
    const buf = cmp.buffer();
    expect(buf.length).toBe(3);
    expect(buf[0]?.event.entityId).toBe('cap-3');
    expect(buf[2]?.event.entityId).toBe('cap-1');
  });

  it('caps the buffer at MAX_EVENTS (200) — older events fall off', () => {
    const fixture = TestBed.createComponent(ActivityComponent);
    const cmp = fixture.componentInstance;
    for (let i = 0; i < 250; i++) {
      stream.fire(makeEvent({ entityId: `cap-${i}` }));
    }
    expect(cmp.buffer().length).toBe(200);
    expect(cmp.buffer()[0]?.event.entityId).toBe('cap-249');
    expect(cmp.buffer()[199]?.event.entityId).toBe('cap-50');
  });

  it('filter by entity type', () => {
    const fixture = TestBed.createComponent(ActivityComponent);
    const cmp = fixture.componentInstance;
    stream.fire(makeEvent({ entityType: 'capability', entityId: 'cap-1' }));
    stream.fire(makeEvent({ entityType: 'tenant', entityId: 't-1' }));
    stream.fire(makeEvent({ entityType: 'mfe', entityId: 'm-1' }));
    cmp.entityFilter.set('tenant');
    expect(cmp.visible().length).toBe(1);
    expect(cmp.visible()[0]?.event.entityId).toBe('t-1');
  });

  it('filter by operation', () => {
    const fixture = TestBed.createComponent(ActivityComponent);
    const cmp = fixture.componentInstance;
    stream.fire(makeEvent({ operation: 'create', entityId: 'a' }));
    stream.fire(makeEvent({ operation: 'update', entityId: 'b' }));
    stream.fire(makeEvent({ operation: 'delete', entityId: 'c' }));
    cmp.operationFilter.set('delete');
    expect(cmp.visible().length).toBe(1);
    expect(cmp.visible()[0]?.event.entityId).toBe('c');
  });

  it('combined filters AND together', () => {
    const fixture = TestBed.createComponent(ActivityComponent);
    const cmp = fixture.componentInstance;
    stream.fire(makeEvent({ entityType: 'capability', operation: 'create', entityId: 'a' }));
    stream.fire(makeEvent({ entityType: 'capability', operation: 'delete', entityId: 'b' }));
    stream.fire(makeEvent({ entityType: 'tenant', operation: 'create', entityId: 't' }));
    cmp.entityFilter.set('capability');
    cmp.operationFilter.set('create');
    expect(cmp.visible().length).toBe(1);
    expect(cmp.visible()[0]?.event.entityId).toBe('a');
  });

  it('sortDir reverses visible order without mutating the buffer', () => {
    const fixture = TestBed.createComponent(ActivityComponent);
    const cmp = fixture.componentInstance;
    stream.fire(makeEvent({ entityId: 'first',  occurredAt: '2026-05-01T10:00:00.000Z' }));
    stream.fire(makeEvent({ entityId: 'second', occurredAt: '2026-05-02T10:00:00.000Z' }));
    expect(cmp.visible()[0]?.event.entityId).toBe('second');
    cmp.sortDir.set('asc');
    expect(cmp.visible()[0]?.event.entityId).toBe('first');
    expect(cmp.buffer()[0]?.event.entityId).toBe('second');   // buffer unchanged
  });

  it('clear() resets the buffer', () => {
    const fixture = TestBed.createComponent(ActivityComponent);
    const cmp = fixture.componentInstance;
    stream.fire(makeEvent({ entityId: 'a' }));
    stream.fire(makeEvent({ entityId: 'b' }));
    expect(cmp.buffer().length).toBe(2);
    cmp.clear();
    expect(cmp.buffer().length).toBe(0);
  });

  it('describeEntry pulls name+kind from audit diff after-object', async () => {
    const backlog: readonly AuditRecentEntry[] = [
      makeAuditRow({
        entityId: 'cap-7',
        summary: { after: { name: 'place-hold-custodians', kind: 'component' } },
      }),
    ];
    recentAudit.mockReturnValueOnce(of({ items: backlog }));
    const fixture = TestBed.createComponent(ActivityComponent);
    fixture.detectChanges();
    await Promise.resolve();
    const entry = fixture.componentInstance.buffer()[0]!;
    expect(fixture.componentInstance.describeEntry(entry))
      .toBe('place-hold-custodians (component)');
  });

  it('describeEntry falls back to entityId when no diff is present', () => {
    const fixture = TestBed.createComponent(ActivityComponent);
    const cmp = fixture.componentInstance;
    stream.fire(makeEvent({ entityId: 'no-diff-uuid' }));
    expect(cmp.describeEntry(cmp.buffer()[0]!)).toBe('no-diff-uuid');
  });

  it('changedFields surfaces only differing keys for update ops', async () => {
    const backlog: readonly AuditRecentEntry[] = [
      makeAuditRow({
        operation: 'update',
        summary: {
          before: { name: 'old-name', lifecycle: 'draft', owner: 'alice' },
          after:  { name: 'new-name', lifecycle: 'draft', owner: 'bob' },
        },
      }),
    ];
    recentAudit.mockReturnValueOnce(of({ items: backlog }));
    const fixture = TestBed.createComponent(ActivityComponent);
    fixture.detectChanges();
    await Promise.resolve();
    const fields = fixture.componentInstance.changedFields(fixture.componentInstance.buffer()[0]!);
    const names = fields.map((f) => f.field).sort();
    expect(names).toEqual(['name', 'owner']);    // lifecycle unchanged → omitted
  });

  it('changedFields surfaces salient fields for non-update ops', async () => {
    const backlog: readonly AuditRecentEntry[] = [
      makeAuditRow({
        operation: 'create',
        summary: {
          after: {
            name: 'place-hold-dates', kind: 'component',
            lifecycle: 'published', owner: null,
            id: 'uuid-skip', tenantId: 'demo-skip',
          },
        },
      }),
    ];
    recentAudit.mockReturnValueOnce(of({ items: backlog }));
    const fixture = TestBed.createComponent(ActivityComponent);
    fixture.detectChanges();
    await Promise.resolve();
    const fields = fixture.componentInstance.changedFields(fixture.componentInstance.buffer()[0]!);
    const names = fields.map((f) => f.field);
    expect(names).toContain('name');
    expect(names).toContain('kind');
    expect(names).toContain('lifecycle');
    expect(names).not.toContain('id');           // hidden
    expect(names).not.toContain('tenantId');     // hidden
  });

  it('relativeTime returns a human-readable delta', () => {
    const fixture = TestBed.createComponent(ActivityComponent);
    const cmp = fixture.componentInstance;
    const now = new Date();
    expect(cmp.relativeTime(new Date(now.getTime() - 30_000).toISOString())).toMatch(/s ago$/);
    expect(cmp.relativeTime(new Date(now.getTime() - 5 * 60_000).toISOString())).toMatch(/m ago$/);
    expect(cmp.relativeTime(new Date(now.getTime() - 3 * 3600_000).toISOString())).toMatch(/h ago$/);
  });

  it('entityLabel maps internal codes to human strings', () => {
    const fixture = TestBed.createComponent(ActivityComponent);
    const cmp = fixture.componentInstance;
    expect(cmp.entityLabel('mfe')).toBe('MFE remote');
    expect(cmp.entityLabel('role_mapping')).toBe('role mapping');
    expect(cmp.entityLabel('something-new')).toBe('something-new'); // passthrough
  });

  it('grouped() buckets entries by ISO date', async () => {
    const backlog: readonly AuditRecentEntry[] = [
      makeAuditRow({ entityId: 'a', occurredAt: '2026-05-09T10:00:00.000Z' }),
      makeAuditRow({ entityId: 'b', occurredAt: '2026-05-09T11:00:00.000Z' }),
      makeAuditRow({ entityId: 'c', occurredAt: '2026-05-08T11:00:00.000Z' }),
    ];
    recentAudit.mockReturnValueOnce(of({ items: backlog }));
    const fixture = TestBed.createComponent(ActivityComponent);
    fixture.detectChanges();
    await Promise.resolve();
    const buckets = fixture.componentInstance.grouped();
    expect(buckets.length).toBe(2);
    expect(buckets[0]!.dateKey).toBe('2026-05-09');
    expect(buckets[0]!.entries.length).toBe(2);
    expect(buckets[1]!.dateKey).toBe('2026-05-08');
  });

  it('backfills the buffer from /audit/recent on init', async () => {
    const backlog: readonly AuditRecentEntry[] = [
      makeAuditRow({ entityId: 'historical-1', occurredAt: '2026-05-09T10:00:00.000Z' }),
      makeAuditRow({ entityId: 'demo', operation: 'update', occurredAt: '2026-05-09T11:00:00.000Z' }),
    ];
    recentAudit.mockReturnValueOnce(of({ items: backlog }));
    const fixture = TestBed.createComponent(ActivityComponent);
    fixture.detectChanges();
    await Promise.resolve();
    expect(recentAudit).toHaveBeenCalledWith(200);
    expect(fixture.componentInstance.buffer().length).toBe(2);
  });

  it('audit-row entries carry actor + chainPosition through to the FeedEntry', async () => {
    const backlog: readonly AuditRecentEntry[] = [
      makeAuditRow({ actor: 'alice@example.com', requestId: 'req-1', chainPosition: 42 }),
    ];
    recentAudit.mockReturnValueOnce(of({ items: backlog }));
    const fixture = TestBed.createComponent(ActivityComponent);
    fixture.detectChanges();
    await Promise.resolve();
    const entry = fixture.componentInstance.buffer()[0]!;
    expect(entry.actor).toBe('alice@example.com');
    expect(entry.requestId).toBe('req-1');
    expect(entry.chainPosition).toBe(42);
  });

  it('soft-fails when /audit/recent is unavailable but live events still flow', async () => {
    recentAudit.mockReturnValueOnce(throwError(() => ({ status: 404, message: 'Not Found' })));
    const fixture = TestBed.createComponent(ActivityComponent);
    fixture.detectChanges();
    await Promise.resolve();
    expect(fixture.componentInstance.backlogError()).toMatch(/older than/);
    stream.fire(makeEvent({ entityId: 'live-1' }));
    expect(fixture.componentInstance.buffer().length).toBe(1);
  });

  it('dedups when a live SSE event arrives for a row already in the backlog', async () => {
    const occurredAt = '2026-05-09T10:00:00.000Z';
    const backlog: readonly AuditRecentEntry[] = [
      makeAuditRow({ entityId: 'cap-x', occurredAt }),
    ];
    recentAudit.mockReturnValueOnce(of({ items: backlog }));
    const fixture = TestBed.createComponent(ActivityComponent);
    fixture.detectChanges();
    await Promise.resolve();
    expect(fixture.componentInstance.buffer().length).toBe(1);
    stream.fire(makeEvent({ entityId: 'cap-x', operation: 'create', occurredAt }));
    expect(fixture.componentInstance.buffer().length).toBe(1);
  });

  it('reload() clears the buffer and re-fetches the backlog', async () => {
    recentAudit.mockReturnValue(of({ items: [makeAuditRow({ entityId: 'fresh' })] }));
    const fixture = TestBed.createComponent(ActivityComponent);
    fixture.detectChanges();
    await Promise.resolve();
    expect(fixture.componentInstance.buffer().length).toBe(1);
    fixture.componentInstance.reload();
    await Promise.resolve();
    expect(recentAudit).toHaveBeenCalledTimes(2);
  });
});
