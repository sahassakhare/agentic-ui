/**
 * The runtime "load half" of author → govern → load → compose.
 *
 * Product owners author capabilities in Experience Studio; the catalog service
 * persists them per-tenant (approval, audit, scope). Each source below GETs the
 * tenant's rows, compiles each catalog `body` into the runtime shape the lib's
 * registries expect, registers it tagged with a `source` (so re-hydrate can
 * `removeBySource`), and re-hydrates live over the shared catalog SSE stream.
 *
 * Every source shares `CatalogClient` (HTTP + one pooled SSE stream) and is
 * decoupled from any host auth/config via `CATALOG_CONFIG` / `CATALOG_AUTH`.
 * The stream event carries `entityType:'capability'|'experience'` with no kind,
 * so a source re-hydrates on any capability (or experience) mutation.
 */
import { Injectable, inject, signal } from '@angular/core';
import {
  ExperienceRegistry, FormRegistry, DataSourceRegistry, ToolRegistry,
  PromptRegistry, SkillRegistry, NavigationRegistry,
  agenticForm, agenticWorkflow, agenticDataSource, agenticTool,
  agenticPrompt, agenticSkill, agenticNavigation,
  type WorkflowStep, type DataSourceDef, type ToolDef, type FormActionDef,
  type PromptDef, type SkillDef, type NavigationDef, type TokenSet,
} from '@infra-tools/agentic-ui';
import { z } from 'zod';
import { CatalogClient } from './catalog-client';
import { CATALOG_CONFIG } from './catalog-config';
import { ValidationRuleRegistry } from './validation-rule-registry';
import { compileRule } from './validation-compile';
import { DecisionRegistry } from './decision-registry';
import { evaluateDecision, type DecisionField, type DecisionRule, type DecisionTable, type HitPolicy } from './decision-eval';
import { fieldsToZod, fieldsToUi, resolveActions, type CatalogFormField } from './catalog-form-compile';
import { buildHttpAdapter, resolveHeaders, fillDeep, fillTemplate, type HttpQuery } from './catalog-http';

// ── Experiences → ExperienceRegistry ────────────────────────────────────────
interface CatalogExperienceRow {
  readonly name: string; readonly title: string; readonly goal: string;
  readonly version: string | null; readonly owner: string | null; readonly tags: readonly string[];
  readonly body: {
    intents?: string[]; requires?: { kind: string; name?: string; tag?: string; optional?: boolean }[];
    defaultLayout?: string; policies?: string[]; personas?: string[]; scopes?: string[];
  };
}

@Injectable({ providedIn: 'root' })
export class CatalogExperienceSource {
  private readonly client = inject(CatalogClient);
  private readonly registry = inject(ExperienceRegistry);
  private static readonly SOURCE = 'catalog';
  readonly count = signal(0);
  readonly error = signal<string | null>(null);

  async hydrate(): Promise<void> {
    try {
      const items = await this.client.listExperiences<CatalogExperienceRow>();
      this.registry.removeBySource(CatalogExperienceSource.SOURCE);
      for (const row of items) this.registry.register(this.toDef(row));
      this.count.set(items.length);
      this.error.set(null);
    } catch (e) { this.error.set((e as Error).message); }
  }

  startLiveSync(): void {
    this.client.onMutation((m) => { if (m.entityType === 'experience') void this.hydrate(); });
  }

  private toDef(row: CatalogExperienceRow): Parameters<ExperienceRegistry['register']>[0] {
    const b = row.body ?? {};
    return {
      name: row.name, title: row.title, goal: row.goal,
      intents: b.intents, requires: b.requires, defaultLayout: b.defaultLayout,
      policies: b.policies, personas: b.personas, requiredPermissions: b.scopes,
      version: row.version ?? undefined, approvalState: 'approved',
      tags: [...(row.tags ?? [])], owner: row.owner ?? undefined,
      source: CatalogExperienceSource.SOURCE,
    } as unknown as Parameters<ExperienceRegistry['register']>[0];
  }
}

// ── Validation → ValidationRuleRegistry (before forms) ───────────────────────
interface CatalogValidationRow { readonly name: string; readonly body?: { rule?: string; message?: string } }

