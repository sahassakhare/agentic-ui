/**
 * Live Test panel for `tool` and `datasource` capabilities — the HTTP analogue
 * of the Decision Designer's evaluator panel. It compiles the authored,
 * declarative row into a real request using the SAME helpers the runtime uses
 * (`@infra-tools/agentic-ui/catalog`: buildHttpAdapter / resolveHeaders /
 * fillTemplate / fillDeep) and invokes it from the browser, so an author can
 * verify an endpoint or a tool's `{arg}` templates before publishing.
 *
 * NOTE: the request runs from the browser, so the target must allow CORS — the
 * same constraint the runtime tool execution has (it also fetches client-side).
 * Secrets referenced as `${NAME}` in headers are supplied per-test (never stored).
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { buildHttpAdapter, resolveHeaders, fillTemplate, fillDeep, joinUrl, type HttpQuery } from '@infra-tools/agentic-ui/catalog';
import { CapabilityCatalogService, type Capability } from '../services/capability-catalog.service';

export interface TestRunnerData { readonly capability: Capability; readonly kind: 'tool' | 'datasource'; }

interface RunResult {
  readonly ok: boolean;
  readonly line: string;          // METHOD URL
  readonly ms: number;
  readonly response?: unknown;
  readonly error?: string;
}

@Component({
  selector: 'aes-test-runner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>Test {{ data.kind }} · <code>{{ data.capability.name }}</code></h2>
    <mat-dialog-content>
      @if (!testable()) {
        <p class="muted">This {{ data.kind }} isn't HTTP-callable{{ data.kind === 'tool' ? ' (no bound data source)' : ' (no endpoint — non-HTTP connector)' }}, so there's nothing to invoke.</p>
      } @else {
        @if (data.kind === 'tool') {
          <p class="muted sm">Calls data source <code>{{ toolBody().dataSource }}</code> — fill the tool's inputs.</p>
          @for (a of argNames(); track a) {
            <label class="fld"><span>{{ a }}</span><input [ngModel]="args()[a] || ''" (ngModelChange)="setArg(a, $event)" placeholder="value" /></label>
          }
        } @else {
          <label class="fld"><span>Path (optional)</span><input [ngModel]="path()" (ngModelChange)="path.set($event)" placeholder="/customers/123" /></label>
          <label class="fld"><span>Method override</span><input [ngModel]="method()" (ngModelChange)="method.set($event)" [placeholder]="dsBody().method || 'GET'" /></label>
          <label class="fld"><span>Query (JSON)</span><textarea rows="2" [ngModel]="queryJson()" (ngModelChange)="queryJson.set($event)" placeholder='{ "q": "test" }'></textarea></label>
          <label class="fld"><span>Body (JSON)</span><textarea rows="2" [ngModel]="bodyJson()" (ngModelChange)="bodyJson.set($event)" placeholder='{ "name": "Ada" }'></textarea></label>
        }
        @if (secretNames().length) {
          <label class="fld"><span>Secrets (JSON) — for <code>{{ '$' + '{NAME}' }}</code> header refs: {{ secretNames().join(', ') }}</span>
            <textarea rows="2" [ngModel]="secretsJson()" (ngModelChange)="secretsJson.set($event)" placeholder='{ "CRM_TOKEN": "..." }'></textarea></label>
        }
        @if (result(); as r) {
          <div class="result" [class.bad]="!r.ok">
            <div class="rline"><span class="badge" [class.bad]="!r.ok">{{ r.ok ? 'OK' : 'ERROR' }}</span> <code>{{ r.line }}</code> <span class="ms">{{ r.ms }}ms</span></div>
            @if (r.error) { <pre class="out err">{{ r.error }}</pre> } @else { <pre class="out">{{ pretty(r.response) }}</pre> }
          </div>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close>Close</button>
      @if (testable()) { <button matButton="filled" (click)="run()" [disabled]="running()">{{ running() ? 'Running…' : 'Run →' }}</button> }
    </mat-dialog-actions>
  `,
  styles: [`
    :host { display:block; min-width: 460px; max-width: 560px; }
    .muted { opacity:.7; } .sm { font-size:12.5px; }
    .fld { display:flex; flex-direction:column; gap:4px; margin:10px 0; font-size:12.5px; }
    .fld span { opacity:.75; } .fld input, .fld textarea { font:inherit; font-size:13px; padding:7px 9px; border:1px solid rgba(120,120,140,.3); border-radius:7px; background:transparent; color:inherit; }
    .fld textarea { font-family:ui-monospace,Menlo,monospace; }
    .result { margin-top:12px; border:1px solid rgba(120,120,140,.24); border-radius:9px; padding:10px; }
    .result.bad { border-color:rgba(192,57,43,.4); }
    .rline { display:flex; align-items:center; gap:8px; font-size:12.5px; } .rline .ms { margin-left:auto; opacity:.5; }
    .badge { font-size:11px; font-weight:700; padding:2px 7px; border-radius:20px; background:rgba(10,125,50,.14); color:#0a7d32; } .badge.bad { background:rgba(192,57,43,.14); color:#c0392b; }
    .out { margin:8px 0 0; max-height:260px; overflow:auto; background:rgba(120,120,140,.07); border-radius:7px; padding:9px; font-size:12px; white-space:pre-wrap; word-break:break-word; } .out.err { color:#c0392b; }
    code { font-family:ui-monospace,Menlo,monospace; }
  `],
})
export class TestRunnerDialogComponent {
  protected readonly data = inject<TestRunnerData>(MAT_DIALOG_DATA);
  private readonly caps = inject(CapabilityCatalogService);
  private readonly ref = inject(MatDialogRef<TestRunnerDialogComponent>);

  protected readonly args = signal<Record<string, string>>({});
  protected readonly path = signal('');
  protected readonly method = signal('');
  protected readonly queryJson = signal('');
  protected readonly bodyJson = signal('');
  protected readonly secretsJson = signal('');
  protected readonly running = signal(false);
  protected readonly result = signal<RunResult | null>(null);

  protected toolBody() { return this.data.capability.body as { dataSource?: string; method?: string; path?: string; query?: unknown; body?: unknown; inputs?: string[] }; }
  protected dsBody() { return this.data.capability.body as { endpoint?: string; method?: string; headers?: Record<string, string> | string; }; }

  protected readonly argNames = computed(() => (this.toolBody().inputs ?? []) as string[]);
  protected readonly testable = computed(() =>
    this.data.kind === 'datasource' ? !!this.dsBody().endpoint?.trim() : !!this.toolBody().dataSource?.trim());

  /** `${NAME}` refs found in the datasource's (or the bound datasource's) headers. */
  protected readonly secretNames = signal<string[]>([]);

  constructor() {
    if (this.data.kind === 'datasource') this.secretNames.set(refsIn(this.dsBody().headers));
    else void this.loadToolSecretRefs();
  }

  protected setArg(a: string, v: string): void { this.args.update((m) => ({ ...m, [a]: v })); }

  private async loadToolSecretRefs(): Promise<void> {
    const ds = await this.resolveDataSource().catch(() => null);
    if (ds) this.secretNames.set(refsIn((ds.body as { headers?: Record<string, string> | string }).headers));
  }

  private async resolveDataSource(): Promise<Capability | null> {
    const name = this.toolBody().dataSource?.trim();
    if (!name) return null;
    const res = await firstValueFrom(this.caps.listByKind('datasource'));
    return res.items.find((c) => c.name === name) ?? null;
  }

  async run(): Promise<void> {
    this.running.set(true); this.result.set(null);
    const started = performance.now();
    try {
      const secrets = this.parse(this.secretsJson()) as Record<string, string> | undefined;
      let endpoint: string, dfltMethod: string | undefined, headers: Record<string, string | undefined>, q: HttpQuery, line: string;

      if (this.data.kind === 'datasource') {
        const b = this.dsBody();
        endpoint = b.endpoint!.trim(); dfltMethod = b.method;
        headers = resolveHeaders(b.headers, secrets ?? {});
        q = { path: this.path() || undefined, method: this.method() || undefined, query: this.parse(this.queryJson()) as Record<string, unknown>, body: this.parse(this.bodyJson()) };
        line = `${(q.method || dfltMethod || 'GET').toUpperCase()} ${joinUrl(endpoint, q.path)}`;
      } else {
        const ds = await this.resolveDataSource();
        if (!ds) throw new Error(`Data source "${this.toolBody().dataSource}" not found in the catalog.`);
        const db = ds.body as { endpoint?: string; method?: string; headers?: Record<string, string> | string };
        if (!db.endpoint?.trim()) throw new Error(`Data source "${ds.name}" has no endpoint (non-HTTP).`);
        endpoint = db.endpoint.trim(); dfltMethod = db.method;
        headers = resolveHeaders(db.headers, secrets ?? {});
        const t = this.toolBody(); const a = this.args();
        q = {
          path: t.path ? fillTemplate(t.path, a, true) : undefined,
          method: t.method,
          query: t.query ? (fillDeep(t.query, a) as Record<string, unknown>) : undefined,
          body: t.body !== undefined ? fillDeep(t.body, a) : undefined,
        };
        line = `${(t.method || dfltMethod || 'GET').toUpperCase()} ${joinUrl(endpoint, q.path)}`;
      }

      const adapter = buildHttpAdapter({ endpoint, method: dfltMethod, headers: headers as Record<string, string> });
      const response = await adapter(q);
      this.result.set({ ok: true, line, ms: Math.round(performance.now() - started), response });
    } catch (e) {
      this.result.set({ ok: false, line: '—', ms: Math.round(performance.now() - started), error: (e as Error).message });
    } finally {
      this.running.set(false);
    }
  }

  protected pretty(v: unknown): string { try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2); } catch { return String(v); } }

  /** Parse an optional JSON field; empty → undefined; invalid → throws. */
  private parse(s: string): unknown {
    const t = s.trim();
    if (!t) return undefined;
    try { return JSON.parse(t); } catch { throw new Error(`Invalid JSON: ${t.slice(0, 40)}…`); }
  }
}

/** Extract `${NAME}` reference names from a headers value (object or JSON string). */
function refsIn(headers: Record<string, string> | string | undefined): string[] {
  const s = typeof headers === 'string' ? headers : JSON.stringify(headers ?? {});
  const out = new Set<string>();
  for (const m of s.matchAll(/\$\{(\w+)\}/g)) out.add(m[1]);
  return [...out];
}
