/**
 * Development environment for demo-feature-tour.
 *
 * The agent endpoint defaults to the orchestrator so the chat can route
 * across specialists when the user types something off-topic. To run
 * against a single Gemini agent, switch to `/agents/gemini/run`.
 */
export const environment = {
  production: false,
  agentUrl: 'http://localhost:4111/agents/gemini/run',
  telemetry: 'console' as 'none' | 'console' | 'otel',
};
