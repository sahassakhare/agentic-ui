import type { Command } from './types.js';
import { emit, emitError } from '../output.js';
import { writeFileSync } from 'node:fs';

function tenantOf(ctx: { config: { defaultTenantId?: string }; args: { flags: Record<string, string | boolean> } }): string | null {
  return (ctx.args.flags['tenant'] as string | undefined) ?? ctx.config.defaultTenantId ?? null;
}

export const auditVerify: Command = {
  description: 'Re-walk the audit chain server-side and report integrity',
  usage: 'mvk audit verify [--tenant <id>] [--json]',
  async run(ctx): Promise<number> {
    const tenant = tenantOf(ctx);
    if (!tenant) { emitError('No tenant. Pass --tenant <id> or set defaultTenantId.'); return 1; }
    const res = await ctx.client.request({
      method: 'GET',
      path: `v1/catalogs/${encodeURIComponent(tenant)}/audit/verify`,
    });
    const r = res.body as {
      valid: boolean; checkedRows: number;
      chainHead: { chainPosition: number; entryHash: string } | null;
      brokenAt: { chainPosition: number; reason: string } | null;
    };
    if (ctx.args.flags['json']) {
      emit(r, { json: true });
      return r.valid ? 0 : 2;
    }
    if (r.valid) {
      process.stdout.write(`✓ chain valid — ${r.checkedRows} rows verified`);
      if (r.chainHead) {
        process.stdout.write(` (head @ ${r.chainHead.chainPosition} = ${r.chainHead.entryHash.slice(0, 16)}…)`);
      }
      process.stdout.write('\n');
      return 0;
    }
    process.stdout.write(`✗ chain BROKEN at position ${r.brokenAt?.chainPosition}: ${r.brokenAt?.reason}\n`);
    return 2;
  },
};

export const auditExport: Command = {
  description: 'Stream the audit chain as JSONL (one row per line)',
  usage: 'mvk audit export [--tenant <id>] [--from ISO] [--to ISO] [--limit N] [--out audit.jsonl]',
  async run(ctx): Promise<number> {
    const tenant = tenantOf(ctx);
    if (!tenant) { emitError('No tenant.'); return 1; }
    const query: Record<string, string | number | boolean | undefined> = {};
    if (ctx.args.flags['from']) query['from'] = String(ctx.args.flags['from']);
    if (ctx.args.flags['to']) query['to'] = String(ctx.args.flags['to']);
    if (ctx.args.flags['limit']) query['limit'] = String(ctx.args.flags['limit']);
    const res = await ctx.client.request({
      method: 'GET',
      path: `v1/catalogs/${encodeURIComponent(tenant)}/audit/export`,
      query,
      accept: 'application/x-ndjson',
    });
    const out = ctx.args.flags['out'] as string | undefined;
    if (out) {
      writeFileSync(out, res.text);
      process.stdout.write(`Wrote ${res.text.split('\n').filter(Boolean).length} rows to ${out}\n`);
    } else {
      process.stdout.write(res.text);
    }
    return 0;
  },
};
