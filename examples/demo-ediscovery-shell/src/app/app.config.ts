import {
  ApplicationConfig,
  EnvironmentInjector,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideEnvironmentInitializer,
  provideZonelessChangeDetection,
  runInInjectionContext,
  type EnvironmentProviders,
} from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { loadRemoteModule } from '@angular-architects/native-federation';
import {
  AGENTIC_ACTIVE_PERSONA,
  AGENTIC_RUN_STATE_PROVIDER,
  AGENTIC_APPROVAL_AUDIT_HOOK,
  AGENTIC_OPERATION_AUDIT_HOOK,
  CatalogCapabilityRegistrarService,
  keywordToolFilter,
  loadRemoteCapabilities,
  MfeRegistryClient,
  provideAgenticPlatform,
  provideAgenticTelemetry,
  provideAgenticTelemetryConsole,
  provideAgenticUi,
  provideAgentContext,
  provideAgUiBackend,
  provideLayoutAudit,
  provideLayoutPolicy,
  provideLayoutResolver,
  provideLayoutTiers,
  provideStaticJsonMfeRegistry,
  provideTeamsContext,
  provideToolFilter,
  provideTriggerRunner,
  memoryStore,
  PersistenceRegistry,
  STANDARD_LAYOUT_TIERS,
  ToolRegistry,
  type ApprovalAuditEvent,
  type CapabilityModule,
  type ChatShellMode,
  type OperationAuditEvent,
} from '@infra-tools/agentic-ui';
import { appendAudit, isoNow, nextAuditId } from '@infra-tools/demo-ediscovery-shared';

import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { buildTools, registerApprovals, registerDataSources, registerForms, widgets } from './agentic/agentic';
import { registerNavigationActions } from './agentic/navigation-actions';
import { registerPostChatSurfaces } from './agentic/post-chat-surfaces';
import { registerLayoutTemplates } from './agentic/layout-templates';
import { PersonaService } from './services/persona.service';
import { MatterStore } from './services/matter.store';
import { ProposedDashboardStore } from './services/proposed-dashboard.store';
import { WorkspaceLayoutStore } from './services/workspace-layout.store';

function telemetryProvider() {
  switch (environment.telemetry) {
    case 'console': return provideAgenticTelemetryConsole();
    case 'otel': return provideAgenticTelemetry({
      kind: 'otel',
      providers: {
        tracer: { startSpan: () => ({ setAttribute: () => {}, recordException: () => {}, end: () => {} }) },
      },
    });
    default: return [];
  }
}

/**
 * Register host-side (Phase 1) collection tools and the intake form
 * before the chat shell renders. Tools and form factories need an
 * `EnvironmentInjector` because their handlers capture `MatterStore`
 * via `runInInjectionContext`.
 *
 * Runs as `provideEnvironmentInitializer` (not `provideAppInitializer`)
 * so the catalog capability registrar — also an environment initializer —
 * sees the populated `ToolRegistry` / `ComponentRegistry` when it
 * fires. Initializer order is provider-array order, so this MUST come
 * before `provideAgenticPlatform({...})`.
 */
function bootAgenticCapabilities() {
  return provideEnvironmentInitializer(() => {
    const env = inject(EnvironmentInjector);
    // ADR-046 PR2 D2/D3 — register the four memory-backed adapters
    // that back the layered tiers. Production hosts swap memoryStore
    // for httpPersistenceStore + a real auth-gated backend; the
    // demo runs in-memory so the cookbook story is "wire your own
    // adapter under the same names".
    const persistence = env.get(PersistenceRegistry);
    persistence.register(memoryStore('org-store'));
    persistence.register(memoryStore('matter-store'));
    persistence.register(memoryStore('persona-store'));
    persistence.register(memoryStore('user-store'));
    // Data sources MUST register before forms — composition widgets that
    // declare `dataSources` validate at mount, and mount happens as soon
    // as the agent surfaces a form-card widget (Capability F2).
    registerDataSources(env);
    registerForms(env);
    registerNavigationActions(env);
    // Approval policies (Capability F4) must register before the chat
    // intercept fires — paralegal turns triggering exportProductionSet
    // from the moment the shell boots get queued correctly.
    registerApprovals(env);
    inject(ToolRegistry).registerAll(buildTools(env));
    // Post-chat surfaces (P0-P5): one tile-renderer widget +
    // dailyAckSweep TriggerDef + matterHealth DashboardDef +
    // initialPrivilegePass PlaybookDef. Runs AFTER tools register so
    // dashboard tiles + playbook steps can resolve real tool names.
    registerPostChatSurfaces(env);
    // ADR-046 PR4 D6 — seed sample layout / dashboard templates with
    // representative approval states so the catalog UI has content
    // to render. Runs AFTER the registries are available (providedIn:
    // 'root', so they're always available — but the seed reads the
    // matter id for matter-scoped templates).
    registerLayoutTemplates(env);
    // Phase A — rehydrate user-committed DashboardDef entries from
    // PersistenceRegistry so they survive page reloads. Fires AFTER
    // host + post-chat registrations so the persisted entries can
    // override seeded ones by name (most-recent-commit wins). Async
    // read but fire-and-forget — the picker rerenders when the
    // registry signal fires.
    void env.get(ProposedDashboardStore).rehydrateCommittedDashboards();
  });
}

