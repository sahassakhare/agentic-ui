export const environment = {
  production: true,
  // In production the ops console is typically served from the same
  // origin as the catalog. An empty base URL keeps requests
  // same-origin so a reverse proxy can route /v1/* to the catalog.
  catalogBaseUrl: '',
  /**
   * Trust mode. Match this to the catalog's `AUTH_MODE`. The Render
   * blueprint flips this to `'disabled'` at build time via
   * environment-variable substitution; production deployments behind
   * a real IdP keep it on `'oidc'`. See ADR-022.
   */
  authMode: 'oidc' as 'oidc' | 'disabled',
};
