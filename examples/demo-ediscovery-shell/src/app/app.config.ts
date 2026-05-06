import {
  ApplicationConfig,
  EnvironmentInjector,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  runInInjectionContext,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { loadRemoteModule } from '@angular-architects/native-federation';
import {
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
  type CapabilityModule,
} from '@maverick/agentic-ui';

import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { buildTools, registerDataSources, registerForms, widgets } from './agentic/agentic';
import { registerNavigationActions } from './agentic/navigation-actions';
import { PersonaService } from './services/persona.service';

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