/**
 * Phase 8 — install the persona-driven scope policy on `ToolRegistry`.
 *
 * The library's `setScopePolicy` filters every `list()` / `get()` /
 * `signal()` read against an active scope, and the policy is just a
 * predicate over each `RegistryEntry`. We close over the host's
 * `PersonaService.canInvoke()` which already encodes the role
 * allow-lists. The chat shell, the sidebar's tool counter, the chat
 * rail's capability badge — all read through the same filter.
 *
 * @remarks
 * This runs AFTER `bootAgenticCapabilities` (initializer order is
 * declaration order) so every tool is already registered. The
 * keyword filter still applies on top via `provideToolFilter` so the
 * per-turn budget is bounded inside the role-allowed set.
 */
function installPersonaScopePolicy() {
  return provideEnvironmentInitializer(() => {
    const persona = inject(PersonaService);
    const tools = inject(ToolRegistry);
    tools.setScopePolicy((entry) => persona.canInvoke(persona.active(), entry.name));
  });
}

/**
 * Conditionally wire `provideAgenticPlatform` so registered tools/widgets
 * auto-POST to the catalog at boot (Gap 1 / ADR-032), operator-toggled
 * `lifecycle: 'disabled'` capabilities hide from the registry within ~30s
 * (Gap 3 / ADR-033), and tool calls / widget renders / federation loads
 * post to `/v1/catalogs/{tenant}/usage` (Gap 2 / ADR-034). Skipped
 * entirely when `environment.catalogUrl` is unset — fully-embedded
 * local dev keeps working unchanged.
 *
 * Persona resolution stays on the host's existing transport:
 *   - `AGENTIC_ACTIVE_PERSONA` reads `PersonaService.active()` (UI
 *     dropdown), not the JWT-derived catalog resolver.
 *
 * MFE discovery uses the catalog when `catalogUrl` is set
 * (Gap A2 / RestMfeRegistrySource against `/v1/catalogs/{tenant}/mfes`),
 * with `/mfes.json` as a `staticFallbackUrl` resilience net. Local dev
 * with no catalog still uses the static JSON file directly via the
 * `provideStaticJsonMfeRegistry` branch outside `platformIntegration()`.
 *
 * `usageMetering` is gated on `environment.enableUsageMetering` because
 * the wrapping sink would silently displace the dev console / OTel
 * sink. Prod has `telemetry: 'none'` already, so enabling there has
 * no console-output regression.
 *
 * `includeRemotes: true` so federated MFE tools / widgets land in the
 * catalog too, via `loadDemoRemotes()` calling `registrar.resync()`
 * after Native Federation finishes loading remotes.
 *
 * Runs AFTER `installPersonaScopePolicy()` so the catalog authorizer
 * composes onto the persona policy (`composeWithCatalogAuthorizer`
 * AND's both predicates — see ADR-033 §D5).
 */
