import { writeConfig, readConfig } from '../config.js';
import type { Command } from './types.js';
import { emit, emitError } from '../output.js';

export const loginCommand: Command = {
  description: 'Save catalog URL + token to ~/.mvk/config.json',
  usage: 'mvk login --catalog-url <url> [--token <jwt>] [--auth-mode oidc|disabled] [--tenant-id <id>]',
  async run(ctx): Promise<number> {
    const { args, config } = ctx;
    const catalogUrl = args.flags['catalog-url'] as string | undefined ?? config.catalogUrl;
    const token = args.flags['token'] as string | undefined ?? config.token ?? null;
    const authMode = (args.flags['auth-mode'] as 'oidc' | 'disabled' | undefined) ?? config.authMode;
    const tenantId = args.flags['tenant-id'] as string | undefined ?? config.defaultTenantId;

    if (authMode === 'oidc' && !token) {
      emitError('OIDC mode requires --token. Pass --auth-mode disabled for trusted-network demos.');
      return 1;
    }

    const merged = readConfig() ?? {};
    Object.assign(merged, { catalogUrl, authMode });
    if (token) merged.token = token; else if (authMode === 'disabled') delete merged.token;
    if (tenantId) merged.defaultTenantId = tenantId;

    writeConfig(merged);
    emit(`Saved to ~/.mvk/config.json`, { json: !!args.flags['json'] });
    if (!args.flags['json']) {
      process.stdout.write(`  catalogUrl: ${catalogUrl}\n`);
      process.stdout.write(`  authMode:   ${authMode}\n`);
      process.stdout.write(`  token:      ${token ? '(set)' : '(empty)'}\n`);
      if (tenantId) process.stdout.write(`  tenantId:   ${tenantId}\n`);
    }
    return 0;
  },
};

export const whoamiCommand: Command = {
  description: 'Show current config (token redacted)',
  usage: 'mvk whoami',
  async run(ctx): Promise<number> {
    const { config, args } = ctx;
    const view = {
      catalogUrl: config.catalogUrl,
      authMode: config.authMode,
      token: config.token ? '(set; redacted)' : null,
      defaultTenantId: config.defaultTenantId ?? null,
    };
    emit(view, { json: !!args.flags['json'] });
    return 0;
  },
};
