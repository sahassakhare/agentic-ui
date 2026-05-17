import { InjectionToken } from '@angular/core';

/**
 * ADR-046 D7 — schema versioning for persisted layout / dashboard
 * entries. Persistence reads run the migration chain (`from → from+1
 * → … → CURRENT_LAYOUT_SCHEMA_VERSION`) until the entry's
 * `schemaVersion` matches the lib's current shape.
 *
 * Forward-only by design: rolling back to an older shape requires
 * replaying from the audit chain (ADR-046 D4), not in-place
 * downgrade — that keeps every saved entry monotonically progressing
 * toward the current shape.
 */
export const CURRENT_LAYOUT_SCHEMA_VERSION = 1;

/**
 * One step in the migration chain. Lib registers built-in migrators
 * for every shipped version bump; adopters register custom migrators
 * for their own schema additions via `LAYOUT_MIGRATOR`.
 *
 * Migrators are pure functions — they receive the previous-version
 * entry and return the next-version entry. No I/O, no DI.
 */
export interface LayoutMigrator<TIn = unknown, TOut = unknown> {
  /** Source schema version (the migrator runs when input.schemaVersion === from). */
  readonly from: number;
  /** Target schema version after this migrator runs. */
  readonly to: number;
  /** Stable id for telemetry / debug. */
  readonly id: string;
  /** Migrate one entry from version `from` to version `to`. */
  migrate(entry: TIn): TOut;
}

/**
 * Versionable entry — minimum shape a persisted layout/dashboard def
 * must satisfy for the migrator chain to operate on it. Lib-shipped
 * defs (LayoutDef, DashboardDef) gain this transparently when their
 * `schemaVersion` field is set.
 */
export interface VersionedEntry {
  readonly schemaVersion: number;
  readonly [key: string]: unknown;
}

/**
 * Multi-provider token for adopter-supplied migrators. Each migrator
 * is registered with `multi: true`; the registry assembles the chain.
 */
export const LAYOUT_MIGRATOR = new InjectionToken<readonly LayoutMigrator[]>(
  'LAYOUT_MIGRATOR',
  { factory: () => [] },
);
