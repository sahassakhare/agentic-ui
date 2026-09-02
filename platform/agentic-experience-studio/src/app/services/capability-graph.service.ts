import { Injectable, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { CapabilityCatalogService, type Capability } from './capability-catalog.service';

/** A reference from one capability to another. `exists=false` = an unmet reference. */
export interface CapRef { kind: string; name: string; exists: boolean; }
export interface Usage {
  /** Capabilities this one is composed of (references that resolve). */
  readonly uses: readonly CapRef[];
  /** Capabilities that reference this one. */
  readonly usedBy: readonly CapRef[];
  /** References that point at nothing defined — a page/component/tool that isn't in the catalog. */
  readonly unmet: readonly CapRef[];
}

/** Kinds fetched to build the graph — the composites plus everything they can target. */
const GRAPH_KINDS = [
  'application', 'page', 'form', 'workflow', 'decision', 'experience',
  'component', 'tool', 'datasource', 'validation', 'action', 'skill', 'navigation', 'dashboard', 'prompt',
];

const EMPTY: Usage = { uses: [], usedBy: [], unmet: [] };

/**
 * Builds the capability dependency graph from the **implicit** references in each
 * catalog body — application→pages, page→surfaces, form→components/validators/
 * data-sources/tools, workflow→components/decisions, skill→tools, tool→data-source
 * — and inverts it so any capability can show what it *uses* (each labeled by
 * kind), what *uses it*, and which references are *unmet* (undefined).
 */
@Injectable({ providedIn: 'root' })
export class CapabilityGraphService {
  private readonly catalog = inject(CapabilityCatalogService);
  private readonly byKey = new Map<string, Capability>();      // `kind:name` → cap
  private readonly byName = new Map<string, Capability[]>();    // name → caps (any kind)
  private readonly usesMap = new Map<string, CapRef[]>();       // `kind:name` → resolved refs
  private readonly usedByMap = new Map<string, CapRef[]>();
  private appNames: readonly string[] = [];                     // application capability names, for reverse lookup

  readonly loaded = signal(false);
  readonly version = signal(0);   // bump to notify views after a (re)build

  /** Fetch every graph kind and (re)build. Safe to call repeatedly. */
  load(): void {
    forkJoin(Object.fromEntries(GRAPH_KINDS.map((k) => [k, this.catalog.listByKind(k)]))).subscribe({
      next: (res) => { this.build(Object.values(res).flatMap((r) => r.items)); },
      error: () => { /* leave prior graph */ },
    });
  }

  /** Memoized transitive-membership sets, invalidated when the graph rebuilds. */
  private readonly membersCache = new Map<string, ReadonlySet<string>>();
  private membersCacheVersion = -1;

  /**
   * Every capability an application transitively composes — the forward closure
   * from `application:<name>` over the uses-graph (app → pages → surfaces →
   * their components/tools/validators/decisions/…), returned as a set of
   * `kind:name` keys and INCLUDING the application node itself. Used to filter a
   * category list to one application. Memoized per app until the next rebuild.
   */
  membersOf(appName: string): ReadonlySet<string> {
    this.version(); // establish a reactive dependency on (re)builds
    if (this.membersCacheVersion !== this.version()) { this.membersCache.clear(); this.membersCacheVersion = this.version(); }
    const hit = this.membersCache.get(appName);
    if (hit) return hit;
    const seen = new Set<string>();
    const stack = [key('application', appName)];
    while (stack.length) {
      const k = stack.pop()!;
      if (seen.has(k)) continue;
      seen.add(k);
      for (const r of this.usesMap.get(k) ?? []) if (r.exists) stack.push(key(r.kind, r.name));
    }
    this.membersCache.set(appName, seen);
    return seen;
  }

  /** Application names that transitively compose this capability (reverse of {@link membersOf}). */
  appsUsing(cap: Pick<Capability, 'kind' | 'name'>): string[] {
    this.version(); // reactive on rebuilds
    const k = key(cap.kind, cap.name);
    return this.appNames.filter((a) => a !== cap.name && this.membersOf(a).has(k));
  }

  usage(cap: Pick<Capability, 'kind' | 'name'>): Usage {
    const uses = this.usesMap.get(key(cap.kind, cap.name));
    if (!uses) return EMPTY;
    return {
      uses: uses.filter((r) => r.exists),
      usedBy: this.usedByMap.get(key(cap.kind, cap.name)) ?? [],
      unmet: uses.filter((r) => !r.exists),
    };
  }

  private build(caps: Capability[]): void {
    this.byKey.clear(); this.byName.clear(); this.usesMap.clear(); this.usedByMap.clear();
    this.appNames = caps.filter((c) => c.kind === 'application').map((c) => c.name);
    for (const c of caps) {
      this.byKey.set(key(c.kind, c.name), c);
      const list = this.byName.get(c.name) ?? [];
      list.push(c); this.byName.set(c.name, list);
    }
    for (const c of caps) {
      const refs = extractRefs(c).map((r) => this.resolve(r));
      this.usesMap.set(key(c.kind, c.name), refs);
      for (const r of refs) {
        if (!r.exists) continue;
        const k = key(r.kind, r.name);
        const back = this.usedByMap.get(k) ?? [];
        if (!back.some((b) => b.kind === c.kind && b.name === c.name)) back.push({ kind: c.kind, name: c.name, exists: true });
        this.usedByMap.set(k, back);
      }
    }
    this.loaded.set(true);
    this.version.update((v) => v + 1);
  }

  /** Resolve a raw {kind,name} to the real capability: exact kind, else any kind by name, else unmet. */
  private resolve(r: { kind: string; name: string }): CapRef {
    if (this.byKey.has(key(r.kind, r.name))) return { ...r, exists: true };
    const any = this.byName.get(r.name)?.[0];
    if (any) return { kind: any.kind, name: r.name, exists: true };  // fix a wrong kind hint
    return { ...r, exists: false };
  }
}

function key(kind: string, name: string): string { return `${kind}:${name}`; }

/** Pull the {kind,name} references out of one capability's body (implicit deps). */
function extractRefs(c: Capability): { kind: string; name: string }[] {
  const b = (c.body ?? {}) as Record<string, unknown>;
  const out: { kind: string; name: string }[] = [];
  const push = (kind: string, name: unknown) => { if (typeof name === 'string' && name.trim()) out.push({ kind, name: name.trim() }); };

  switch (c.kind) {
    case 'application': {
      for (const n of (b['nav'] as { page?: string }[] | undefined) ?? []) push('page', n?.page);
      for (const m of (b['menu'] as { target?: { kind?: string; name?: string } }[] | undefined) ?? []) push(m?.target?.kind ?? 'page', m?.target?.name);
      push('page', b['master']);
      break;
    }
    case 'page': {
      const regions = (b['regions'] as Record<string, { kind?: string; name?: string }[]> | undefined) ?? {};
      for (const list of Object.values(regions)) for (const s of list ?? []) push(s?.kind ?? 'component', s?.name);
      break;
    }
    case 'form': {
      const schema = (b['schema'] as Record<string, unknown> | undefined) ?? {};
      for (const f of (schema['fields'] as { widget?: string; source?: string; validators?: string[] }[] | undefined) ?? []) {
        push('component', f?.widget);
        push('datasource', f?.source);               // may resolve to a tool — handled by name lookup
        for (const v of f?.validators ?? []) push('validation', v);
      }
      for (const a of (schema['actions'] as { kind?: string; tool?: string; action?: string }[] | undefined) ?? []) {
        push('tool', a?.tool); push('action', a?.action);
      }
      const submit = schema['submit'];
      if (typeof submit === 'string' && submit && submit !== 'usage-event') push('tool', submit);
      break;
    }
    case 'workflow': {
      const wf = (b['workflow'] as { steps?: unknown[] } | undefined) ?? b;
      for (const st of (wf['steps'] as { widget?: string; next?: unknown }[] | undefined) ?? []) {
        push('component', st?.widget);
        const next = st?.next as { decision?: string } | undefined;
        if (next && typeof next === 'object' && typeof next.decision === 'string') push('decision', next.decision);
      }
      break;
    }
    case 'skill': for (const t of (b['tools'] as string[] | undefined) ?? []) push('tool', t); break;
    case 'tool': push('datasource', b['dataSource']); break;
    case 'decision': break; // referenced, references nothing
    default: break;
  }
  return out;
}
