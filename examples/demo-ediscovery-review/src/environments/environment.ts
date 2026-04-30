/**
 * Standalone-mode environment for `demo-ediscovery-review`.
 *
 * The remote also runs as its own app at :4302 — visiting the URL
 * directly proves the capability is a complete domain artefact, not
 * just a chat shim. The standalone UI lets a paralegal browse the
 * matter's documents and exercise the same review handlers the agent
 * calls.
 */
export const environment = {
  production: false,
  matterId: 'M-2026-0042',
};
