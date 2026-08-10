/**
 * Development environment for the Experience Studio.
 * SSO demo wiring (P3): oidc mode against the auth-enabled catalog (:8081),
 * logging in via the real auth-code + PKCE provider (:9100).
 */
export const environment = {
  production: false,
  catalogBaseUrl: 'http://localhost:8081',
  authMode: 'oidc' as 'oidc' | 'disabled',
  ssoAuthorizeUrl: 'http://127.0.0.1:9100/authorize',
  ssoTokenUrl: 'http://127.0.0.1:9100/token',
};
