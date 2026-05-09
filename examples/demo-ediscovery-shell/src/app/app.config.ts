import {
  ApplicationConfig,
  EnvironmentInjector,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  runInInjectionContext,
} from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { loadRemoteModule } from '@angular-architects/native-federation';
import {
  AGENTIC_ACTIVE_PERSONA,
  AGENTIC_RUN_STATE_PROVIDER,
  AGENTIC_APPROVAL_AUDIT_HOOK,
  AGENTIC_OPERATION_AUDIT_HOOK,
  keywordToolFilter,
  loadRemoteCapabilities,
  MfeRegistryClient,
  provideAgenticTelemetry,
  provideAgenticTelemetryConsole,
  provideAgenticUi,
  provideAgUiBackend,
  provideStaticJsonMfeRegistry,
  provideToolFilter,
  ToolRegistry,
  type ApprovalAuditEvent,
  type CapabilityModule,
  type OperationAuditEvent,
} from '@maverick/agentic-ui';
import { appendAudit, isoNow, nextAuditId } from '@maverick/demo-ediscovery-shared';

import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { buildTools, registerApprovals, registerDataSources, registerForms, widgets } from './agentic/agentic';
import { registerNavigationActions } from './agentic/navigation-actions';
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
 */
function bootAgenticCapabilities() {
  return provideAppInitializer(() => {
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
  return provideAppInitializer(() => {
    const persona = inject(PersonaService);
    const tools = inject(ToolRegistry);
    tools.setScopePolicy((entry) => persona.canInvoke(persona.active(), entry.name));
  });
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
    provideStaticJsonMfeRegistry({ url: environment.mfeRegistryUrl }),
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
    bootAgenticCapabilities(),
    installPersonaScopePolicy(),
    loadDemoRemotes(),
  ],
};