function platformIntegration(): EnvironmentProviders[] {
  if (!environment.catalogUrl) return [];
  return [
    provideAgenticPlatform({
      catalogUrl: environment.catalogUrl,
      tenantId: environment.catalogTenantId,
      // AUTH_MODE=disabled demo deploy (ADR-022). Production hosts wire
      // their OIDC client here — return Promise<string> when refresh is
      // async, sync string for static demo tokens.
      getToken: () => null,
      capabilityRegistrar: { includeRemotes: true },  // host + remotes; loadDemoRemotes triggers resync
      capabilityAuthorizer: {},                        // 30s poll; default-allow on fetch failure
      // Catalog-driven MFE discovery — replaces /mfes.json with
      // GET /v1/catalogs/{tenant}/mfes. Polls every 30s for live
      // updates. `staticFallbackUrl` keeps the runtime resilient
      // if the catalog is unreachable mid-session: the fallback
      // file ships with the app at /mfes.json (Render static-asset
      // serving covers it).
      mfeRegistry: { refreshIntervalMs: 30_000, staticFallbackUrl: environment.mfeRegistryUrl },
      ...(environment.enableUsageMetering ? { usageMetering: {} } : {}),
    }),
  ];
}

/**
 * Discover MFE remotes and load each one's `Capability` module via Native
 * Federation. Each remote's `defineCapabilityModule` writes into the host's
 * `ToolRegistry` / `ComponentRegistry` (singletons via the federation
 * `shared` config), so the chat shell sees Phase 2's review tools the
 * moment this initializer resolves.
 *
 * Failures are logged but never block boot — losing one remote shouldn't
 * brick the host. The collection specialist (Phase 1) keeps working.
 */
/**
 * Best-effort loader for a remote's optional secondary exposed module
 * (e.g. `./RegisterForm`, `./RegisterDataSource`). If the module
 * exists and exports the named function, call it with the host's
 * injector. Silent on missing modules — many remotes won't expose
 * either.
 */
async function tryLoadOptional(
  remoteName: string,
  exposedModule: string,
  fnName: string,
  injector: EnvironmentInjector,
  successLog: (name: string) => string,
): Promise<void> {
  try {
    const mod = await loadRemoteModule<Record<string, unknown>>({ remoteName, exposedModule });
    const fn = mod[fnName];
    if (typeof fn === 'function') {
      (fn as (env: EnvironmentInjector) => void)(injector);
      console.info(`[demo-ediscovery-shell] ${successLog(remoteName)}`);
    }
  } catch {
    // Silent — the remote doesn't expose this entry.
  }
}

function loadDemoRemotes() {
  return provideAppInitializer(() => {
    const injector = inject(EnvironmentInjector);
    const client = inject(MfeRegistryClient);
    return runInInjectionContext(injector, async () => {
      const remotes = await client.discover(environment.mfeEnv).catch((err) => {
        console.warn('[demo-ediscovery-shell] MFE registry discovery failed', err);
        return [] as ReadonlyArray<{ remoteName: string; version: string; remoteEntry: string }>;
      });
      console.info(`[demo-ediscovery-shell] Discovered ${remotes.length} remote(s) for env=${environment.mfeEnv}`);
      await Promise.allSettled(
        remotes.map((remote) =>
          runInInjectionContext(injector, async () => {
            try {
              const loaded = await loadRemoteCapabilities({
                remote,
                loader: async () => {
                  const mod = await loadRemoteModule<{ capability: CapabilityModule }>({
                    remoteName: remote.remoteName,
                    exposedModule: './Capability',
                  });
                  return { capability: mod.capability };
                },
              });
              console.info(
                `[demo-ediscovery-shell] Loaded ${loaded.remote.remoteName} ` +
                `(${loaded.module.tools.length} tool(s), ${loaded.module.components.length} widget(s))`,
              );

              // Optional secondary exposed entries — best-effort. Each
              // remote may declare extras in its federation.config.js;
              // a remote that doesn't expose a given key simply skips.
              await tryLoadOptional(remote.remoteName, './RegisterForm',
                'registerForms', injector,
                (n) => `Registered forms for ${n}`);
              await tryLoadOptional(remote.remoteName, './RegisterDataSource',
                'registerDataSources', injector,
                (n) => `Registered data sources for ${n}`);
            } catch (err) {
              console.warn(`[demo-ediscovery-shell] Failed to load remote "${remote.remoteName}"`, err);
            }
          }),
        ),
      );

      // ADR-032 §D6 follow-up — the registrar's bootstrap snapshot
      // fired before remotes were loaded (Promise<void> initializers
      // run synchronously; MFE federation is async). Resync now so
      // federated tools / widgets flow into the catalog. Idempotent
      // via the catalog's UNIQUE constraint — host capabilities the
      // initial sync already POSTed return 409 and are recorded as
      // 'exists'. Non-fatal: if the catalog isn't configured (no
      // platform integration), the service was never configured and
      // resync() is a no-op.
      const registrar = injector.get(CatalogCapabilityRegistrarService, null, { optional: true });
      if (registrar) {
        await registrar.resync();
      }
    });
  });
}

