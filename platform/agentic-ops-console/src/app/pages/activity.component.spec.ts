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

/**
 * The component subscribes to `CatalogStreamService.onMutation`. We
 * inject a stub stream service that exposes a `fire()` helper for
 * tests to drive events into the component.
 */
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

describe('ActivityComponent', () => {
  let stream: StubStreamService;
  let recentAudit: ReturnType<typeof vi.fn>;
  let principal: ReturnType<typeof signal<{ tenantId: string } | null>>;

  beforeEach(() => {
    stream = new StubStreamService();
    // By default, return an empty backlog so existing tests behave
    // as before (buffer starts empty + only live events fill it).
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
    // Newest first
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
    // Most recent at the head
    expect(cmp.buffer()[0]?.event.entityId).toBe('cap-249');
    // Oldest 50 dropped
    expect(cmp.buffer()[199]?.event.entityId).toBe('cap-50');
  });

  it('filter by entity type', () => {
    const fixture = TestBed.createComponent(ActivityComponent);
    const cmp = fixture.componentInstance;
    stream.fire(makeEvent({ entityType: 'capability', entityId: 'cap-1' }));
    stream.fire(makeEvent({ entityType: 'tenant', entityId: 't-1' }));
    stream.fire(makeEvent({ entityType: 'mfe', entityId: 'm-1' }));
    cmp.entityFilter = 'tenant';
    expect(cmp.visible().length).toBe(1);
    expect(cmp.visible()[0]?.event.entityId).toBe('t-1');
  });

  it('filter by operation', () => {
    const fixture = TestBed.createComponent(ActivityComponent);
    const cmp = fixture.componentInstance;
    stream.fire(makeEvent({ operation: 'create', entityId: 'a' }));
    stream.fire(makeEvent({ operation: 'update', entityId: 'b' }));
    stream.fire(makeEvent({ operation: 'delete', entityId: 'c' }));
    cmp.operationFilter = 'delete';
    expect(cmp.visible().length).toBe(1);
    expect(cmp.visible()[0]?.event.entityId).toBe('c');
  });

  it('combined filters AND together', () => {
    const fixture = TestBed.createComponent(ActivityComponent);
    const cmp = fixture.componentInstance;
    stream.fire(makeEvent({ entityType: 'capability', operation: 'create', entityId: 'a' }));
    stream.fire(makeEvent({ entityType: 'capability', operation: 'delete', entityId: 'b' }));
    stream.fire(makeEvent({ entityType: 'tenant', operation: 'create', entityId: 't' }));
    cmp.entityFilter = 'capability';
    cmp.operationFilter = 'create';
    expect(cmp.visible().length).toBe(1);
    expect(cmp.visible()[0]?.event.entityId).toBe('a');
  });

  it('clear() resets the buffer', () => {
    const fixture = TestBed.createComponent(ActivityComponent);
    const cmp = fixture.componentInstance;
    // Use distinct entityIds — append() now dedups on the composite
    // id (occurredAt + entityId + operation), so two identical
    // events would collapse to one in the buffer.
    stream.fire(makeEvent({ entityId: 'a' }));
    stream.fire(makeEvent({ entityId: 'b' }));
    expect(cmp.buffer().length).toBe(2);
    cmp.clear();
    expect(cmp.buffer().length).toBe(0);
  });

  it('summaryEntries renders only non-null pairs in stable order', () => {
    const fixture = TestBed.createComponent(ActivityComponent);
    const cmp = fixture.componentInstance;
    const out = cmp.summaryEntries({ kind: 'tool', name: 'demo', missing: null });
    expect(out).toEqual([
      { k: 'kind', v: 'tool' },
      { k: 'name', v: 'demo' },
    ]);
  });

  it('dotClass returns the operation as a class name', () => {
    const fixture = TestBed.createComponent(ActivityComponent);
    const cmp = fixture.componentInstance;
    expect(cmp.dotClass(makeEvent({ operation: 'create' }))).toBe('create');
    expect(cmp.dotClass(makeEvent({ operation: 'delete' }))).toBe('delete');
  });

  it('backfills the buffer from /audit/recent on init', async () => {
    const backlog: readonly AuditRecentEntry[] = [
      {
        tenantId: 'demo', entityType: 'capability', operation: 'create',
        entityId: 'historical-1', occurredAt: '2026-05-09T10:00:00.000Z',
      },
      {
        tenantId: 'demo', entityType: 'tenant', operation: 'update',
        entityId: 'demo', occurredAt: '2026-05-09T11:00:00.000Z',
      },
    ];
    recentAudit.mockReturnValueOnce(of({ items: backlog }));
    const fixture = TestBed.createComponent(ActivityComponent);
    fixture.detectChanges();   // trigger constructor effect → backlog fetch
    await Promise.resolve();   // flush of() microtask
    expect(recentAudit).toHaveBeenCalledWith(200);
    expect(fixture.componentInstance.buffer().length).toBe(2);
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
    const backlog: readonly AuditRecentEntry[] = [{
      tenantId: 'demo', entityType: 'capability', operation: 'create',
      entityId: 'cap-x', occurredAt,
    }];
    recentAudit.mockReturnValueOnce(of({ items: backlog }));
    const fixture = TestBed.createComponent(ActivityComponent);
    fixture.detectChanges();
    await Promise.resolve();
    expect(fixture.componentInstance.buffer().length).toBe(1);
    // Same composite id (occurredAt + entityId + operation) — should
    // not be appended a second time.
    stream.fire(makeEvent({ entityId: 'cap-x', operation: 'create', occurredAt }));
    expect(fixture.componentInstance.buffer().length).toBe(1);
  });
});
