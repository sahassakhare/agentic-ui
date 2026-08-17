/**
 * Loads the governed **Application** (a `kind: 'application'` capability authored in
 * the Experience Studio) and turns it into the runtime app shell's structure:
 * a title, an assistant config, and a navigation menu whose entries bind to
 * approved experiences/dashboards.
 *
 * This is what makes the whole app "driven by the Studio": the shell's menu,
 * title and assistant are not hardcoded — they come from one governed catalog
 * capability, re-hydrated live over the catalog SSE stream.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationRegistry, type NavigationDef } from '@infra-tools/agentic-ui';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';

const CATALOG_URL = environment.catalogBaseUrl;
const TENANT = environment.tenant;
// A valid `CapabilitySource` (external:*) so the whole menu can be cleared with
// removeBySource() on each re-hydrate.
const NAV_SOURCE = 'external:application' as const;

/** A surface can be any renderable capability kind (see SurfaceHost). */
export type SurfaceKind = 'experience' | 'dashboard' | 'form' | 'workflow' | 'component' | 'layout' | 'mfe';
export interface SurfaceTarget {
  readonly kind: SurfaceKind;
  readonly name: string;
  /** Props passed to component/mfe surfaces (e.g. a logo's src, a footer's links). */
  readonly props?: Readonly<Record<string, unknown>>;
}

export interface AppMenuEntry {
  readonly id: string;
  readonly title: string;
  readonly order?: number;
  readonly icon?: string;
  readonly target: SurfaceTarget;
}

/** One entry in the application's route tree: a URL path that renders a Page. */
export interface NavEntry {
  readonly title: string;
  readonly path: string;      // route segment, e.g. 'home' | 'expenses'
  readonly page: string;      // a kind:'page' capability name
  readonly icon?: string;
  readonly order?: number;
  readonly personas?: readonly string[];   // if set, only these personas see this entry
  readonly children?: readonly NavEntry[];
}

/** A nav entry flattened to its full URL path (for routing + resolution). */
export interface FlatNavEntry { readonly title: string; readonly fullPath: string; readonly page: string; readonly depth: number; readonly icon?: string }

/** Flatten a nav tree into full-path entries: `/reports`, `/reports/monthly`, … */
export function flattenNav(entries: readonly NavEntry[], base = '', depth = 0): FlatNavEntry[] {
  const out: FlatNavEntry[] = [];
  for (const e of entries) {
    const fullPath = base ? `${base}/${e.path}` : e.path;
    out.push({ title: e.title, fullPath, page: e.page, depth, icon: e.icon });
    if (e.children?.length) out.push(...flattenNav(e.children, fullPath, depth + 1));
  }
  return out;
}
export interface AppAssistant {
  readonly backend?: string;
  readonly enabled?: boolean;
  readonly greeting?: string;
}
export interface ApplicationDef {
  readonly name: string;
  readonly title: string;
  readonly description?: string;
  readonly master?: string;          // a kind:'master' capability name (app shell)
  readonly assistant?: AppAssistant;
  readonly menu: readonly AppMenuEntry[];
  readonly nav: readonly NavEntry[];
  readonly personas?: readonly string[];
  readonly theme?: string;            // a kind:'theme' capability name (design tokens)
}

interface CapabilityRow {
  readonly name: string;
  readonly body: {
    title?: string; description?: string; master?: string; assistant?: AppAssistant;
    menu?: AppMenuEntry[]; nav?: NavEntry[]; personas?: string[]; theme?: string;
  };
}

@Injectable({ providedIn: 'root' })
export class ApplicationSource {
  private readonly navReg = inject(NavigationRegistry);
  private readonly auth = inject(AuthService);
  private stream?: EventSource;

  private static readonly APP_KEY = 'hub.currentApp';
  /** Every governed application in the catalog. */
  readonly applications = signal<ApplicationDef[]>([]);
  /** The currently-open application's name (persisted; defaults to env). */
  readonly current = signal<string>(environment.applicationName);
  /** The active application definition (falls back to the first). */
  readonly application = computed<ApplicationDef | null>(() => {
    const apps = this.applications();
    return apps.find((a) => a.name === this.current()) ?? apps[0] ?? null;
  });
  readonly error = signal<string | null>(null);
  readonly lastSync = signal<string | null>(null);

