/**
 * The runtime "load half" for **Decisions** — compiles a Studio-authored
 * `kind:'decision'` capability (a DMN table) into `DecisionRegistry`, and exposes
 * each decision as an executable `ToolDef` so the assistant can run governed
 * decisions (inputs → outputs). The registry is also the substrate for
 * forms/workflows to branch on a decision by name.
 *
 * Mirrors `CatalogFormSource`; re-hydrates over catalog SSE.
 */
import { Injectable, inject, signal } from '@angular/core';
import { ToolRegistry, agenticTool, type ToolDef } from '@infra-tools/agentic-ui';
import { z } from 'zod';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { DecisionRegistry } from './decision-registry';
import { evaluateDecision, type DecisionField, type DecisionRule, type DecisionTable, type HitPolicy } from './decision-eval';

const CATALOG_URL = environment.catalogBaseUrl;
const TENANT = environment.tenant;
const SOURCE = 'catalog-decision';

interface CatalogDecisionRow {
  readonly name: string;
  readonly body?: {
    description?: string;
    hitPolicy?: string;
    inputs?: DecisionField[];
    outputs?: DecisionField[];
    rules?: DecisionRule[];
  };
}

@Injectable({ providedIn: 'root' })
export class CatalogDecisionSource {
  private readonly decisions = inject(DecisionRegistry);
  private readonly tools = inject(ToolRegistry);
  private readonly auth = inject(AuthService);
  private stream?: EventSource;

  readonly count = signal(0);
  readonly error = signal<string | null>(null);

  async hydrate(): Promise<void> {
    try {
      const url = `${CATALOG_URL}/v1/catalogs/${encodeURIComponent(TENANT)}/capabilities?kind=decision`;
      const headers: Record<string, string> = { accept: 'application/json' };
      const token = this.auth.token();
      if (environment.authMode === 'oidc' && token) headers['authorization'] = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`catalog returned ${res.status}`);
      const { items } = (await res.json()) as { items: CatalogDecisionRow[] };
      this.decisions.clear();
      this.tools.removeBySource(SOURCE);
      let n = 0;
      for (const row of items) {
        const table = this.toTable(row);
        this.decisions.set({ name: row.name, description: row.body?.description, table });
        try { this.tools.register(this.toTool(row, table)); n++; }
        catch (e) { this.error.set(`decision "${row.name}": ${(e as Error).message}`); }
      }
      this.count.set(n);
      this.error.set(null);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  startLiveSync(): void {
    if (this.stream) return;
    try {
      this.stream = new EventSource(`${CATALOG_URL}/v1/catalogs/${encodeURIComponent(TENANT)}/stream`);
      this.stream.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data) as { entityType?: string; kind?: string };
          if (d.entityType === 'decision' || d.kind === 'decision') void this.hydrate();
        } catch { /* ignore keepalives */ }
      };
      this.stream.onerror = () => { /* browser auto-reconnects */ };
    } catch { /* SSE unavailable */ }
  }

  private toTable(row: CatalogDecisionRow): DecisionTable {
    return {
      inputs: row.body?.inputs ?? [],
      outputs: row.body?.outputs ?? [],
      rules: row.body?.rules ?? [],
      hitPolicy: (row.body?.hitPolicy as HitPolicy) ?? 'first',
    };
  }

  /** Expose a decision as an executable tool: inputs → outputs. */
  private toTool(row: CatalogDecisionRow, table: DecisionTable): ToolDef {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const inp of table.inputs) shape[inp.name] = zodFor(inp.type).optional();
    const def = agenticTool({
      name: row.name,
      description: row.body?.description ?? `Evaluate the ${row.name} decision (${table.inputs.map((i) => i.name).join(', ')} → ${table.outputs.map((o) => o.name).join(', ')})`,
      schema: z.object(shape).passthrough(),
      handler: async (args: Record<string, unknown>) => {
        const r = evaluateDecision(table, args ?? {});
        return { outputs: r.outputs, matchedRules: r.matchedRules, conflict: r.conflict ?? false };
      },
    });
    return { ...def, source: SOURCE } as unknown as ToolDef;
  }
}

function zodFor(type: DecisionField['type']): z.ZodTypeAny {
  switch (type) {
    case 'number': return z.number();
    case 'boolean': return z.boolean();
    default: return z.string(); // string | date
  }
}
