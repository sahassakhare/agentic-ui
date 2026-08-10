/**
 * Experience Hub — production config. Swapped in for `environment.ts` via the
 * angular.json `production` `fileReplacements`. Real deployments validate JWTs
 * against the OIDC issuer, so the Hub runs in `oidc` mode and forwards the
 * bearer token to the catalog. Point the URLs at the deployed services.
 */
export const environment = {
  production: true,
  catalogBaseUrl: 'https://catalog.example.com',
  tenant: 'acme',
  applicationName: 'acme-workspace',
  mfeEnv: 'prod',
  agentUrl: 'https://agents.example.com/agents/gemini/run',
  authMode: 'oidc' as 'oidc' | 'disabled',
  ssoAuthorizeUrl: 'https://sso.example.com/authorize',
  ssoTokenUrl: 'https://sso.example.com/token',
};
