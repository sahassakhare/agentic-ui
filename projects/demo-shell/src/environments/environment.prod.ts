/**
 * Production environment for demo-shell.
 *
 * Replace these with your real deploy targets. The values are baked into the
 * production bundle at build time. For values that need to change *per
 * deployment without rebuilding* (e.g., agent URL across regions), serve a
 * runtime config endpoint and fetch it during APP_INITIALIZER instead.
 */
export const environment = {
  production: true,
  agentUrl: 'https://agent.example.com/agents/orchestrator/run',
  mfeRegistryUrl: 'https://registry.example.com/mfes.json',
  mfeEnv: 'production',
  telemetry: 'otel' as 'none' | 'console' | 'otel',
};
