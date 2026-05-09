import { parseArgs } from './argv.js';
import { resolveConfig, type CliConfig } from './config.js';
import { createCatalogClient, CatalogError } from './catalog-client.js';
import { emitError } from './output.js';
import { isCommand, type Command, type CommandTree } from './commands/types.js';

import { loginCommand, whoamiCommand } from './commands/login.js';
import {
  tenantList, tenantGet, tenantCreate, tenantSuspend, tenantActivate, tenantDelete,
} from './commands/tenant.js';
import {
  capabilityList, capabilityRegister, capabilityPatch, capabilityDelete,
} from './commands/capability.js';
import { auditVerify, auditExport } from './commands/audit.js';
import { usageAggregate, usageRecent } from './commands/usage.js';
import { healthCommand, readyCommand } from './commands/health.js';

const ROOT: CommandTree = {
  login: loginCommand,
  whoami: whoamiCommand,
  tenant: {
    list: tenantList,
    get: tenantGet,
    create: tenantCreate,
    suspend: tenantSuspend,
    activate: tenantActivate,
    delete: tenantDelete,
  },
  capability: {
    list: capabilityList,
    register: capabilityRegister,
    patch: capabilityPatch,
    delete: capabilityDelete,
  },
  audit: {
    verify: auditVerify,
    export: auditExport,
  },
  usage: {
    _default: usageAggregate,    // bare `mvk usage` runs the aggregate
    list: usageAggregate,        // alias
    aggregate: usageAggregate,
    recent: usageRecent,
  },
  health: healthCommand,
  ready: readyCommand,
};

const VERSION = '0.1.0';

function configOverridesFromFlags(flags: Record<string, string | boolean>): Partial<CliConfig> {
  const o: Partial<CliConfig> = {};
  if (typeof flags['catalog-url'] === 'string') o.catalogUrl = flags['catalog-url'];
  if (typeof flags['token'] === 'string') o.token = flags['token'];
  if (flags['auth-mode'] === 'oidc' || flags['auth-mode'] === 'disabled') o.authMode = flags['auth-mode'];
  if (typeof flags['tenant'] === 'string') o.defaultTenantId = flags['tenant'];
  return o;
}

function findCommand(tree: CommandTree, path: readonly string[]): { command: Command | null; consumed: number } {
  let node: Command | CommandTree = tree;
  let consumed = 0;
  for (const seg of path) {
    if (isCommand(node)) break;
    const next: Command | CommandTree | undefined = node[seg];
    if (!next) break;
    node = next;
    consumed++;
  }
  if (isCommand(node)) return { command: node, consumed };
  // No exact match — fall back to a `_default` Command if the
  // subtree has one (e.g. `mvk usage` → ROOT.usage._default
  // = aggregate).
  if (node && !isCommand(node) && '_default' in node) {
    const def = node['_default'];
    if (def && isCommand(def)) return { command: def, consumed };
  }
  return { command: null, consumed };
}

function printHelp(tree: CommandTree, prefix = 'mvk'): void {
  const entries = Object.entries(tree)
    .filter(([k]) => !k.startsWith('_'))    // hide _default and other private entries
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [name, node] of entries) {
    if (isCommand(node)) {
      process.stdout.write(`  ${prefix} ${name}`.padEnd(36) + '  ' + node.description + '\n');
    } else {
      // Show a "<prefix> <name>" entry if the subtree has a _default.
      if ('_default' in node) {
        const def = node['_default'];
        if (def && isCommand(def)) {
          process.stdout.write(`  ${prefix} ${name}`.padEnd(36) + '  ' + def.description + '\n');
        }
      }
      printHelp(node, `${prefix} ${name}`);
    }
  }
}

function printRootHelp(): void {
  process.stdout.write(`mvk — Maverick agentic platform CLI (v${VERSION})\n\n`);
  process.stdout.write('Usage:\n  mvk <command> [<subcommand>] [flags]\n\n');
  process.stdout.write('Global flags:\n');
  process.stdout.write('  --catalog-url <url>   override the catalog base URL\n');
  process.stdout.write('  --token <jwt>         override the bearer token (oidc mode)\n');
  process.stdout.write('  --auth-mode <mode>    oidc | disabled\n');
  process.stdout.write('  --tenant <id>         default tenant for tenant-scoped commands\n');
  process.stdout.write('  --json                emit JSON instead of tables\n');
  process.stdout.write('  --quiet               suppress non-error output\n\n');
  process.stdout.write('Environment:\n');
  process.stdout.write('  MVK_CATALOG_URL, MVK_TOKEN, MVK_AUTH_MODE, MVK_TENANT_ID\n\n');
  process.stdout.write('Commands:\n');
  printHelp(ROOT);
  process.stdout.write('\nConfig:\n  ~/.mvk/config.json (chmod 600). Run `mvk login` to populate.\n');
}

export async function run(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    printRootHelp();
    return 0;
  }
  if (argv[0] === '--version' || argv[0] === '-v' || argv[0] === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const args = parseArgs(argv);

  if (args.flags['help'] === true || args.flags['h'] === true) {
    const { command } = findCommand(ROOT, args.positional);
    if (command) {
      process.stdout.write((command.usage ?? command.description) + '\n');
      process.stdout.write(command.description + '\n');
      return 0;
    }
    printRootHelp();
    return 0;
  }

  const { command, consumed } = findCommand(ROOT, args.positional);
  if (!command) {
    emitError(
      args.positional.length === 0
        ? 'No command specified. Run `mvk help`.'
        : `Unknown command: ${args.positional.slice(0, Math.max(consumed + 1, 1)).join(' ')}. Run \`mvk help\`.`,
    );
    return 1;
  }

  // Peel off the consumed prefix as subcommands; remainder is data.
  const finalArgs = {
    subcommands: args.positional.slice(0, consumed),
    positional: args.positional.slice(consumed),
    flags: args.flags,
  };

  const config = resolveConfig(configOverridesFromFlags(args.flags));
  const client = createCatalogClient(config);

  try {
    return await command.run({ client, config, args: finalArgs });
  } catch (err) {
    if (err instanceof CatalogError) {
      emitError(`${err.message}${err.status > 0 ? ` (HTTP ${err.status})` : ''}`, {
        json: !!args.flags['json'],
      });
      return err.status === -1 ? 1 : err.status >= 500 ? 5 : 2;
    }
    emitError(err);
    return 1;
  }
}

// Allow `node dist/cli.js …` direct invocation (the bin/mvk.js script
// calls `run()` explicitly; this is a fallback for development).
const isDirect = import.meta.url === `file://${process.argv[1]}`;
if (isDirect) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
