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
  /** Static JSON registry document — `{ remotes: RemoteSpec[] }`. */
  mfeRegistryUrl: '/mfes.json',
  /** Environment passed to `MfeRegistryClient.discover()`. */
  mfeEnv: 'dev',
  /**
   * Optional Maverick catalog server URL. When set, `provideAgenticPlatform`
   * wires the runtime to the catalog: registered tools/widgets auto-POST
   * at boot (Gap 1 / ADR-032), and operator-disabled capabilities hide
   * from the registry within ~30s (Gap 3 / ADR-033). Leave `undefined`
   * for fully-embedded local dev — every existing flow keeps working
   * exactly as before.
   *
   * Persona resolution stays under the host's `PersonaService` (UI
   * dropdown, not JWT-derived) and MFE discovery stays on the static
   * JSON manifest — those switches are opt-in once a host is ready
   * to fold them in.
   */
  catalogUrl: undefined as string | undefined,
  catalogTenantId: 'ediscovery',
  /**
   * Enables `provideAgenticPlatform({ usageMetering: {} })` (Gap 2 /
   * ADR-034). Off in dev because the metering sink wraps
   * `AGENTIC_TELEMETRY_SINK` and would silently displace the
   * console output configured by `provideAgenticTelemetryConsole()`.
   * Prod has `telemetry: 'none'` already, so flipping it on there
   * has no regression — see environment.prod.ts.
   */
  enableUsageMetering: false,
};
