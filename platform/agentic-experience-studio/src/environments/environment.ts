/**
 * Development environment for the Experience Studio.
 * SSO demo wiring (P3): oidc mode against the auth-enabled catalog (:8081),
 * logging in via the real auth-code + PKCE provider (:9100).
 */
export const environment = {
  production: false,
  catalogBaseUrl: 'http://localhost:8081',
  authMode: 'oidc' as 'oidc' | 'disabled',
  // Component-ingest service: upload an Angular library → federated remote of widgets.
  ingestUrl: 'http://localhost:4320',
  ssoAuthorizeUrl: 'http://127.0.0.1:9100/authorize',
  ssoTokenUrl: 'http://127.0.0.1:9100/token',
  // The AG-UI SSE backend the in-Studio authoring copilot talks to.
  agentUrl: 'http://localhost:4111/agents/authoring/run',
  // Platform-level feature-flag defaults (cascade layer 1). A flag resolves ON
  // when true here AND permitted by tenant policy AND not opted out by the author.
  // `aiAssistedAuthoring` gates the in-Studio AI copilot — ON by default; the
  // top-bar toggle is the author's opt-out ("work without it").
  featureFlags: { aiAssistedAuthoring: true } as Record<string, boolean>,
};
