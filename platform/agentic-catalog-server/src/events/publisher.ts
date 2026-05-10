import { catalogBus, type CatalogMutationEvent } from './catalog-bus.js';

/**
 * Single hook that route handlers call after every mutation. The
 * default implementation just emits to the in-process bus (correct
 * for single-process dev + tests). At server boot,
 * {@link setCatalogEventPublisher} installs a multi-replica
 * implementation that ALSO calls `pg_notify` so other replicas
 * see the event. See ADR-029.
 *
 * Routes never call `catalogBus.emit` directly — they go through
 * this indirection so tests stay simple and production wires up
 * pg_notify without per-route changes.
 */
export interface CatalogEventPublisher {
  publish(event: CatalogMutationEvent): void;
}

let currentPublisher: CatalogEventPublisher = {
  publish: (event) => catalogBus.emit(event),
};

export function publishCatalogEvent(event: CatalogMutationEvent): void {
  currentPublisher.publish(event);
}

export function setCatalogEventPublisher(publisher: CatalogEventPublisher): void {
  currentPublisher = publisher;
}

/** Reset to the default in-process publisher (used by test setup). */
export function resetCatalogEventPublisher(): void {
  currentPublisher = { publish: (event) => catalogBus.emit(event) };
}
