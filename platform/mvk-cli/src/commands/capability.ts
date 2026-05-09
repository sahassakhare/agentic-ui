import type { Command } from './types.js';
import { emit, emitTable, emitError } from '../output.js';

interface CapabilityRow {
  id: string;
  kind: string;
  name: string;
  lifecycle: 'draft' | 'published' | 'deprecated' | 'disabled';
  owner: string | null;
  tags: string[];
  updatedAt: string;
}

function tenantOf(ctx: { config: { defaultTenantId?: string }; args: { flags: Record<string, string | boolean> } }): string | null {
  return (ctx.args.flags['tenant'] as string | undefined)
    ?? ctx.config.defaultTenantId
    ?? null;
}

export const capabilityList: Command = {
  description: 'List capabilities for a tenant',
  usage: 'mvk capability list [--tenant <id>] [--kind <kind>] [--lifecycle <state>] [--json]',
  async run(ctx): Promise<number> {
    const tenant = tenantOf(ctx);
    if (!tenant) { emitError('No tenant. Pass --tenant <id> or set defaultTenantId via `mvk login`.'); return 1; }
    const query: Record<string, string | number | boolean | undefined> = { limit: 200 };
    if (ctx.args.flags['kind']) query['kind'] = String(ctx.args.flags['kind']);
    if (ctx.args.flags['lifecycle']) query['lifecycle'] = String(ctx.args.flags['lifecycle']);
    const res = await ctx.client.request({
      method: 'GET',
      path: `v1/catalogs/${encodeURIComponent(tenant)}/capabilities`,
      query,
    });
    const items = (res.body as { items: CapabilityRow[] }).items;
    emitTable(
      items,
      [
        { header: 'KIND', pick: (c) => c.kind },
        { header: 'NAME', pick: (c) => c.name },
        { header: 'LIFECYCLE', pick: (c) => c.lifecycle },
        { header: 'OWNER', pick: (c) => c.owner },
        { header: 'TAGS', pick: (c) => c.tags.join(',') || null },
      ],
      { json: !!ctx.args.flags['json'] },
    );
    return 0;
  },
};

export const capabilityRegister: Command = {
  description: 'Register a single capability (or bulk via stdin JSONL)',
  usage:
    'mvk capability register [--tenant <id>] --kind <kind> --name <name> [--body-json <json>] [--lifecycle published] [--owner <id>] [--tag tag1,tag2]\n' +
    '   OR  cat caps.jsonl | mvk capability register [--tenant <id>] --bulk',
  async run(ctx): Promise<number> {
    const tenant = tenantOf(ctx);
    if (!tenant) { emitError('No tenant. Pass --tenant <id> or set defaultTenantId via `mvk login`.'); return 1; }

    if (ctx.args.flags['bulk']) {
      return await bulkRegister(ctx, tenant);
    }

    const kind = ctx.args.flags['kind'] as string | undefined;
    const name = ctx.args.flags['name'] as string | undefined;
    if (!kind || !name) { emitError('Required flags: --kind, --name'); return 1; }
    const bodyJson = (ctx.args.flags['body-json'] as string | undefined) ?? '{}';
    let body: Record<string, unknown>;
    try { body = JSON.parse(bodyJson) as Record<string, unknown>; }
    catch { emitError('--body-json is not valid JSON'); return 1; }
    const tags = ctx.args.flags['tag']
      ? String(ctx.args.flags['tag']).split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const payload: Record<string, unknown> = {
      kind, name, body, tags,
      lifecycle: ctx.args.flags['lifecycle'] ?? 'published',
    };
    if (ctx.args.flags['owner']) payload['owner'] = ctx.args.flags['owner'];
    const res = await ctx.client.request({
      method: 'POST',
      path: `v1/catalogs/${encodeURIComponent(tenant)}/capabilities`,
      body: payload,
    });
    emit(res.body, { json: true });
    return 0;
  },
};

async function bulkRegister(ctx: Parameters<Command['run']>[0], tenant: string): Promise<number> {
  const stdin = ctx.stdin ?? process.stdin;
  if (stdin.isTTY) {
    emitError('--bulk reads JSONL from stdin (one JSON object per line). Pipe a file in.');
    return 1;
  }
  const chunks: Buffer[] = [];
  for await (const c of stdin) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string));
  const text = Buffer.concat(chunks).toString('utf8');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let ok = 0; let failed = 0;
  for (const line of lines) {
    let payload: unknown;
    try { payload = JSON.parse(line); }
    catch {
      process.stderr.write(`  ✗ skip (not JSON): ${line.slice(0, 60)}\n`);
      failed++;
      continue;
    }
    try {
      await ctx.client.request({
        method: 'POST',
        path: `v1/catalogs/${encodeURIComponent(tenant)}/capabilities`,
        body: payload,
      });
      const p = payload as { kind?: string; name?: string };
      process.stdout.write(`  ✓ ${p.kind ?? '?'}:${p.name ?? '?'}\n`);
      ok++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  ✗ ${msg}\n`);
      failed++;
    }
  }
  process.stdout.write(`\nBulk: ${ok} ok, ${failed} failed\n`);
  return failed === 0 ? 0 : 1;
}

export const capabilityPatch: Command = {
  description: 'Patch a capability lifecycle (or other fields)',
  usage: 'mvk capability patch <id> [--tenant <id>] [--lifecycle published] [--owner <id>]',
  async run(ctx): Promise<number> {
    const tenant = tenantOf(ctx);
    const id = ctx.args.positional[0];
    if (!tenant || !id) { emitError('Usage: mvk capability patch <id> [--tenant <id>]'); return 1; }
    const patch: Record<string, unknown> = {};
    if (ctx.args.flags['lifecycle']) patch['lifecycle'] = ctx.args.flags['lifecycle'];
    if (ctx.args.flags['owner']) patch['owner'] = ctx.args.flags['owner'];
    if (Object.keys(patch).length === 0) {
      emitError('No fields to patch. Pass --lifecycle or --owner.');
      return 1;
    }
    const res = await ctx.client.request({
      method: 'PATCH',
      path: `v1/catalogs/${encodeURIComponent(tenant)}/capabilities/${encodeURIComponent(id)}`,
      body: patch,
    });
    emit(res.body, { json: true });
    return 0;
  },
};

export const capabilityDelete: Command = {
  description: 'Soft-delete a capability',
  usage: 'mvk capability delete <id> [--tenant <id>] [--force]',
  async run(ctx): Promise<number> {
    const tenant = tenantOf(ctx);
    const id = ctx.args.positional[0];
    if (!tenant || !id) { emitError('Usage: mvk capability delete <id> [--tenant <id>] [--force]'); return 1; }
    if (!ctx.args.flags['force']) { emitError(`Pass --force to confirm.`); return 1; }
    await ctx.client.request({
      method: 'DELETE',
      path: `v1/catalogs/${encodeURIComponent(tenant)}/capabilities/${encodeURIComponent(id)}`,
    });
    emit(`Soft-deleted capability ${id} (tenant ${tenant}).`, { json: !!ctx.args.flags['json'] });
    return 0;
  },
};
