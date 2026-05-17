/**
 * Stable id generators for the eDiscovery domain. Each entity type has
 * its own prefix so audit events and tool calls are self-describing in
 * logs.
 */
export function nextCustodianId(): string {
  return `CUST-${Math.random().toString(36).slice(2, 5).toUpperCase()}${Date.now().toString(36).slice(-3)}`;
}

export function nextLegalHoldId(): string {
  return `HOLD-${Math.random().toString(36).slice(2, 5).toUpperCase()}${Date.now().toString(36).slice(-3)}`;
}

export function nextAuditId(): string {
  return `AUDIT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}
