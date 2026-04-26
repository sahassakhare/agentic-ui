/**
 * Production environment for demo-monolith.
 *
 * Replace with your real deploy targets.
 */
export const environment = {
  production: true,
  agentUrl: 'https://agent.example.com/agents/gemini/run',
  telemetry: 'otel' as 'none' | 'console' | 'otel',
};
