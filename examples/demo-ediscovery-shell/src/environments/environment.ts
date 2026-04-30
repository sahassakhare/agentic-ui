/**
 * Development environment for demo-ediscovery-shell.
 *
 * The agent endpoint targets the matter-coordinator. In Phase 0 the
 * coordinator is an EchoAgent placeholder; Phase 1 swaps it for an
 * `OrchestratorAgent` that delegates to domain specialists.
 */
export const environment = {
  production: false,
  agentUrl: 'http://localhost:4311/agents/coordinator/run',
  /** Active matter id — the demo ships with one seed matter. */
  matterId: 'M-2026-0042',
  /**
   * Persona for permission-shim demo (Phase 7). Drives the consumer-side
   * tool filter that drops tools the current role can't invoke. Defaults
   * to lead counsel (full access) in dev.
   */
  persona: 'lead-counsel' as 'paralegal' | 'associate' | 'lead-counsel' | 'lit-support' | 'vendor-reviewer',
  telemetry: 'console' as 'none' | 'console' | 'otel',
};
