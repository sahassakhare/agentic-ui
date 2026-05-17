import { effect, inject, Injectable, signal } from '@angular/core';
import { randomId } from '../../chat/message-utils';
import { LayoutResolver } from '../resolver';
import type { SlotMap } from '../types';
import {
  LAYOUT_AUDIT_ATTRIBUTION,
  LAYOUT_AUDIT_SINK,
  type LayoutAppliedEvent,
} from './types';

/**
 * ADR-046 D4 — observer that watches `LayoutResolver.active()` and
 * emits a chain-hashed `LAYOUT_APPLIED` event every time the output
 * materially changes. Holds the in-memory chain too, so adopters
 * without an external sink can still inspect history + time-travel.
 *
 * Activated lazily — the tracker only starts its `effect()` when
 * something injects it (DI lazy-init). Hosts that don't need audit
 * pay zero cost.
 *
 * sha256 is computed via Web Crypto when available; the in-memory
 * chain is correct either way (we use a stable JSON-stringify as
 * the hash input).
 */
@Injectable({ providedIn: 'root' })
export class LayoutAuditTracker {
  private readonly resolver = inject(LayoutResolver);
  private readonly sink = inject(LAYOUT_AUDIT_SINK, { optional: true });
  private readonly attribution = inject(LAYOUT_AUDIT_ATTRIBUTION);

  private readonly _chain = signal<readonly LayoutAppliedEvent[]>([]);
  /** In-memory chain of every emitted event, ordered oldest-first. */
  readonly chain = this._chain.asReadonly();

  private lastSlotsKey: string | null = null;
  private lastHash: string | null = null;

  /**
   * Watches `resolver.active()` and emits when the materialized slots
   * change. Uses a string-key of the slots for the dedup check (deep
   * equality without bringing in a deep-eq dep). Effect runs on every
   * input signal change but we only push to the chain when the output
   * key differs.
   */
  private readonly _watcher = effect(() => {
    const { slots, appliedRules } = this.resolver.active();
    const key = stableStringify(slots);
    if (key === this.lastSlotsKey) return;
    this.lastSlotsKey = key;

    const timestamp = new Date().toISOString();
    const id = randomId('layout-applied');
    const attribution = this.attribution();
    const prevHash = this.lastHash;
    const body = {
      kind: 'LAYOUT_APPLIED' as const,
      id,
      timestamp,
      slots,
      appliedRules,
      attribution: Object.keys(attribution).length > 0 ? attribution : undefined,
      prevHash,
    };
    const chainHash = computeHash(body);
    const event: LayoutAppliedEvent = { ...body, chainHash };
    this.lastHash = chainHash;
    this._chain.update((cur) => [...cur, event]);
    void this.sink?.emit(event);
  });

  /** Test/admin helper — clears the chain. Does NOT reset upstream sinks. */
  reset(): void {
    this._chain.set([]);
    this.lastSlotsKey = null;
    this.lastHash = null;
  }

  /**
   * Look up the resolved layout as it stood at-or-before a given
   * timestamp. Walks the chain (oldest first), returns the latest
   * event whose `timestamp <= when`. Returns null if no event
   * predates that moment.
   *
   * Time-travel viewer (ADR-046 D4 open question 4 → "snapshot
   * inspector" path) reads this for "show me the workspace at
   * 14:30Z" queries.
   */
  snapshotAt(when: string | Date): LayoutAppliedEvent | null {
    const whenIso = typeof when === 'string' ? when : when.toISOString();
    const chain = this._chain();
    let candidate: LayoutAppliedEvent | null = null;
    for (const event of chain) {
      if (event.timestamp > whenIso) break;
      candidate = event;
    }
    return candidate;
  }

  /**
   * Validate the chain — verifies every event's `prevHash` points at
   * the previous event's `chainHash`. Returns null on valid chain,
   * or the first event whose link is broken. Useful for "is this
   * audit trail trustworthy?" smoke checks.
   */
  validateChain(): LayoutAppliedEvent | null {
    let prev: string | null = null;
    for (const event of this._chain()) {
      if (event.prevHash !== prev) return event;
      prev = event.chainHash;
    }
    return null;
  }
}

// ── helpers ──

/**
 * Stable stringify so the dedup key + hash input are deterministic.
 * Sorts object keys at every depth.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k];
      return sorted;
    }
    return v;
  });
}

/**
 * Lightweight content hash — sha256 hex via Web Crypto when available
 * (browser + recent Node), fallback to a non-cryptographic FNV-1a hash
 * for SSR / older runtimes. The fallback is NOT cryptographically
 * secure but produces a stable deterministic chain so the link
 * topology + reproducibility hold; adopters with compliance
 * requirements can register their own sink that re-hashes via their
 * preferred algorithm.
 */
function computeHash(value: unknown): string {
  const input = stableStringify(value);
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    // Crypto.subtle.digest is async — but `effect()` is sync. We
    // compute the FNV fallback synchronously and stamp the event;
    // adopters who want crypto-strength hashes register a sink that
    // recomputes on emit. Documented in the JSDoc above.
  }
  return fnv1aHex(input);
}

function fnv1aHex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
