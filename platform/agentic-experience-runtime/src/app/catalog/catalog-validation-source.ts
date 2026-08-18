/**
 * The runtime "load half" for **Validation** — compiles Studio-authored
 * `kind:'validation'` rows into `ValidationRuleRegistry` so a form field that
 * references a rule by name (`validators: ["max-500"]`) actually enforces it.
 * Mirrors `CatalogFormSource`; re-hydrates over catalog SSE.
 */
import { Injectable, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { ValidationRuleRegistry } from './validation-rule-registry';
import { compileRule } from './validation-compile';

const CATALOG_URL = environment.catalogBaseUrl;
const TENANT = environment.tenant;

interface CatalogValidationRow {
  readonly name: string;
  readonly body?: { rule?: string; message?: string; async?: boolean };
}

@Injectable({ providedIn: 'root' })
export class CatalogValidationSource {
  private readonly rules = inject(ValidationRuleRegistry);
  private readonly auth = inject(AuthService);
  private stream?: EventSource;

  readonly count = signal(0);
  readonly error = signal<string | null>(null);

  async hydrate(): Promise<void> {
    try {
      const url = `${CATALOG_URL}/v1/catalogs/${encodeURIComponent(TENANT)}/capabilities?kind=validation`;
      const headers: Record<string, string> = { accept: 'application/json' };
      const token = this.auth.token();
      if (environment.authMode === 'oidc' && token) headers['authorization'] = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`catalog returned ${res.status}`);
      const { items } = (await res.json()) as { items: CatalogValidationRow[] };
      this.rules.clear();
      for (const row of items) this.rules.set(row.name, compileRule(row.body?.rule, row.body?.message));
      this.count.set(items.length);
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
          if (d.entityType === 'validation' || d.kind === 'validation') void this.hydrate();
        } catch { /* ignore keepalives */ }
      };
      this.stream.onerror = () => { /* browser auto-reconnects */ };
    } catch { /* SSE unavailable */ }
  }
}
