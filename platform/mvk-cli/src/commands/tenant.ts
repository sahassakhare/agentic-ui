import type { Command } from './types.js';
import { emit, emitTable, emitError } from '../output.js';

interface TenantRow {
  id: string;
  displayName: string;
  status: 'active' | 'suspended' | 'deleted';
  onboardedAt: string | null;
  suspendedReason: string | null;
}

export const tenantList: Command = {
  description: 'List tenants (platform-admin only)',
  usage: 'mvk tenant list [--include-deleted] [--json]',
  async run(ctx): Promise<number> {
    const includeDeleted = !!ctx.args.flags['include-deleted'];
    const res = await ctx.client.request({
      method: 'GET',
      path: 'v1/tenants',
      query: includeDeleted ? { includeDeleted: true } : undefined,
    });
    const items = (res.body as { items: TenantRow[] }).items;
    emitTable(
      items,
      [
        { header: 'ID', pick: (t) => t.id },
        { header: 'NAME', pick: (t) => t.displayName },
        { header: 'STATUS', pick: (t) => t.status },
        { header: 'ONBOARDED', pick: (t) => t.onboardedAt?.slice(0, 10) ?? null },
        { header: 'REASON', pick: (t) => t.suspendedReason ?? null },
      ],
      { json: !!ctx.args.flags['json'] },
    );
    return 0;
  },
};

export const tenantGet: Command = {
  description: 'Get one tenant by id',
  usage: 'mvk tenant get <id> [--json]',
  async run(ctx): Promise<number> {
    const id = ctx.args.positional[0];
    if (!id) { emitError('Usage: mvk tenant get <id>'); return 1; }
    const res = await ctx.client.request({
      method: 'GET',
      path: `v1/tenants/${encodeURIComponent(id)}`,
    });
    emit(res.body, { json: true });
    return 0;
  },
};

export const tenantCreate: Command = {
  description: 'Onboard a new tenant',
  usage: 'mvk tenant create --id <id> --display-name <name> [--quotas-json <json>]',
  async run(ctx): Promise<number> {
    const id = ctx.args.flags['id'] as string | undefined;
    const displayName = (ctx.args.flags['display-name'] ?? ctx.args.flags['name']) as string | undefined;
    const quotasJson = ctx.args.flags['quotas-json'] as string | undefined;
    if (!id || !displayName) {
      emitError('Required flags: --id, --display-name');
      return 1;
    }
    const body: Record<string, unknown> = { id, displayName };
    if (quotasJson) {
      try { body.quotas = JSON.parse(quotasJson); }
      catch { emitError('--quotas-json is not valid JSON'); return 1; }
    }
    const res = await ctx.client.request({
      method: 'POST',
      path: 'v1/tenants',
      body,
    });
    emit(res.body, { json: true });
    return 0;
  },
};

export const tenantSuspend: Command = {
  description: 'Suspend a tenant with a reason (audited)',
  usage: 'mvk tenant suspend <id> --reason <reason>',
  async run(ctx): Promise<number> {
    const id = ctx.args.positional[0];
    const reason = ctx.args.flags['reason'] as string | undefined;
    if (!id || !reason) { emitError('Usage: mvk tenant suspend <id> --reason <reason>'); return 1; }
    const res = await ctx.client.request({
      method: 'POST',
      path: `v1/tenants/${encodeURIComponent(id)}/suspend`,
      body: { reason },
    });
    emit(res.body, { json: true });
    return 0;
  },
};

export const tenantActivate: Command = {
  description: 'Reactivate a suspended tenant',
  usage: 'mvk tenant activate <id>',
  async run(ctx): Promise<number> {
    const id = ctx.args.positional[0];
    if (!id) { emitError('Usage: mvk tenant activate <id>'); return 1; }
    const res = await ctx.client.request({
      method: 'POST',
      path: `v1/tenants/${encodeURIComponent(id)}/activate`,
      body: {},
    });
    emit(res.body, { json: true });
    return 0;
  },
};

export const tenantDelete: Command = {
  description: 'Soft-delete a tenant (data preserved; psql for hard purge)',
  usage: 'mvk tenant delete <id> [--force]',
  async run(ctx): Promise<number> {
    const id = ctx.args.positional[0];
    if (!id) { emitError('Usage: mvk tenant delete <id> [--force]'); return 1; }
    if (!ctx.args.flags['force']) {
      emitError(`Pass --force to confirm soft-delete of '${id}'.`);
      return 1;
    }
    await ctx.client.request({
      method: 'DELETE',
      path: `v1/tenants/${encodeURIComponent(id)}`,
    });
    emit(`Soft-deleted tenant '${id}'.`, { json: !!ctx.args.flags['json'] });
    return 0;
  },
};
