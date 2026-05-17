import { InjectionToken } from '@angular/core';
import type { PersistenceDef } from '../../types/registry-defs';
import type { LayoutInputSource } from '../resolver/types';

/**
 * ADR-046 D2 + D3 — one storage tier corresponding to a precedence
 * layer. The lib defines five canonical tiers (`org-default`,
 * `matter-default`, `persona-default`, `user-saved`, `agent-override`)
 * but the model is generic — adopters can add `team-default`,
 * `region-default`, etc. by providing additional tiers.
 *
 * A tier binds a `LayoutInputSource` (for precedence resolution by
 * `LayoutResolver`) to a `PersistenceDef` (for read/write) plus an
 * authoritative key namespace.
 */
export interface LayoutTier {
  /** Stable id — primary key for the multi-provider registration. */
  readonly id: string;
  /** Precedence layer this tier feeds (`LayoutInputSource`). */
  readonly source: LayoutInputSource;
  /**
   * Persistence-adapter NAME (lookup in `PersistenceRegistry`). The
   * actual adapter (memory / webStorage / IndexedDB / HTTP) is wired
   * via PersistenceRegistry; the tier just names which adapter to
   * use. Lets adopters swap storage backends per tier without
   * touching tier definitions.
   */
  readonly adapterName: string;
  /**
   * Key namespace within the adapter. Composed as `{namespace}:{key}`
   * so multiple tiers can share an adapter without colliding.
   * Example: `'ediscovery.layout.org'` + the saved layout's name.
   */
  readonly namespace: string;
  /**
   * Optional scope discriminator — when supplied, the layered store
   * reads the current value via `scope()` and folds it into the key.
   * Use this for tiers that vary by user / matter / tenant id.
   *
   * Example for the `user-saved` tier:
   *   scope: () => inject(CurrentUserService).id()
   * → effective key: `ediscovery.layout.user:{userId}:{name}`
   */
  readonly scope?: () => string | null;
  /** Write-permission gate — return false to make the tier read-only. */
  readonly canWrite?: () => boolean;
}

/**
 * Multi-provider token. Each `LayoutTier` is registered with
 * `multi: true`; the `LayeredLayoutStore` injects the array.
 */
export const LAYOUT_TIER = new InjectionToken<readonly LayoutTier[]>(
  'LAYOUT_TIER',
  { factory: () => [] },
);

/**
 * Result of `LayeredLayoutStore.read()` — the raw entry plus
 * provenance info telling the caller which tier the entry came from.
 * Useful for the audit chain (D4) and for "show me my user-tier
 * override of the org default" UIs.
 */
export interface LayeredReadResult<T> {
  readonly value: T;
  readonly tier: LayoutTier;
}

/**
 * Convenience pre-built tier definitions for the canonical layers.
 * Adopters import these, override fields as needed, and pass to
 * `provideLayoutTiers`. Built so common wiring is one line; bespoke
 * tiers can be constructed by hand against the `LayoutTier` shape.
 */
export const STANDARD_LAYOUT_TIERS: Readonly<Record<string, LayoutTier>> = {
  orgDefault: {
    id: 'org-default',
    source: 'org-default',
    adapterName: 'org-store',
    namespace: 'agentic-ui.layout.org',
  },
  matterDefault: {
    id: 'matter-default',
    source: 'matter-default',
    adapterName: 'matter-store',
    namespace: 'agentic-ui.layout.matter',
  },
  personaDefault: {
    id: 'persona-default',
    source: 'persona',
    adapterName: 'persona-store',
    namespace: 'agentic-ui.layout.persona',
  },
  userSaved: {
    id: 'user-saved',
    source: 'user-saved',
    adapterName: 'user-store',
    namespace: 'agentic-ui.layout.user',
  },
};

/**
 * A persistence adapter that doesn't exist in the lib until an adopter
 * registers one. Re-exported here for type ergonomics in tier wiring.
 */
export type LayoutPersistenceDef = PersistenceDef;
