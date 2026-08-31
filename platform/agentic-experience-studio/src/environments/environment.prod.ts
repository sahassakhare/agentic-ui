export const environment = {
  production: true,
  catalogBaseUrl: '',
  authMode: 'oidc' as 'oidc' | 'disabled',
  ingestUrl: '',
  // The AG-UI SSE backend for the in-Studio authoring copilot (set per deployment).
  agentUrl: '',
  // AI copilot ON by default; the top-bar toggle is the author's opt-out.
  featureFlags: { aiAssistedAuthoring: true } as Record<string, boolean>,
};
