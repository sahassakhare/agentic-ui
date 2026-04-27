/**
 * Development environment for demo-multi-agent.
 *
 * Points at the orchestrator agent. The agent server hosts four LLM-backed
 * agents under one process: orchestrator (router) plus three specialists
 * (bookings, loyalty, support). The orchestrator classifies the user's
 * message and forwards events from the chosen specialist verbatim.
 *
 * Production builds replace this file with `environment.prod.ts` via the
 * `fileReplacements` array in angular.json.
 */
export const environment = {
  production: false,
  agentUrl: 'http://localhost:4111/agents/orchestrator/run',
  telemetry: 'console' as 'none' | 'console' | 'otel',
};
