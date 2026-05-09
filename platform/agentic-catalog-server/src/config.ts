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

  // Auth (OIDC)
  OIDC_ISSUER: z.string().url(),
  OIDC_AUDIENCE: z.string().min(1),
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
  return result.data;
}
