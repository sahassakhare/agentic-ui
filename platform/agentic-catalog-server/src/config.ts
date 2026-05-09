import { z } from 'zod';

/**
 * 12-factor configuration. Read from environment variables; validated
 * with Zod at startup so the process fails fast on missing required
 * values rather than failing on the first request.
 */
const ConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  HOST: z.string().default('0.0.0.0'),

  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_IDLE_MS: z.coerce.number().int().min(1000).default(30_000),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).default(5_000),

  // ── Auth ─────────────────────────────────────────────────────
  // `oidc` (default): every request must carry a JWT validated against
  //                   OIDC_ISSUER's JWKS.
  // `disabled`:       every request is treated as platform-admin with
  //                   tenant scope from the URL path. ⚠️ DEMO / TRUSTED-
  //                   NETWORK ONLY — anyone who reaches the catalog has
  //                   full read+write across every tenant. Documented
  //                   in ADR-022.
  AUTH_MODE: z.enum(['oidc', 'disabled']).default('oidc'),

  // OIDC fields — required when AUTH_MODE=oidc, optional otherwise.
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_AUDIENCE: z.string().min(1).optional(),
  OIDC_JWKS_URI: z.string().url().optional(),
  OIDC_TENANT_CLAIM: z.string().default('tenant_id'),
  OIDC_ROLES_CLAIM: z.string().default('roles'),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),

  // Operations
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).default(15_000),
});

export type CatalogConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CatalogConfig {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuration invalid:\n${issues}`);
  }
  const config = result.data;
  // Cross-field invariant: when AUTH_MODE=oidc, the OIDC fields are
  // required. The Zod schema can't express conditional-required
  // without verbose union types, so we check here.
  if (config.AUTH_MODE === 'oidc') {
    if (!config.OIDC_ISSUER || !config.OIDC_AUDIENCE) {
      throw new Error(
        'Configuration invalid:\n  - OIDC_ISSUER and OIDC_AUDIENCE are required when AUTH_MODE=oidc.\n' +
        '    Set AUTH_MODE=disabled for trusted-network demos (see ADR-022) or wire your OIDC provider.',
      );
    }
  }
  return config;
}
