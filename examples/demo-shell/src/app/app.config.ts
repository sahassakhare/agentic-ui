import { ApplicationConfig, EnvironmentInjector, inject, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection, runInInjectionContext } from '@angular/core';
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
  type CapabilityModule,
  type ToolDef,
} from '@infra-tools/agentic-ui';

import { environment } from '../environments/environment';
import { routes } from './app.routes';

/**
 * Discover MFE remotes from the configured registry source and load each one's
 * Capability module via Native Federation. The registry source is wired via
 * `provideStaticJsonMfeRegistry({ url })` for the demo; switch to
 * `provideSpringBootMfeRegistry({ url })` (also from `@infra-tools/agentic-ui`)
 * to point at a real registry service.
 *
 * Blocking via `provideAppInitializer` ensures the chat shell never renders
 * before tools/widgets are in the host's registries — the alternative
 * (fire-and-forget) creates a race where the user can send a prompt before
 * the agent has any client tools to call.
 */
function loadDemoRemotes() {
  return provideAppInitializer(() => {
    const injector = inject(EnvironmentInjector);
    const client = inject(MfeRegistryClient);
    return runInInjectionContext(injector, async () => {
      const remotes = await client.discover(environment.mfeEnv).catch((err) => {
        console.warn('[demo-shell] MFE registry discovery failed', err);
        return [] as ReadonlyArray<{ remoteName: string; version: string; remoteEntry: string }>;
      });
      console.info(`[demo-shell] Discovered ${remotes.length} remote(s) for env=${environment.mfeEnv}`);
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
                console.info(`[demo-shell] Loaded ${loaded.remote.remoteName} (${loaded.module.tools.length} tool(s), ${loaded.module.components.length} widget(s))`);
              },
              (err) => {
                console.warn(`[demo-shell] Failed to load remote "${remote.remoteName}"`, err);
              },
            ),
          ),
        ),
      );
    });
  });
}

function telemetryProvider() {
  switch (environment.telemetry) {
    case 'console': return provideAgenticTelemetryConsole();
    case 'otel':    return provideAgenticTelemetry({
      kind: 'otel',
      // In production wire @opentelemetry/api Tracer + Meter here; the no-op
      // shape below is just a placeholder that prevents bundle size growth
      // before the OTel SDK is configured.
      providers: {
        tracer: {
          startSpan: () => ({ setAttribute: () => {}, recordException: () => {}, end: () => {} }),
        },
      },
    });
    default: return [];
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideAgenticUi({ tools: [] as ToolDef[] }),
    provideAgUiBackend({ url: environment.agentUrl }),
    provideStaticJsonMfeRegistry({ url: environment.mfeRegistryUrl }),
    telemetryProvider(),
    loadDemoRemotes(),
  ],
};
