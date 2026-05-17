// Render-deployed shell calls the agent server cross-origin directly.
// We tried `/api/*` proxying via Render's `_redirects` first — Render
// static sites don't forward POST bodies to external origins (returns
// 200 with empty body silently). Calling the absolute URL is the
// supported pattern; CORS lockdown happens server-side via the agent
// server's CORS_ORIGINS env var.
export const environment = {
  production: true,
  agentUrl: 'https://ediscovery-agent-server.onrender.com/agents/coordinator/run',
  matterId: 'M-2026-0042',
  persona: 'lead-counsel' as 'paralegal' | 'associate' | 'lead-counsel' | 'lit-support' | 'vendor-reviewer',
  telemetry: 'none' as 'none' | 'console' | 'otel',
  mfeRegistryUrl: '/mfes.json',
  mfeEnv: 'prod',
  // Live demo catalog (AUTH_MODE=disabled per ADR-022). When set, the
  // shell's tools/widgets auto-register against this catalog at boot
  // and the ops console's "disable capability" toggles take effect on
  // the running app within ~30s. Persona + MFE discovery remain on
  // their existing transports — see environment.ts for the rationale.
  catalogUrl: 'https://agentic-catalog-server.onrender.com',
  catalogTenantId: 'ediscovery',
  // Prod telemetry is 'none' (no console / OTel sink wired), so the
  // metering sink wrap is purely additive — no regression. Local dev
  // leaves this `false` to keep the console sink useful.
  enableUsageMetering: true,
};
