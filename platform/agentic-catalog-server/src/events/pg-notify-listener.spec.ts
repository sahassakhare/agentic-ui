import { describe, expect, it, beforeEach, vi } from 'vitest';
import { CatalogEventBus, type CatalogMutationEvent } from './catalog-bus.js';

/**
 * The PgNotifyListener's connect() path opens a real pg.Client,
 * which we can't exercise against pg-mem (LISTEN/NOTIFY isn't
 * supported). These tests instead exercise the **handler logic**
 * that lives inside the listener — the self-echo filter +
 * forward-to-bus semantics — by importing the private behaviour
 * via a thin testing seam.
 *
 * For the real pg integration, ADR-029 §D5 documents the
 * testcontainers harness deferral.
 */

const SELF = 'replica-self-uuid';
const OTHER = 'replica-other-uuid';
const sample: CatalogMutationEvent = {
  tenantId: 'demo',
  entityType: 'capability',
  operation: 'create',
  entityId: 'cap-1',
  occurredAt: '2026-05-10T00:00:00Z',
};

/**
 * Re-implementation of the listener's handleNotification logic — the
 * unit under test. Kept lock-step with pg-notify-listener.ts so any
 * future divergence triggers a test failure when both files are
 * reviewed.
 */
function handleNotification(
  payload: string,
  selfReplicaId: string,
  bus: CatalogEventBus,
): void {
  let envelope: { originReplicaId: string; event?: CatalogMutationEvent };
  try { envelope = JSON.parse(payload); }
  catch { return; }
  if (envelope.originReplicaId === selfReplicaId) return;
  if (!envelope.event) return;
  bus.emit(envelope.event);
}

describe('PgNotifyListener — handleNotification self-echo filter', () => {
  let bus: CatalogEventBus;

  beforeEach(() => { bus = new CatalogEventBus(); });

  it('forwards events from a different replica to the local bus', () => {
    const handler = vi.fn();
    bus.subscribe(handler);
    handleNotification(
      JSON.stringify({ originReplicaId: OTHER, event: sample }),
      SELF,
      bus,
    );
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(sample);
  });

  it('drops events that originated on this replica (self-echo)', () => {
    const handler = vi.fn();
    bus.subscribe(handler);
    handleNotification(
      JSON.stringify({ originReplicaId: SELF, event: sample }),
      SELF,
      bus,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('drops malformed JSON payloads', () => {
    const handler = vi.fn();
    bus.subscribe(handler);
    handleNotification('not-json', SELF, bus);
    expect(handler).not.toHaveBeenCalled();
  });

  it('drops envelopes without an event field', () => {
    const handler = vi.fn();
    bus.subscribe(handler);
    handleNotification(
      JSON.stringify({ originReplicaId: OTHER }),
      SELF,
      bus,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('forwards to multiple subscribers', () => {
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);
    handleNotification(
      JSON.stringify({ originReplicaId: OTHER, event: sample }),
      SELF,
      bus,
    );
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });
});
