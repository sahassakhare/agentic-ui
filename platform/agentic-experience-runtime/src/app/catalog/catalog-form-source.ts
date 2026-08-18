/**
 * The runtime "load half" for **Forms** — the missing bridge that makes a
 * Studio-authored `kind:'form'` capability actually render in the Hub.
 *
 * `<mvk-form-renderer [formName]>` resolves a form purely by name from
 * `FormRegistry`; nothing previously compiled a catalog form body into a
 * `FormDef`, so an authored form showed "Form X is not registered." This
 * service closes that gap the same way `CatalogExperienceSource` does for
 * experiences: GET the tenant's `kind:'form'` capabilities, compile each
 * `body.schema` (`fields[]` → a Zod schema; `actions[]` / legacy `submit`
 * string → a governed action bar) into a `FormDef` via `agenticForm(...)`,
 * register it tagged with a source, and re-hydrate over the catalog SSE stream.
 *
 * The `fields → Zod` mapper lives here (in the app, not the library) so it
 * costs nothing against the lib's FESM budget.
 */
import { Injectable, inject, signal } from '@angular/core';
import { FormRegistry, agenticForm, type FormActionDef } from '@infra-tools/agentic-ui';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { fieldsToZod, resolveActions, type CatalogFormField } from './catalog-form-compile';
import { ValidationRuleRegistry } from './validation-rule-registry';

const CATALOG_URL = environment.catalogBaseUrl;
const TENANT = environment.tenant;
const SOURCE = 'catalog-form'; // registry source tag → removeBySource on refresh

interface CatalogFormRow {
  readonly name: string;
  readonly body?: {
    description?: string;
    schema?: {
      fields?: readonly CatalogFormField[];
      /** New: authored action bar. */
      actions?: readonly FormActionDef[];
      /** Legacy: a single tool/usage-event target string. */
      submit?: string;
    };
  };
}

@Injectable({ providedIn: 'root' })
export class CatalogFormSource {
  private readonly registry = inject(FormRegistry);
  private readonly auth = inject(AuthService);
  private readonly rules = inject(ValidationRuleRegistry);
  private stream?: EventSource;

  readonly count = signal(0);
  readonly error = signal<string | null>(null);

  /** Fetch `kind:'form'` capabilities for the tenant and (re)register them. */
  async hydrate(): Promise<void> {
    try {
      const url = `${CATALOG_URL}/v1/catalogs/${encodeURIComponent(TENANT)}/capabilities?kind=form`;
      const headers: Record<string, string> = { accept: 'application/json' };
      const token = this.auth.token();
      if (environment.authMode === 'oidc' && token) headers['authorization'] = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`catalog returned ${res.status}`);
      const { items } = (await res.json()) as { items: CatalogFormRow[] };
      this.registry.removeBySource(SOURCE);
      let n = 0;
      for (const row of items) {
        try {
          this.registry.register(this.toDef(row));
          n++;
        } catch (e) {
          // One malformed form (e.g. an invalid action target) must not take
          // down the whole set — skip it and keep the rest renderable.
          this.error.set(`form "${row.name}": ${(e as Error).message}`);
        }
      }
      this.count.set(n);
      if (n === items.length) this.error.set(null);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  /** Open the catalog SSE stream; re-hydrate on any form mutation. */
  startLiveSync(): void {
    if (this.stream) return;
    try {
      this.stream = new EventSource(`${CATALOG_URL}/v1/catalogs/${encodeURIComponent(TENANT)}/stream`);
      this.stream.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as { entityType?: string; kind?: string };
          const k = data.entityType ?? data.kind;
          // Re-compile on form edits and on validation-rule edits (a field's
          // named validators must re-apply the updated rule).
          if (k === 'form' || k === 'validation') void this.hydrate();
        } catch { /* ignore non-JSON keepalives */ }
      };
      this.stream.onerror = () => { /* browser auto-reconnects; ignore */ };
    } catch { /* SSE unavailable — the manual refresh covers it */ }
  }

  /** Compile one catalog form row → a runtime `FormDef` via `agenticForm`. */
  private toDef(row: CatalogFormRow): Parameters<FormRegistry['register']>[0] {
    const schema = row.body?.schema ?? {};
    const fieldsSchema = fieldsToZod(schema.fields ?? [], this.rules.resolver());
    const actions = resolveActions(schema.actions, schema.submit);
    const def = agenticForm({
      name: row.name,
      description: row.body?.description ?? '',
      fieldsSchema,
      actions,
      // A form authored as data can't carry a live handler; the governed
      // behaviour is the action bar (tool/action buttons). Plain submit is a
      // no-op default — authors bind a `tool`/`action` button for real effects.
      submit: async () => undefined,
    });
    return { ...def, source: SOURCE } as unknown as Parameters<FormRegistry['register']>[0];
  }
}
