import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ActivityComponent } from './activity.component';
import {
  CatalogStreamService,
  type CatalogMutationEvent,
} from '../services/catalog-stream.service';

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

  beforeEach(() => {
    stream = new StubStreamService();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: CatalogStreamService, useValue: stream },
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
    stream.fire(makeEvent());
    stream.fire(makeEvent());
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
});
