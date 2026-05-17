import { inject, Injectable } from '@angular/core';
import {
  CURRENT_LAYOUT_SCHEMA_VERSION,
  LAYOUT_MIGRATOR,
  type LayoutMigrator,
  type VersionedEntry,
} from './types';

/**
 * ADR-046 D7 — runs registered `LayoutMigrator`s to bring an entry
 * from any older schema up to `CURRENT_LAYOUT_SCHEMA_VERSION`.
 *
 * Pure read-side concern: the chain runs on rehydrate, not on write.
 * Writes always produce current-shape entries (storage on next save
 * is at current schema).
 *
 * Lookup is exact `from → to`. The chain steps through one version
 * at a time; if a path `1 → 2 → 3` exists but `1 → 3` doesn't, the
 * chain runs both. If no path exists from the entry's current
 * version to `CURRENT_LAYOUT_SCHEMA_VERSION`, throws a descriptive
 * error — better than silently returning an entry the consumer
 * doesn't understand.
 */
@Injectable({ providedIn: 'root' })
export class LayoutMigratorChain {
  private readonly migrators = inject(LAYOUT_MIGRATOR);

  /** Convenience — true if no migration is needed for this version. */
  isCurrent(version: number): boolean {
    return version === CURRENT_LAYOUT_SCHEMA_VERSION;
  }

  /**
   * Run the chain on a single entry. Returns the entry at the current
   * schema version. If `entry.schemaVersion` is already current, returns
   * it unchanged. If the entry has no `schemaVersion` field (legacy
   * unversioned data), assumes version 0 and walks forward.
   */
  migrate<T extends VersionedEntry>(entry: T): VersionedEntry {
    const startVersion = typeof entry.schemaVersion === 'number' ? entry.schemaVersion : 0;
    if (startVersion === CURRENT_LAYOUT_SCHEMA_VERSION) return entry;
    if (startVersion > CURRENT_LAYOUT_SCHEMA_VERSION) {
      throw new Error(
        `[LayoutMigratorChain] entry schemaVersion ${startVersion} is newer than the lib's ` +
        `CURRENT_LAYOUT_SCHEMA_VERSION (${CURRENT_LAYOUT_SCHEMA_VERSION}). Refusing to ` +
        `downgrade — replay from audit chain instead.`,
      );
    }

    let current: VersionedEntry = entry;
    let currentVersion = startVersion;
    const visitedVersions = new Set<number>([startVersion]);

    while (currentVersion < CURRENT_LAYOUT_SCHEMA_VERSION) {
      const next = this.findMigrator(currentVersion);
      if (!next) {
        throw new Error(
          `[LayoutMigratorChain] no migrator registered from schemaVersion ${currentVersion}. ` +
          `Register one via { provide: LAYOUT_MIGRATOR, useValue: {...}, multi: true }.`,
        );
      }
      current = next.migrate(current) as VersionedEntry;
      currentVersion = next.to;
      if (visitedVersions.has(currentVersion)) {
        throw new Error(
          `[LayoutMigratorChain] migrator loop detected at schemaVersion ${currentVersion}.`,
        );
      }
      visitedVersions.add(currentVersion);
    }

    return current;
  }

  /** Find the migrator whose `from` matches. Highest `to` wins on ties (longest jump). */
  private findMigrator(fromVersion: number): LayoutMigrator | null {
    const candidates = this.migrators.filter((m) => m.from === fromVersion);
    if (candidates.length === 0) return null;
    return candidates.reduce((best, m) => (m.to > best.to ? m : best));
  }
}
