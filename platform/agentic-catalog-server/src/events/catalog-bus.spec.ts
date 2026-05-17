import { describe, expect, it, vi } from 'vitest';
import { CatalogEventBus, type CatalogMutationEvent } from './catalog-bus.js';

describe('CatalogEventBus', () => {
  function makeEvent(overrides: Partial<CatalogMutationEvent> = {}): CatalogMutationEvent {
    return {
      tenantId: 'demo',
      entityType: 'capability',
      operation: 'create',
      entityId: 'cap-1',
      occurredAt: '2026-05-09T00:00:00Z',
      ...overrides,
    };
  }

  it('delivers events to every subscriber', () => {
    const bus = new CatalogEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);
    bus.emit(makeEvent());
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('unsubscribe stops further deliveries', () => {
    const bus = new CatalogEventBus();
    const handler = vi.fn();
    const off = bus.subscribe(handler);
    bus.emit(makeEvent());
    off();
    bus.emit(makeEvent());
    expect(handler).toHaveBeenCalledOnce();
  });

  it('listenerCount tracks active subscribers', () => {
    const bus = new CatalogEventBus();
    expect(bus.listenerCount()).toBe(0);
    const off1 = bus.subscribe(() => {});
    const off2 = bus.subscribe(() => {});
    expect(bus.listenerCount()).toBe(2);
    off1();
    expect(bus.listenerCount()).toBe(1);
    off2();
    expect(bus.listenerCount()).toBe(0);
  });

  it('does not error when emitting with zero subscribers', () => {
    const bus = new CatalogEventBus();
    expect(() => bus.emit(makeEvent())).not.toThrow();
  });

  it('preserves event payload verbatim', () => {
    const bus = new CatalogEventBus();
    let received: CatalogMutationEvent | null = null;
    bus.subscribe((e) => { received = e; });
    const sent = makeEvent({
      tenantId: 'acme',
      entityType: 'tenant',
      operation: 'update',
      summary: { lifecycle: 'published' },
    });
    bus.emit(sent);
    expect(received).toEqual(sent);
  });
});
