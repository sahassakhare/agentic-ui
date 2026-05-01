/**
 * Standalone-mode environment for `demo-ediscovery-production`.
 *
 * The remote also runs as its own app at :4303 — visiting the URL
 * directly proves the production-assembly capability is a complete
 * domain artefact, not just a chat shim. Same handlers the host's
 * agent calls.
 */
export const environment = {
  production: false,
  matterId: 'M-2026-0042',
};