/**
 * Route → ChatShellMode mapping from the post-chat-surfaces design.
 * Captures the intuition that some routes want the chat at hand
 * (rail / docked-bottom), some want it peripheral (pill), and some
 * want it absent (hidden — Audit, where the chain-hash query bar is
 * the right primitive).
 */
function shellModeForRoute(route: string): ChatShellMode {
  if (route.startsWith('/audit'))         return 'hidden';
  if (route.startsWith('/holds'))         return 'pill';
  if (route.startsWith('/productions'))   return 'pill';
  if (route.startsWith('/review-queue'))  return 'pill';
  if (route.startsWith('/timeline'))      return 'pill';
  if (route.startsWith('/documents/'))    return 'pill';   // single-doc workspace
  return 'rail';
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideAgenticUi({ widgets }),
    provideAgUiBackend({ url: environment.agentUrl }),
    // MFE discovery: catalog when configured, static JSON otherwise.
    // The catalog branch lives inside `platformIntegration()` (it's
    // a switch on `provideAgenticPlatform`); this static-JSON branch
    // covers the no-catalog dev path. Wire-format parity is handled
    // by `RestMfeRegistrySource.toRemoteSpec` (name→remoteName,
    // manifestUrl→remoteEntry).
    ...(environment.catalogUrl
      ? []
      : [provideStaticJsonMfeRegistry({ url: environment.mfeRegistryUrl })]),
    telemetryProvider(),
    // Capability F4 — wire the approval intercept to read the active
    // persona from PersonaService. Closing over the singleton keeps the
    // accessor reactive across every chat-turn intercept.
    {
      provide: AGENTIC_ACTIVE_PERSONA,
      useFactory: () => {
        const persona = inject(PersonaService);
        return () => persona.active();
      },
    },
    // Capability M1 R4 — thread persona / matter / active route into the
    // agent's reasoning context (ADR-013). Snapshot taken once per run by
    // runUntilSettled. NOT a security boundary — that's setScopePolicy
    // (ADR-008). State only lets the agent phrase responses appropriately.
    // PII redaction is the host's responsibility; this provider returns
    // only the role identifier + the matter id/type, never end-user PII.
    {
      provide: AGENTIC_RUN_STATE_PROVIDER,
      useFactory: () => {
        const persona = inject(PersonaService);
        const matter = inject(MatterStore);
        const router = inject(Router);
        return () => ({
          persona: persona.active(),
          matter: { id: matter.matterId, type: 'securities' as const },
          activeRoute: router.url,
        });
      },
    },
    // Capability F4 — translate every approval transition into an
    // audit-chain entry (AC-F4-6, r3 plan §7.8). New event kinds:
    // 'tool-approved' / 'tool-rejected'. The chain primitive auto-stamps
    // prevHash + chainHash; verifyAuditChain() recomputes hashes on every
    // read so the new kinds participate in tamper detection automatically.
    {
      provide: AGENTIC_APPROVAL_AUDIT_HOOK,
      useFactory: () => {
        const persona = inject(PersonaService);
        return ({ approval, decision, previousStatus }: ApprovalAuditEvent) => {
          appendAudit({
            id: nextAuditId(),
            matterId: environment.matterId,
            actor: approval.approverPersona ?? persona.active(),
            action: decision === 'approved' ? 'tool-approved' : 'tool-rejected',
            target: { type: 'tool', id: approval.toolName },
            before: {
              status: previousStatus,
              args: approval.args,
              requesterPersona: approval.requesterPersona,
            },
            after: {
              status: decision,
              comment: approval.comment,
            },
            reason: approval.comment,
            timestamp: approval.decidedAt ?? isoNow(),
          });
        };
      },
    },
    // Capability F5 — translate every Operation lifecycle transition
    // into an audit-chain entry (AC-F5-5, r3 plan §7.8). New event
    // kinds: 'operation-started' / '-progress' / '-finished' / '-failed'.
    // Progress events are emitted often; the audit chain captures every
    // one so chain-of-custody reports include the full lifecycle.
    {
      provide: AGENTIC_OPERATION_AUDIT_HOOK,
      useFactory: () => {
        const persona = inject(PersonaService);
        return ({ operation, transition, previousStatus }: OperationAuditEvent) => {
          appendAudit({
            id: nextAuditId(),
            matterId: environment.matterId,
            actor: persona.active(),
            action: `operation-${transition}`,
            target: { type: 'operation', id: operation.opId },
            before: { status: previousStatus, pct: operation.pct ?? 0 },
            after: {
              status: operation.status,
              pct: operation.pct,
              phase: operation.phase,
              result: operation.result,
              error: operation.error,
              durationMs: operation.durationMs,
            },
            timestamp: isoNow(),
          });
        };
      },
    },
    // Phase 8 — `setScopePolicy` on ToolRegistry handles the persona
    // filter (in installPersonaScopePolicy below). The chat shell sees
    // the already-filtered tools through ToolRegistry.signal(), so the
    // tool filter only carries the per-turn keyword budget now.
    provideToolFilter(keywordToolFilter({ maxTools: 12, floor: 5 })),
    // Post-chat surfaces P0 (ADR-043 D4) — persona × route shell-mode
    // matrix. The chat-shell + assist-panel read LAYOUT_POLICY at
    // render time, so both persona switches and route changes reshape
    // the chrome live. Tracks the route table from the design doc:
    //   Dashboard        → rail (chat at hand, dashboard is glance-driven)
    //   Documents list   → rail
    //   Custodians       → rail
    //   Holds            → pill (canvas is the artifact)
    //   Audit            → hidden (browsing a hash chain — chat is the
    //                       wrong primitive)
    //   Productions      → pill
    //   Review queue     → pill (keyboard-driven throughput)
    //   Timeline         → pill (full-bleed canvas)
    //   Inbox            → rail
    //   Dashboards (P3)  → rail
    //   Playbooks (P5)   → rail
    // Density is persona-driven (compact for lead-counsel etc.); the
    // shellMode function is the same across personas — modes are a
    // function of *what* you're doing, not *who* you are.
    provideLayoutPolicy({
      resolvePersona: () => inject(PersonaService).active(),
      byPersona: {
        'lead-counsel':    { density: () => 'compact',     shellMode: shellModeForRoute },
        'associate':       { density: () => 'comfortable', shellMode: shellModeForRoute },
        'vendor-reviewer': { density: () => 'dense',       shellMode: shellModeForRoute },
        'paralegal':       { density: () => 'comfortable', shellMode: shellModeForRoute },
        'lit-support':     { density: () => 'comfortable', shellMode: shellModeForRoute },
      },
      fallback: { density: () => 'comfortable', shellMode: shellModeForRoute },
    }),
    // ADR-046 PR1 — LayoutResolver wired with three input layers
    // (route, persona, agent). The resolver's `active()` signal is what
    // `<mvk-workspace-layout>` should bind to; rather than each route
    // reading WorkspaceLayoutStore directly. Existing direct readers
    // continue to work because the store stays the agent-override
    // signal under the hood.
    //
    // Adopters extend this with selection / matter-phase / alert /
    // user-saved inputs as their domain exposes those signals.
    provideLayoutResolver({
      routeRules: [
        // Context-driven defaults — fire WITHOUT a chat prompt. Click
        // into /workspace and the resolver supplies a baseline three-pane
        // layout; the agent's setWorkspaceLayout override wins on top
        // (weight 1000 > route's 400).
        {
          pattern: '/workspace',
          slots: {
            primary: { component: 'kpiTile', size: { default: '60%' } },
            sidebar: { component: 'kpiTile', size: { default: '25%' } },
            footer:  { component: 'kpiTile', size: { default: '15%' } },
          },
          reason: 'route /workspace — three-pane baseline',
        },
        {
          pattern: '/documents/*',
          slots: {
            primary: { component: 'kpiTile', size: { default: '70%' } },
            sidebar: { component: 'kpiTile', size: { default: '30%' } },
          },
          reason: 'route /documents/:id — preview + tag panel',
        },
        {
          pattern: '/holds',
          slots: {
            primary: { component: 'kpiTile', size: { default: '100%' } },
          },
          reason: 'route /holds — full-width canvas',
        },
      ],
      personaRules: [
        // Persona-level pin: lead-counsel always sees the chain-of-
        // custody footer regardless of route. Lower priority than
        // route/agent — they can override.
        {
          personaId: 'lead-counsel',
          slots: {
            footer: { component: 'kpiTile', size: { default: '15%' } },
          },
          reason: 'persona lead-counsel — chain-of-custody pin',
        },
      ],
      activePersona: () => inject(PersonaService).active,
      agentSlots: () => inject(WorkspaceLayoutStore).slots,
    }),
    // ADR-046 PR1 D5 — agent gets a per-turn context block describing
    // current route, persona, and resolved layout state. The chat-shell
    // integration that ships the block to the LLM lands in PR1b; this
    // provider line wires the contributors so AgentContextProvider.compose()
    // returns the assembled block as soon as a host queries it.
    provideAgentContext(),
    // ADR-046 PR2 D2/D3 — multi-tier layered storage. Four tiers, in
    // precedence order (user-saved beats matter-default beats persona-
    // default beats org-default). Each tier is backed by a memory
    // adapter for the demo (registered in bootAgenticCapabilities);
    // production hosts swap memoryStore for httpPersistenceStore
    // pointing at their layout-prefs backend, no other code change.
    provideLayoutTiers([
      { ...STANDARD_LAYOUT_TIERS['userSaved'],      scope: () => inject(PersonaService).active() },
      { ...STANDARD_LAYOUT_TIERS['matterDefault'],  scope: () => inject(MatterStore).matterId },
      { ...STANDARD_LAYOUT_TIERS['personaDefault'], scope: () => inject(PersonaService).active() },
      { ...STANDARD_LAYOUT_TIERS['orgDefault'] },
    ]),
    // ADR-046 PR3 D4 — chain-hashed LAYOUT_APPLIED events. Sink routes
    // into demo-ediscovery-shared's existing appendAudit so the new
    // layout chain lives alongside the existing tool-call / approval
    // chain. Attribution attaches userId (the active persona) + matterId
    // + route so the discovery query "show me the privilege panel
    // Sarah saw at 14:30Z" becomes a real lookup.
    provideLayoutAudit({
      sink: () => {
        // Snapshot matterId at sink construction — every emit attributes
        // to the active matter without re-injecting per turn.
        const matterId = inject(MatterStore).matterId;
        return {
          emit: (event) => {
            appendAudit({
              id: nextAuditId(),
              matterId,
              timestamp: isoNow(),
              action: 'layout.applied',
              actor: event.attribution?.['userId'] ?? 'system',
              target: { type: 'layout', id: event.id },
              after: {
                chainHash: event.chainHash,
                prevHash: event.prevHash,
                slotNames: Object.keys(event.slots),
                applied: event.appliedRules.map((r) => `${r.slotName}<-${r.source}`),
                route: event.attribution?.['route'],
              },
            });
          },
        };
      },
      attribution: () => ({
        userId: inject(PersonaService).active(),
        matterId: inject(MatterStore).matterId,
        route: inject(Router).url,
      }),
    }),
    // Post-chat surfaces P2 (ADR-045) — browser-side cron trigger
    // runner. Registered TriggerDef entries with `kind: 'cron'` fire
    // on schedule; webhook/queue specs defer to a server-side runner.
    provideTriggerRunner(),
    // Use case §24 — Teams Tab embed seam (no Teams SDK dep here).
    // The `loadContext` resolves only when the shell is loaded inside
    // a Teams Tab iframe (microsoftTeams.app.initialize() was called).
    // Outside Teams the loader returns null and `fallback` provides
    // a deterministic "demo persona" context. Production hosts wire
    // `loadContext: async () => { await microsoftTeams.app.initialize();
    // return microsoftTeams.app.getContext(); }` and bind the theme
    // signal to their CSS theme switcher. See cookbook/teams-tab-embed.md.
    ...provideTeamsContext({
      loadContext: async () => null as never,   // null → fallback kicks in (we're not inside Teams)
      fallback: {
        tenantId: environment.catalogTenantId,
        userPrincipalName: null,
        theme: 'default',
        locale: 'en-US',
      },
    }),
    // Order matters — environment initializers fire in registration
    // order. Tools register, persona policy installs, then the catalog
    // platform layer (registrar reads the populated registry; authorizer
    // composes onto the persona policy via currentScopePolicy()).
    bootAgenticCapabilities(),
    installPersonaScopePolicy(),
    ...platformIntegration(),
    loadDemoRemotes(),
  ],
};
