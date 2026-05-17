import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * On-disk config for the CLI. Stored at `~/.mvk/config.json`. The
 * file holds the catalog URL + a Bearer token; permissions are 0600
 * so other users on the host can't read it.
 *
 * Env vars `MVK_CATALOG_URL` and `MVK_TOKEN` override the file
 * (useful for CI). `--catalog-url` and `--token` flags override the
 * env vars.
 */

const ConfigSchema = z.object({
  catalogUrl: z.string().url(),
  token: z.string().nullable(),
  authMode: z.enum(['oidc', 'disabled']).default('oidc'),
  /** Default tenant for tenant-scoped subcommands. */
  defaultTenantId: z.string().optional(),
});
export type CliConfig = z.infer<typeof ConfigSchema>;

const CONFIG_DIR = join(homedir(), '.mvk');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export function configPath(): string { return CONFIG_PATH; }

export function readConfig(): Partial<CliConfig> | null {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8');
    const parsed = ConfigSchema.partial().safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeConfig(config: Partial<CliConfig>): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

/**
 * Merge precedence (highest first):
 *   1. command-line flags (`overrides`)
 *   2. env vars (MVK_CATALOG_URL, MVK_TOKEN, MVK_AUTH_MODE, MVK_TENANT_ID)
 *   3. ~/.mvk/config.json
 *   4. defaults (catalogUrl=http://localhost:8080)
 */
export function resolveConfig(overrides: Partial<CliConfig> = {}): CliConfig {
  const file = readConfig() ?? {};
  const env: Partial<CliConfig> = {};
  const envCatalog = process.env['MVK_CATALOG_URL'];
  const envToken = process.env['MVK_TOKEN'];
  const envMode = process.env['MVK_AUTH_MODE'];
  const envTenant = process.env['MVK_TENANT_ID'];
  if (envCatalog) env.catalogUrl = envCatalog;
  if (envToken) env.token = envToken;
  if (envMode === 'oidc' || envMode === 'disabled') env.authMode = envMode;
  if (envTenant) env.defaultTenantId = envTenant;

  const merged: CliConfig = {
    catalogUrl: overrides.catalogUrl ?? env.catalogUrl ?? file.catalogUrl ?? 'http://localhost:8080',
    token: overrides.token ?? env.token ?? file.token ?? null,
    authMode: overrides.authMode ?? env.authMode ?? file.authMode ?? 'oidc',
    ...(overrides.defaultTenantId
      ? { defaultTenantId: overrides.defaultTenantId }
      : env.defaultTenantId
      ? { defaultTenantId: env.defaultTenantId }
      : file.defaultTenantId
      ? { defaultTenantId: file.defaultTenantId }
      : {}),
  };
  return merged;
}
