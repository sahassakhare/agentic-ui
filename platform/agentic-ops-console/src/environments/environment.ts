export const environment = {
  production: false,
  catalogBaseUrl: 'http://localhost:8081',
  /**
   * Trust mode for the catalog the console talks to.
   * - `'oidc'` — login screen accepts a JWT; principal comes from
   *   the token claims.
   * - `'disabled'` — login screen accepts a tenant id; the
   *   AuthService synthesises a platform-admin principal client-
   *   side. Must match the catalog's `AUTH_MODE`. See ADR-022.
   */
  authMode: 'disabled' as 'oidc' | 'disabled',
};