@Injectable({ providedIn: 'root' })
export class CatalogValidationSource {
  private readonly client = inject(CatalogClient);
  private readonly rules = inject(ValidationRuleRegistry);
  readonly count = signal(0);
  readonly error = signal<string | null>(null);

  async hydrate(): Promise<void> {
    try {
      const items = await this.client.listByKind<CatalogValidationRow>('validation');
      this.rules.clear();
      for (const row of items) this.rules.set(row.name, compileRule(row.body?.rule, row.body?.message));
      this.count.set(items.length);
      this.error.set(null);
    } catch (e) { this.error.set((e as Error).message); }
  }

  startLiveSync(): void {
    this.client.onCapabilityKind('validation', () => void this.hydrate());
  }
}

// ── Forms → FormRegistry (resolved by name in <mvk-form-renderer [formName]>) ─
interface CatalogFormRow {
  readonly name: string;
  readonly body?: { description?: string; schema?: { fields?: readonly CatalogFormField[]; actions?: readonly FormActionDef[]; submit?: string } };
}

@Injectable({ providedIn: 'root' })
export class CatalogFormSource {
  private readonly client = inject(CatalogClient);
  private readonly registry = inject(FormRegistry);
  private readonly rules = inject(ValidationRuleRegistry);
  private static readonly SOURCE = 'catalog-form';
  readonly count = signal(0);
  readonly error = signal<string | null>(null);

  async hydrate(): Promise<void> {
    try {
      const items = await this.client.listByKind<CatalogFormRow>('form');
      this.registry.removeBySource(CatalogFormSource.SOURCE);
      let n = 0;
      for (const row of items) {
        try { this.registry.register(this.toDef(row)); n++; }
        catch (e) { this.error.set(`form "${row.name}": ${(e as Error).message}`); }
      }
      this.count.set(n);
      if (n === items.length) this.error.set(null);
    } catch (e) { this.error.set((e as Error).message); }
  }

  startLiveSync(): void {
    // A capability edit re-compiles forms (covers form AND validation-rule edits).
    this.client.onCapabilityKind('form', () => void this.hydrate());
  }

  private toDef(row: CatalogFormRow): Parameters<FormRegistry['register']>[0] {
    const schema = row.body?.schema ?? {};
    const fieldsSchema = fieldsToZod(schema.fields ?? [], this.rules.resolver());
    const actions = resolveActions(schema.actions, schema.submit);
    const def = agenticForm({
      name: row.name,
      description: row.body?.description ?? '',
      fieldsSchema,
      ui: fieldsToUi(schema.fields ?? []),
      actions,
      submit: async () => undefined,
    });
    return { ...def, source: CatalogFormSource.SOURCE } as unknown as Parameters<FormRegistry['register']>[0];
  }
}

// ── Workflows → FormRegistry (a FormDef whose `.workflow` is set) ─────────────
interface CatalogWorkflowRow {
  readonly name: string;
  readonly body?: { description?: string; workflow?: { steps?: WorkflowStep[] }; steps?: WorkflowStep[] };
}

@Injectable({ providedIn: 'root' })
export class CatalogWorkflowSource {
  private readonly client = inject(CatalogClient);
  private readonly registry = inject(FormRegistry);
  private static readonly SOURCE = 'catalog-workflow';
  readonly count = signal(0);
  readonly error = signal<string | null>(null);

  async hydrate(): Promise<void> {
    try {
      const items = await this.client.listByKind<CatalogWorkflowRow>('workflow');
      this.registry.removeBySource(CatalogWorkflowSource.SOURCE);
      let n = 0;
      for (const row of items) { const def = this.toDef(row); if (def) { this.registry.register(def); n++; } }
      this.count.set(n);
    } catch (e) { this.error.set((e as Error).message); }
  }

  startLiveSync(): void {
    this.client.onCapabilityKind('workflow', () => void this.hydrate());
  }

  private toDef(row: CatalogWorkflowRow): Parameters<FormRegistry['register']>[0] | null {
    const steps = row.body?.workflow?.steps ?? row.body?.steps ?? [];
    if (!steps.length) return null;
    try {
      const def = agenticWorkflow({ name: row.name, description: row.body?.description ?? '', steps: [...steps], onComplete: async () => undefined });
      return { ...def, source: CatalogWorkflowSource.SOURCE } as unknown as Parameters<FormRegistry['register']>[0];
    } catch (e) { this.error.set(`workflow "${row.name}": ${(e as Error).message}`); return null; }
  }
}