  constructor() {
    try { const s = localStorage.getItem(ApplicationSource.APP_KEY); if (s) this.current.set(s); } catch { /* no-op */ }
  }

  /** Switch which application the Hub renders (persisted) + refresh its nav menu. */
  setCurrent(name: string): void {
    this.current.set(name);
    try { localStorage.setItem(ApplicationSource.APP_KEY, name); } catch { /* no-op */ }
    const app = this.application(); if (app) this.registerNav(app);
  }

  readonly title = computed(() => this.application()?.title ?? 'Experience Hub');
  readonly menu = computed<readonly AppMenuEntry[]>(() =>
    [...(this.application()?.menu ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
  /** The route tree — the pages the app navigates between (sorted by order). */
  readonly nav = computed<readonly NavEntry[]>(() =>
    [...(this.application()?.nav ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
  /** The route tree flattened to full paths — the routing/resolution index. */
  readonly flatNav = computed<readonly FlatNavEntry[]>(() => flattenNav(this.nav()));

  /** Filter the (top-level) nav tree for a persona; unset personas = visible to all. */
  navFor(persona: string): readonly NavEntry[] {
    const visible = (e: NavEntry): boolean => !e.personas?.length || e.personas.includes(persona);
    const prune = (entries: readonly NavEntry[]): NavEntry[] =>
      entries.filter(visible).map((e) => (e.children ? { ...e, children: prune(e.children) } : e));
    return prune(this.nav());
  }
  readonly assistantEnabled = computed(() => this.application()?.assistant?.enabled === true);

  /** Load the configured application capability and register its menu into NavigationRegistry. */
  async hydrate(): Promise<void> {
    try {
      const url = `${CATALOG_URL}/v1/catalogs/${encodeURIComponent(TENANT)}/capabilities?kind=application`;
      const headers: Record<string, string> = { accept: 'application/json' };
      const token = this.auth.token();
      if (environment.authMode === 'oidc' && token) headers['authorization'] = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`catalog returned ${res.status}`);
      const { items } = (await res.json()) as { items: CapabilityRow[] };
      if (!items.length) throw new Error('no applications in the catalog');

      const defs: ApplicationDef[] = items.map((row) => ({
        name: row.name,
        title: row.body.title ?? row.name,
        description: row.body.description,
        master: row.body.master,
        assistant: row.body.assistant,
        menu: row.body.menu ?? [],
        nav: row.body.nav ?? [],
        personas: row.body.personas,
        theme: row.body.theme,
      }));
      this.applications.set(defs);
      // Keep the current selection valid; default to env, else the first app.
      if (!defs.some((d) => d.name === this.current())) this.current.set(defs[0].name);
      const app = this.application(); if (app) this.registerNav(app);
      this.lastSync.set(new Date().toLocaleTimeString());
      this.error.set(null);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  /** Re-hydrate when a `capability` (the application) or `experience` changes in the catalog. */
  startLiveSync(): void {
    if (this.stream) return;
    try {
      this.stream = new EventSource(`${CATALOG_URL}/v1/catalogs/${encodeURIComponent(TENANT)}/stream`);
      this.stream.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as { entityType?: string };
          if (data.entityType === 'capability' || data.entityType === 'experience') void this.hydrate();
        } catch { /* ignore keepalives */ }
      };
      this.stream.onerror = () => { /* browser auto-reconnects */ };
    } catch { /* SSE unavailable — manual refresh covers it */ }
  }

  private registerNav(def: ApplicationDef): void {
    this.navReg.removeBySource(NAV_SOURCE);
    // Prefer the route tree (pages); fall back to the flat surface menu.
    const entries: NavigationDef[] = def.nav.length
      ? def.nav.map((n) => ({ name: n.path, title: n.title, route: `/${n.path}`, icon: n.icon, order: n.order, source: NAV_SOURCE }))
      : def.menu.map((m) => ({ name: m.id, title: m.title, route: `/x/${m.target.name}`, icon: m.icon, order: m.order, source: NAV_SOURCE }));
    for (const e of entries) this.navReg.register(e);
  }
}
