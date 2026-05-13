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
  provideAgUiBackend,
  provideLayoutPolicy,
  provideStaticJsonMfeRegistry,
  provideToolFilter,
  provideTriggerRunner,
  ToolRegistry,
  type ApprovalAuditEvent,
  type CapabilityModule,
  type OperationAuditEvent,
} from '@infra-tools/agentic-ui';
import { appendAudit, isoNow, nextAuditId } from '@infra-tools/demo-ediscovery-shared';

import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { buildTools, registerApprovals, registerDataSources, registerForms, widgets } from './agentic/agentic';
import { registerNavigationActions } from './agentic/navigation-actions';
import { registerPostChatSurfaces } from './agentic/post-chat-surfaces';
import { PersonaService } from './services/persona.service';
import { MatterStore } from './services/matter.store';

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
    // Post-chat surfaces P0 (ADR-043 D4) — persona-shaped chat-shell
    // presentation. Partner gets a compact rail (working alongside
    // routed content all day); reviewer gets a denser pill on
    // /documents (full-screen review is the primary affordance, chat
    // is a quick aside); paralegal gets the default rail mode they
    // already know. The chat-shell + assist-panel read LAYOUT_POLICY
    // at render time, so persona switches reshape the chrome live.
    provideLayoutPolicy({
      resolvePersona: () => inject(PersonaService).active(),
      byPersona: {
        partner:    { density: () => 'compact',     shellMode: () => 'rail' },
        reviewer:   { density: () => 'dense',       shellMode: (r) => r.startsWith('/documents') ? 'pill' : 'rail' },
        paralegal:  { density: () => 'comfortable', shellMode: () => 'rail' },
      },
      fallback: { density: () => 'comfortable', shellMode: () => 'rail' },
    }),
    // Post-chat surfaces P2 (ADR-045) — browser-side cron trigger
    // runner. Registered TriggerDef entries with `kind: 'cron'` fire
    // on schedule; webhook/queue specs defer to a server-side runner.
    provideTriggerRunner(),
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
