import type { Command } from './types.js';
import { emit } from '../output.js';

export const healthCommand: Command = {
  description: 'Hit the catalog /healthz endpoint',
  usage: 'mvk health',
  async run(ctx): Promise<number> {
    const res = await ctx.client.request({ method: 'GET', path: 'healthz' });
    emit(res.body, { json: true });
    return 0;
  },
};

export const readyCommand: Command = {
  description: 'Hit the catalog /readyz endpoint (DB connectivity)',
  usage: 'mvk ready',
  async run(ctx): Promise<number> {
    try {
      const res = await ctx.client.request({ method: 'GET', path: 'readyz' });
      emit(res.body, { json: true });
      return 0;
    } catch (err) {
      // /readyz returns 503 when the DB is unreachable; that's a
      // legitimate signal, not a CLI error.
      const e = err as { status?: number; body?: unknown };
      if (e.status === 503) {
        emit(e.body, { json: true });
        return 2;
      }
      throw err;
    }
  },
};