// ── Themes → a name→TokenSet signal map (read by the shell) ──────────────────
interface CatalogThemeRow { readonly name: string; readonly body?: Partial<TokenSet> }

@Injectable({ providedIn: 'root' })
export class CatalogThemeSource {
  private readonly client = inject(CatalogClient);
  readonly themes = signal<ReadonlyMap<string, TokenSet>>(new Map());
  readonly error = signal<string | null>(null);

  get(name: string | undefined | null): TokenSet | undefined {
    return name ? this.themes().get(name) : undefined;
  }

  async hydrate(): Promise<void> {
    try {
      const items = await this.client.listByKind<CatalogThemeRow>('theme');
      const map = new Map<string, TokenSet>();
      for (const row of items) { const set = toTokenSet(row.body); if (set) map.set(row.name, set); }
      this.themes.set(map);
      this.error.set(null);
    } catch (e) { this.error.set((e as Error).message); }
  }

  startLiveSync(): void {
    this.client.onCapabilityKind('theme', () => void this.hydrate());
  }
}

function toTokenSet(body: Partial<TokenSet> | undefined): TokenSet | null {
  if (!body || typeof body !== 'object' || !body.base || typeof body.base !== 'object') return null;
  return { title: body.title, base: body.base, dark: body.dark };
}

// ── Data sources → DataSourceRegistry (fetch-backed, from a declared endpoint) ─
interface CatalogDataSourceRow {
  readonly name: string;
  readonly body?: { description?: string; endpoint?: string; method?: string; headers?: Record<string, string> | string };
}

@Injectable({ providedIn: 'root' })
export class CatalogDataSource {
  private readonly client = inject(CatalogClient);
  private readonly cfg = inject(CATALOG_CONFIG);
  private readonly registry = inject(DataSourceRegistry);
  private static readonly SOURCE = 'catalog-datasource';
  readonly count = signal(0);
  readonly error = signal<string | null>(null);

  async hydrate(): Promise<void> {
    try {
      const items = await this.client.listByKind<CatalogDataSourceRow>('datasource');
      this.registry.removeBySource(CatalogDataSource.SOURCE);
      let n = 0;
      for (const row of items) {
        const def = this.toDef(row);
        if (!def) continue;
        try { this.registry.register(def); n++; }
        catch (e) { this.error.set(`data source "${row.name}": ${(e as Error).message}`); }
      }
      this.count.set(n);
    } catch (e) { this.error.set((e as Error).message); }
  }

  startLiveSync(): void {
    this.client.onCapabilityKind('datasource', () => void this.hydrate());
  }

  private toDef(row: CatalogDataSourceRow): DataSourceDef | null {
    const endpoint = row.body?.endpoint?.trim();
    if (!endpoint) return null;
    const adapter = buildHttpAdapter({ endpoint, method: row.body?.method, headers: resolveHeaders(row.body?.headers, this.cfg.dataSourceSecrets) });
    const def = agenticDataSource({ name: row.name, kind: 'rest', adapter: (q) => adapter(q as HttpQuery) });
    return { ...def, source: CatalogDataSource.SOURCE } as unknown as DataSourceDef;
  }
}

// ── Tools → ToolRegistry (executable; bind a data source, fill {arg}) ─────────
interface CatalogToolRow {
  readonly name: string;
  readonly body?: { description?: string; inputs?: readonly string[]; dataSource?: string; method?: string; path?: string; query?: Record<string, unknown>; body?: unknown };
}

@Injectable({ providedIn: 'root' })
export class CatalogToolSource {
  private readonly client = inject(CatalogClient);
  private readonly tools = inject(ToolRegistry);
  private readonly dataSources = inject(DataSourceRegistry);
  private static readonly SOURCE = 'catalog-tool';
  readonly count = signal(0);
  readonly error = signal<string | null>(null);

