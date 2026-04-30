/**
 * Tiny module-level constants the review-remote tool handlers thread
 * through every audit-log write. Phase 7's persona shim replaces `ACTOR`
 * with the active user id; the matter id stays a one-matter constant
 * until the demo grows multi-matter routing.
 *
 * Kept module-level rather than DI-injected because the tool handlers
 * run inside `defineCapabilityModule` — which has no Angular injection
 * context until the host applies it. The host's `MatterStore` *does*
 * track the active matter via signals, but plumbing that all the way
 * into a federated remote requires a CapabilityRegistries override the
 * library plans to ship in Phase 1.6 governance work; for now, the
 * one-matter constant is enough for the demo.
 */
export const MATTER_ID = 'M-2026-0042';
export const ACTOR = 'review-specialist@firm.example';
