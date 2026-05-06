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
};
