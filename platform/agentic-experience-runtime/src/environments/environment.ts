/**
 * Experience Hub — local/dev config. The Hub is the productized end-user
 * runtime: it loads a tenant's APPROVED experiences from the catalog and
 * renders each as a working application (dashboard or guided journey).
 *
 * `authMode` must match the catalog it talks to:
 *  - `'disabled'` — trusted-network dev. No JWT; the login screen collects a
 *    persona + held permissions and synthesises an end-user principal. The
 *    catalog (running `AUTH_MODE=disabled`) accepts unauthenticated requests.
 *  - `'oidc'` — the login screen accepts a JWT (from the PKCE provider on
 *    :9100); the principal comes from its claims and is forwarded as
 *    `Authorization: Bearer …`.
 */
export const environment = {
  production: false,
  catalogBaseUrl: 'http://127.0.0.1:8081',
  tenant: 'acme',
  // Which `kind:'application'` capability this Hub renders as its shell.
  applicationName: 'ediscovery-matters',
  // MFE federation environment (matches the `env` in mfes.json / the catalog).
  mfeEnv: 'dev',
  // The agentic assistant's ag-ui backend (a real LLM-backed AG-UI SSE server).
  // Point this at your running agent server; the assistant rail activates when
  // the application's `assistant.enabled` is true.
  agentUrl: 'http://localhost:4111/agents/gemini/run',
  authMode: 'disabled' as 'oidc' | 'disabled',
  ssoAuthorizeUrl: 'http://127.0.0.1:9100/authorize',
  ssoTokenUrl: 'http://127.0.0.1:9100/token',
};
