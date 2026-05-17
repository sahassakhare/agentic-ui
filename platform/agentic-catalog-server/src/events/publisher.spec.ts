import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  publishCatalogEvent,
  setCatalogEventPublisher,
  resetCatalogEventPublisher,
} from './publisher.js';
import { catalogBus, type CatalogMutationEvent } from './catalog-bus.js';

const sample: CatalogMutationEvent = {
  tenantId: 'demo',
  entityType: 'capability',
  operation: 'create',
  entityId: 'cap-1',
  occurredAt: '2026-05-10T00:00:00Z',
};

describe('publisher indirection', () => {
  beforeEach(() => resetCatalogEventPublisher());
  afterEach(() => resetCatalogEventPublisher());

  it('default publisher emits to the in-process bus', () => {
    const handler = vi.fn();
    const off = catalogBus.subscribe(handler);
    publishCatalogEvent(sample);
    off();
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(sample);
  });

  it('setCatalogEventPublisher overrides the default — bus does NOT auto-emit', () => {
    const busHandler = vi.fn();
    const off = catalogBus.subscribe(busHandler);
    const custom = vi.fn();
    setCatalogEventPublisher({ publish: custom });
    publishCatalogEvent(sample);
    off();
    expect(custom).toHaveBeenCalledOnce();
    // Custom publisher chose not to emit to bus → bus subscriber idle.
    expect(busHandler).not.toHaveBeenCalled();
  });

  it('resetCatalogEventPublisher restores default in-process behaviour', () => {
    setCatalogEventPublisher({ publish: vi.fn() });
    resetCatalogEventPublisher();
    const handler = vi.fn();
    const off = catalogBus.subscribe(handler);
    publishCatalogEvent(sample);
    off();
    expect(handler).toHaveBeenCalledOnce();
  });
});