  async hydrate(): Promise<void> {
    try {
      const items = await this.client.listByKind<CatalogToolRow>('tool');
      this.tools.removeBySource(CatalogToolSource.SOURCE);
      let n = 0;
      for (const row of items) {
        const def = this.toDef(row);
        if (!def) continue;
        try { this.tools.register(def); n++; }
        catch (e) { this.error.set(`tool "${row.name}": ${(e as Error).message}`); }
      }
      this.count.set(n);
    } catch (e) { this.error.set((e as Error).message); }
  }

  startLiveSync(): void {
    this.client.onCapabilityKind('tool', () => void this.hydrate());
  }

  private toDef(row: CatalogToolRow): ToolDef | null {
    const dataSource = row.body?.dataSource?.trim();
    if (!dataSource) return null;
    const { method, path, query, body } = row.body ?? {};
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const input of row.body?.inputs ?? []) shape[input] = z.any().optional();
    const dataSources = this.dataSources;
    const def = agenticTool({
      name: row.name,
      description: row.body?.description ?? `Call the ${dataSource} data source`,
      schema: z.object(shape).passthrough(),
      handler: async (args: Record<string, unknown>) => {
        const ds = dataSources.get(dataSource);
        if (!ds) throw new Error(`data source "${dataSource}" is not registered`);
        const a = args ?? {};
        const q: HttpQuery = {
          path: path ? fillTemplate(path, a, true) : undefined,
          method,
          query: query ? (fillDeep(query, a) as Record<string, unknown>) : undefined,
          body: body !== undefined ? fillDeep(body, a) : undefined,
        };
        return ds.adapter(q);
      },
    });
    return { ...def, source: CatalogToolSource.SOURCE } as unknown as ToolDef;
  }
}

// ── Prompts → PromptRegistry ─────────────────────────────────────────────────
interface CatalogPromptRow {
  readonly name: string;
  readonly body?: { template?: string; description?: string; variables?: readonly string[]; model?: string; version?: string };
}

@Injectable({ providedIn: 'root' })
export class CatalogPromptSource {
  private readonly client = inject(CatalogClient);
  private readonly registry = inject(PromptRegistry);
  private static readonly SOURCE = 'catalog-prompt';
  readonly count = signal(0);
  readonly error = signal<string | null>(null);

  async hydrate(): Promise<void> {
    try {
      const items = await this.client.listByKind<CatalogPromptRow>('prompt');
      this.registry.removeBySource(CatalogPromptSource.SOURCE);
      let n = 0;
      for (const row of items) {
        try { this.registry.register(this.toDef(row)); n++; }
        catch (e) { this.error.set(`prompt "${row.name}": ${(e as Error).message}`); }
      }
      this.count.set(n);
      this.error.set(null);
    } catch (e) { this.error.set((e as Error).message); }
  }

  startLiveSync(): void {
    this.client.onCapabilityKind('prompt', () => void this.hydrate());
  }

  private toDef(row: CatalogPromptRow): PromptDef {
    const def = agenticPrompt({
      name: row.name, template: row.body?.template ?? '', description: row.body?.description,
      variables: row.body?.variables, model: row.body?.model, version: row.body?.version,
    });
    return { ...def, source: CatalogPromptSource.SOURCE } as unknown as PromptDef;
  }
}

// ── Skills → SkillRegistry ───────────────────────────────────────────────────
interface CatalogSkillRow {
  readonly name: string;
  readonly body?: { description?: string; tools?: readonly string[]; prompt?: string; version?: string };
}

@Injectable({ providedIn: 'root' })
export class CatalogSkillSource {
  private readonly client = inject(CatalogClient);
  private readonly registry = inject(SkillRegistry);
  private static readonly SOURCE = 'catalog-skill';
  readonly count = signal(0);
  readonly error = signal<string | null>(null);

  async hydrate(): Promise<void> {
    try {
      const items = await this.client.listByKind<CatalogSkillRow>('skill');
      this.registry.removeBySource(CatalogSkillSource.SOURCE);
      let n = 0;
      for (const row of items) {
        if (!row.body?.tools?.length) continue; // agenticSkill requires >= 1 tool
        try { this.registry.register(this.toDef(row)); n++; }
        catch (e) { this.error.set(`skill "${row.name}": ${(e as Error).message}`); }
      }
      this.count.set(n);
      this.error.set(null);
    } catch (e) { this.error.set((e as Error).message); }
  }

