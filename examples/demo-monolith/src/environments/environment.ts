/**
 * Development environment for demo-monolith.
 *
 * Production builds replace this file with `environment.prod.ts` via the
 * `fileReplacements` array in angular.json.
 */
export const environment = {
  production: false,
  agentUrl: 'http://localhost:4111/agents/gemini/run',
  telemetry: 'console' as 'none' | 'console' | 'otel',
};
