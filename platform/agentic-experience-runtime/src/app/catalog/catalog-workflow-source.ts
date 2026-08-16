/**
 * The runtime "load half" for **Workflows** — the missing bridge that makes a
 * Studio-authored `kind:'workflow'` capability actually render in the Hub.
 *
 * Like forms, `<mvk-workflow-renderer [formName]>` resolves a workflow purely by
 * name from `FormRegistry` (a `FormDef` whose `.workflow` is set). Nothing
 * previously compiled a catalog workflow body into one, so an authored workflow
 * showed "Workflow X is not registered." This service closes that gap exactly
 * like `CatalogFormSource` does for forms: GET the tenant's `kind:'workflow'`
 * capabilities, compile each `body.workflow.steps` into a `FormDef` via
 * `agenticWorkflow(...)`, register it tagged with a source, and re-hydrate over
 * the catalog SSE stream.
 */
import { Injectable, inject, signal } from '@angular/core';
import { FormRegistry, agenticWorkflow, type WorkflowStep } from '@infra-tools/agentic-ui';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';

const CATALOG_URL = environment.catalogBaseUrl;
const TENANT = environment.tenant;
const SOURCE = 'catalog-workflow';

interface CatalogWorkflowRow {
  readonly name: string;
  readonly body?: {
    description?: string;
    workflow?: { steps?: WorkflowStep[] };
    steps?: WorkflowStep[]; // legacy top-level shape
  };
}

/** Canonical steps: prefer `body.workflow.steps`, fall back to legacy `body.steps`. */
export function pickWorkflowSteps(body: CatalogWorkflowRow['body']): readonly WorkflowStep[] {
  return body?.workflow?.steps ?? body?.steps ?? [];
}

@Injectable({ providedIn: 'root' })
export class CatalogWorkflowSource {
  private readonly registry = inject(FormRegistry);
  private readonly auth = inject(AuthService);
  private stream?: EventSource;

  readonly count = signal(0);
  readonly error = signal<string | null>(null);

  /** Fetch `kind:'workflow'` capabilities for the tenant and (re)register them. */
  async hydrate(): Promise<void> {
    try {
      const url = `${CATALOG_URL}/v1/catalogs/${encodeURIComponent(TENANT)}/capabilities?kind=workflow`;
      const headers: Record<string, string> = { accept: 'application/json' };
      const token = this.auth.token();
      if (environment.authMode === 'oidc' && token) headers['authorization'] = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`catalog returned ${res.status}`);
      const { items } = (await res.json()) as { items: CatalogWorkflowRow[] };
      this.registry.removeBySource(SOURCE);
      let n = 0;
      for (const row of items) {
        const def = this.toDef(row);
        if (def) { this.registry.register(def); n++; }
      }
      this.count.set(n);
      if (n === items.length) this.error.set(null);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  /** Open the catalog SSE stream; re-hydrate on any workflow mutation. */
  startLiveSync(): void {
    if (this.stream) return;
    try {
      this.stream = new EventSource(`${CATALOG_URL}/v1/catalogs/${encodeURIComponent(TENANT)}/stream`);
      this.stream.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as { entityType?: string; kind?: string };
          if (data.entityType === 'workflow' || data.kind === 'workflow') void this.hydrate();
        } catch { /* ignore non-JSON keepalives */ }
      };
      this.stream.onerror = () => { /* browser auto-reconnects; ignore */ };
    } catch { /* SSE unavailable — the manual refresh covers it */ }
  }

  /** Compile one catalog workflow row → a runtime `FormDef` (with `.workflow`). */
  private toDef(row: CatalogWorkflowRow): Parameters<FormRegistry['register']>[0] | null {
    const steps = pickWorkflowSteps(row.body);
    if (!steps.length) return null; // agenticWorkflow requires >= 1 step
    try {
      const def = agenticWorkflow({
        name: row.name,
        description: row.body?.description ?? '',
        steps: [...steps],
        // A data-authored workflow can't carry a live completion handler; the
        // renderer walks steps and calls this on the terminal step.
        onComplete: async () => undefined,
      });
      return { ...def, source: SOURCE } as unknown as Parameters<FormRegistry['register']>[0];
    } catch (e) {
      // A malformed workflow (e.g. a dangling branch goto) must not break the
      // rest — skip it and surface the reason.
      this.error.set(`workflow "${row.name}": ${(e as Error).message}`);
      return null;
    }
  }
}
