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
  loadRemoteCapabilities,
  MfeRegistryClient,
  provideAgenticTelemetry,
  provideAgenticTelemetryConsole,
  provideAgenticUi,
  provideAgUiBackend,
  provideStaticJsonMfeRegistry,
  ToolRegistry,
  type CapabilityModule,
} from '@maverick/agentic-ui';

import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { buildTools, registerForms, widgets } from './agentic/agentic';

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
    registerForms(env);
    inject(ToolRegistry).registerAll(buildTools(env));
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
          runInInjectionContext(injector, () =>
            loadRemoteCapabilities({
              remote,
              loader: async () => {
                const mod = await loadRemoteModule<{ capability: CapabilityModule }>({
                  remoteName: remote.remoteName,
                  exposedModule: './Capability',
                });
                return { capability: mod.capability };
              },
            }).then(
              (loaded) => {
                console.info(
                  `[demo-ediscovery-shell] Loaded ${loaded.remote.remoteName} ` +
                  `(${loaded.module.tools.length} tool(s), ${loaded.module.components.length} widget(s))`,
                );
              },
              (err) => {
                console.warn(`[demo-ediscovery-shell] Failed to load remote "${remote.remoteName}"`, err);
              },
            ),
          ),
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
    bootAgenticCapabilities(),
    loadDemoRemotes(),
  ],
};
