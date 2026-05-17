/**
 * Pure hashing helpers — extracted from `audit-chain.ts` so
 * `mock-data.ts`'s `appendAudit` can compute the chain hash without
 * pulling in the verification / report builder (which would create
 * a circular import).
 *
 * @remarks
 * `fnv1aHex` is a deterministic 64-bit-ish hash — demo-grade. Real
 * eDiscovery deployments use SHA-256 + an HMAC keyed off a per-
 * matter secret kept in an HSM. Swap by replacing this function.
 */
import type { AuditEvent } from './types.js';

export function fnv1aHex(input: string): string {
  let hi = 0xcbf2_9ce4 | 0;
  let lo = 0x8422_2325 | 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    lo = (lo ^ c) >>> 0;
    const a = Math.imul(lo, 0x000001b3) >>> 0;
    const b = Math.imul(lo, 0x10000000) >>> 0;
    const c2 = Math.imul(hi, 0x000001b3) >>> 0;
    lo = a >>> 0;
    hi = ((b + c2) >>> 0) ^ ((lo / 0x100000000) | 0);
    hi = hi >>> 0;
  }
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}

/** Compute the chain hash for an event given the previous event's hash. */
export function computeChainHash(event: AuditEvent, prevChainHash: string | undefined): string {
  const payload = JSON.stringify({
    prev: prevChainHash ?? '',
    id: event.id,
    matter: event.matterId,
    actor: event.actor,
    action: event.action,
    target: event.target,
    before: event.before,
    after: event.after,
    reason: event.reason,
    ts: event.timestamp,
  });
  return fnv1aHex(payload);
}
