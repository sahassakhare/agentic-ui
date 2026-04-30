export const environment = {
  production: true,
  agentUrl: '/api/agents/coordinator/run',
  matterId: 'M-2026-0042',
  persona: 'lead-counsel' as 'paralegal' | 'associate' | 'lead-counsel' | 'lit-support' | 'vendor-reviewer',
  telemetry: 'none' as 'none' | 'console' | 'otel',
};
