/**
 * Development environment for demo-shell.
 *
 * Production builds replace this file with `environment.prod.ts` via the
 * `fileReplacements` array in angular.json. Never hardcode URLs in component
 * sources; read them through this file so dev / staging / prod can diverge
 * without touching app code.
 */
export const environment = {
  production: false,
  /** Agent server SSE endpoint. Switch to `/agents/echo/run` for the no-LLM agent. */
  agentUrl: 'http://localhost:4111/agents/gemini/run',
  /** URL of the static MFE registry document (JSON: { remotes: RemoteSpec[] }). */
  mfeRegistryUrl: '/mfes.json',
  /** Environment name passed to MfeRegistryClient.discover(). */
  mfeEnv: 'dev',
  /** Telemetry mode: 'none' | 'console' | 'otel'. */
  telemetry: 'console' as 'none' | 'console' | 'otel',
};