  startLiveSync(): void {
    this.client.onCapabilityKind('skill', () => void this.hydrate());
  }

  private toDef(row: CatalogSkillRow): SkillDef {
    const def = agenticSkill({
      name: row.name, description: row.body?.description ?? '', tools: row.body?.tools ?? [],
      prompt: row.body?.prompt, version: row.body?.version,
    });
    return { ...def, source: CatalogSkillSource.SOURCE } as unknown as SkillDef;
  }
}

// ── Navigation → NavigationRegistry (coexists with the application menu) ──────
interface CatalogNavigationRow {
  readonly name: string;
  readonly body?: { title?: string; route?: string; icon?: string; order?: number; parent?: string; external?: boolean };
}

@Injectable({ providedIn: 'root' })
export class CatalogNavigationSource {
  private readonly client = inject(CatalogClient);
  private readonly registry = inject(NavigationRegistry);
  private static readonly SOURCE = 'catalog-navigation';
  readonly count = signal(0);
  readonly error = signal<string | null>(null);

  async hydrate(): Promise<void> {
    try {
      const items = await this.client.listByKind<CatalogNavigationRow>('navigation');
      this.registry.removeBySource(CatalogNavigationSource.SOURCE);
      let n = 0;
      for (const row of items) {
        try { this.registry.register(this.toDef(row)); n++; }
        catch (e) { this.error.set(`navigation "${row.name}": ${(e as Error).message}`); }
      }
      this.count.set(n);
      this.error.set(null);
    } catch (e) { this.error.set((e as Error).message); }
  }

  startLiveSync(): void {
    this.client.onCapabilityKind('navigation', () => void this.hydrate());
  }

  private toDef(row: CatalogNavigationRow): NavigationDef {
    const def = agenticNavigation({
      name: row.name, title: row.body?.title ?? row.name, route: row.body?.route ?? '/',
      icon: row.body?.icon, order: row.body?.order, parent: row.body?.parent, external: row.body?.external,
    });
    return { ...def, source: CatalogNavigationSource.SOURCE } as unknown as NavigationDef;
  }
}

// ── Decisions → DecisionRegistry + an executable tool per decision ────────────
interface CatalogDecisionRow {
  readonly name: string;
  readonly body?: { description?: string; hitPolicy?: string; inputs?: DecisionField[]; outputs?: DecisionField[]; rules?: DecisionRule[] };
}

@Injectable({ providedIn: 'root' })
export class CatalogDecisionSource {
  private readonly client = inject(CatalogClient);
  private readonly decisions = inject(DecisionRegistry);
  private readonly tools = inject(ToolRegistry);
  private static readonly SOURCE = 'catalog-decision';
  readonly count = signal(0);
  readonly error = signal<string | null>(null);

  async hydrate(): Promise<void> {
    try {
      const items = await this.client.listByKind<CatalogDecisionRow>('decision');
      this.decisions.clear();
      this.tools.removeBySource(CatalogDecisionSource.SOURCE);
      let n = 0;
      for (const row of items) {
        const table = this.toTable(row);
        this.decisions.set({ name: row.name, description: row.body?.description, table });
        try { this.tools.register(this.toTool(row, table)); n++; }
        catch (e) { this.error.set(`decision "${row.name}": ${(e as Error).message}`); }
      }
      this.count.set(n);
      this.error.set(null);
    } catch (e) { this.error.set((e as Error).message); }
  }

  startLiveSync(): void {
    this.client.onCapabilityKind('decision', () => void this.hydrate());
  }

  private toTable(row: CatalogDecisionRow): DecisionTable {
    return {
      inputs: row.body?.inputs ?? [], outputs: row.body?.outputs ?? [], rules: row.body?.rules ?? [],
      hitPolicy: (row.body?.hitPolicy as HitPolicy) ?? 'first',
    };
  }

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
    return { ...def, source: CatalogDecisionSource.SOURCE } as unknown as ToolDef;
  }
}

function zodFor(type: DecisionField['type']): z.ZodTypeAny {
  switch (type) {
    case 'number': return z.number();
    case 'boolean': return z.boolean();
    default: return z.string(); // string | date
  }
}
