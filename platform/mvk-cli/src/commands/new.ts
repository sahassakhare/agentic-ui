import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Command, CommandContext } from './types.js';
import { emit, emitError } from '../output.js';
import { renderAgenticAppTemplate, validateProjectName } from '../templates/agentic-app.js';

export const newApp: Command = {
  description: 'Scaffold a new @infra-tools/agentic-ui Angular app',
  usage:
    'mvk new app <name> [--dir <path>] [--with-catalog] [--with-platform] [--tenant <id>] [--dry-run]',
  async run(ctx): Promise<number> {
    const name = ctx.args.positional[0];
    if (!name) { emitError('Usage: mvk new app <name>'); return 1; }
    const v = validateProjectName(name);
    if (!v.ok) { emitError(v.reason); return 1; }

    const targetDir = resolve(
      typeof ctx.args.flags['dir'] === 'string'
        ? ctx.args.flags['dir']
        : join(process.cwd(), name),
    );
    const dryRun = !!ctx.args.flags['dry-run'];
    const withCatalog = !!ctx.args.flags['with-catalog'];
    const withPlatform = !!ctx.args.flags['with-platform'];
    const tenantArg = (ctx.args.flags['tenant'] as string | undefined) ?? name;

    if (withPlatform && !ctx.config.catalogUrl) {
      emitError(`--with-platform requires a --catalog-url (or MVK_CATALOG_URL / 'mvk login'-stored config).`);
      return 1;
    }

    // Bail out of writes if the target dir is non-empty (avoid
    // clobbering). Allow the dir to exist if it's empty.
    if (!dryRun && existsSync(targetDir)) {
      const entries = readdirSync(targetDir);
      if (entries.length > 0) {
        emitError(`Target directory '${targetDir}' is not empty. Pass a different --dir or remove existing files.`);
        return 1;
      }
    }

    const files = renderAgenticAppTemplate({
      name,
      catalogUrl: (withCatalog || withPlatform) ? ctx.config.catalogUrl : undefined,
      withPlatform,
      tenantId: tenantArg,
    });

    if (dryRun) {
      emit({
        target: targetDir,
        files: files.map((f) => ({ path: f.path, bytes: f.content.length })),
        withCatalog,
      }, { json: !!ctx.args.flags['json'] });
      return 0;
    }

    // Write the files.
    mkdirSync(targetDir, { recursive: true });
    for (const f of files) {
      const full = join(targetDir, f.path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, f.content, { mode: f.mode ?? 0o644 });
    }
    process.stdout.write(`✓ Scaffolded ${files.length} files into ${targetDir}\n`);

    if (withCatalog) {
      const code = await registerWithCatalog(ctx, name);
      if (code !== 0) {
        process.stdout.write(`  ⚠ Catalog registration failed (exit ${code}); files are still in place.\n`);
      }
    }

    process.stdout.write(`\nNext:\n`);
    process.stdout.write(`  cd ${name}\n`);
    process.stdout.write(`  npm install\n`);
    process.stdout.write(`  npm start\n`);
    return 0;
  },
};

async function registerWithCatalog(ctx: CommandContext, name: string): Promise<number> {
  const tenantId = (ctx.args.flags['tenant'] as string | undefined) ?? name;

  // 1. Onboard tenant (idempotent: 409 means it already exists; treat as success).
  try {
    await ctx.client.request({
      method: 'POST',
      path: 'v1/tenants',
      body: {
        id: tenantId,
        displayName: `${name} (mvk new)`,
      },
    });
    process.stdout.write(`  ✓ tenant '${tenantId}' onboarded\n`);
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status === 409) {
      process.stdout.write(`  • tenant '${tenantId}' already exists\n`);
    } else {
      emitError(`tenant onboard failed: ${e.message ?? 'unknown'}`);
      return 2;
    }
  }

  // 2. Register a sample capability so `mvk capability list` shows
  //    something useful immediately.
  try {
    await ctx.client.request({
      method: 'POST',
      path: `v1/catalogs/${encodeURIComponent(tenantId)}/capabilities`,
      body: {
        kind: 'tool',
        name: 'echo',
        body: { description: 'Sample echo tool — replace with real handlers in app.config.ts' },
        lifecycle: 'draft',
        tags: ['scaffold', 'example'],
      },
    });
    process.stdout.write(`  ✓ sample capability 'echo' registered\n`);
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status === 409) {
      process.stdout.write(`  • capability 'echo' already exists\n`);
    } else {
      emitError(`capability register failed: ${e.message ?? 'unknown'}`);
      return 2;
    }
  }

  return 0;
}
