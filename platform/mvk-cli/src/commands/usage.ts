import type { Command } from './types.js';
import { emit, emitTable, emitError } from '../output.js';

function tenantOf(ctx: { config: { defaultTenantId?: string }; args: { flags: Record<string, string | boolean> } }): string | null {
  return (ctx.args.flags['tenant'] as string | undefined) ?? ctx.config.defaultTenantId ?? null;
}

export const usageAggregate: Command = {
  description: 'Aggregate usage events by kind over a time window',
  usage: 'mvk usage [--tenant <id>] [--from ISO] [--to ISO] [--kind <kind>] [--json]',
  async run(ctx): Promise<number> {
    const tenant = tenantOf(ctx);
    if (!tenant) { emitError('No tenant.'); return 1; }
    const query: Record<string, string | number | boolean | undefined> = {};
    if (ctx.args.flags['from']) query['from'] = String(ctx.args.flags['from']);
    if (ctx.args.flags['to']) query['to'] = String(ctx.args.flags['to']);
    if (ctx.args.flags['kind']) query['kind'] = String(ctx.args.flags['kind']);

    const res = await ctx.client.request({
      method: 'GET',
      path: `v1/catalogs/${encodeURIComponent(tenant)}/usage`,
      query,
    });
    const r = res.body as {
      from: string | null; to: string | null;
      byKind: Record<string, number>;
      totalEvents: number; totalQuantity: number;
    };
    if (ctx.args.flags['json']) {
      emit(r, { json: true });
      return 0;
    }
    process.stdout.write(`tenant: ${tenant}\n`);
    if (r.from || r.to) process.stdout.write(`window: ${r.from ?? 'all'} → ${r.to ?? 'now'}\n`);
    process.stdout.write(`total: ${r.totalEvents} events, ${r.totalQuantity} units\n\n`);
    const rows = Object.entries(r.byKind).map(([kind, quantity]) => ({ kind, quantity }));
    rows.sort((a, b) => b.quantity - a.quantity);
    const totalQ = r.totalQuantity || 1;
    emitTable(
      rows,
      [
        { header: 'KIND', pick: (row) => row.kind },
        { header: 'QUANTITY', pick: (row) => row.quantity.toLocaleString() },
        { header: '%', pick: (row) => ((row.quantity / totalQ) * 100).toFixed(1) + '%' },
      ],
    );
    return 0;
  },
};

export const usageRecent: Command = {
  description: 'Most recent usage events',
  usage: 'mvk usage recent [--tenant <id>] [--limit N] [--json]',
  async run(ctx): Promise<number> {
    const tenant = tenantOf(ctx);
    if (!tenant) { emitError('No tenant.'); return 1; }
    const limit = ctx.args.flags['limit'] ? Number(ctx.args.flags['limit']) : 50;
    const res = await ctx.client.request({
      method: 'GET',
      path: `v1/catalogs/${encodeURIComponent(tenant)}/usage/recent`,
      query: { limit },
    });
    const items = (res.body as { items: { id: string; occurredAt: string; kind: string; quantity: number; tags: Record<string, unknown> }[] }).items;
    emitTable(
      items,
      [
        { header: 'WHEN', pick: (e) => e.occurredAt.replace('T', ' ').slice(0, 19) },
        { header: 'KIND', pick: (e) => e.kind },
        { header: 'QTY', pick: (e) => e.quantity.toLocaleString() },
        { header: 'TAGS', pick: (e) => Object.entries(e.tags).map(([k, v]) => `${k}=${v}`).join(' ') },
      ],
      { json: !!ctx.args.flags['json'] },
    );
    return 0;
  },
};
