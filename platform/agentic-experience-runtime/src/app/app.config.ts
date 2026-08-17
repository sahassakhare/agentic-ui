import {
  ApplicationConfig, inject, makeEnvironmentProviders, EnvironmentInjector, runInInjectionContext,
  provideBrowserGlobalErrorListeners, provideZonelessChangeDetection, provideAppInitializer,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, type Routes } from '@angular/router';
import { loadRemoteModule } from '@angular-architects/native-federation';
import {
  provideAgenticUiPlatform, provideAgUiBackend,
  provideStaticJsonMfeRegistry, MfeRegistryClient, loadRemoteCapabilities, type CapabilityModule,
} from '@infra-tools/agentic-ui';
import { widgets, registerCatalog } from './registry/capabilities';
import { dashboardWidgets, registerDashboards } from './registry/dashboards';
import { shellWidgets } from './registry/shell-widgets';
import { appTools } from './agentic/tools';
import { environment } from '../environments/environment';
import { CatalogExperienceSource } from './catalog/catalog-experience-source';
import { CatalogFormSource } from './catalog/catalog-form-source';
import { CatalogWorkflowSource } from './catalog/catalog-workflow-source';
import { CatalogThemeSource } from './catalog/catalog-theme-source';
import { ApplicationSource } from './catalog/application-source';
import { PageSource } from './catalog/page-source';
import { PageHostComponent } from './render/page-host.component';

/**
 * Catalog-driven routing: every page renders through PageHostComponent, which
 * resolves the page for the current URL from the application's route tree. Real
 * URLs, deep links and back/forward come for free; the pages themselves are
 * governed capabilities loaded at boot.
 */
const routes: Routes = [
  { path: '', pathMatch: 'full', component: PageHostComponent },
  { path: '**', component: PageHostComponent },   // nested paths (/reports/monthly) resolve in PageHost
];

/**
 * The Hub runs on the deterministic ExperiencePlanner + the agentic-ui render
 * hosts AND a real agentic assistant. `provideAgenticUiPlatform` installs the
 * platform (ComponentRegistry, BackendRegistry, LAYOUT_POLICY, MCP-UI) and wires
 * the assistant to a real AG-UI backend (`environment.agentUrl`). At boot it
 * registers the host kit (journey + dashboard widgets, forms/workflows,
 * layouts/dashboards/datasources) and hydrates the governed Application +
 * approved experiences from the catalog, re-hydrating live over SSE.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideAgenticUiPlatform({
      widgets: [...widgets, ...dashboardWidgets, ...shellWidgets],
      tools: appTools,
      // Single active chat transport: a real LLM-backed AG-UI SSE server.
      transport: makeEnvironmentProviders([provideAgUiBackend({ url: environment.agentUrl })]),
      mcpUi: false,
    }),
    provideAppInitializer(() => registerCatalog()),
    provideAppInitializer(() => registerDashboards()),
    // MFE federation: discover catalog-registered remotes and load each remote's
    // CapabilityModule (its components/tools) into the host registries — so a
    // federated component becomes a bindable surface, loaded at runtime.
    provideStaticJsonMfeRegistry({ url: 'mfes.json' }),
    provideAppInitializer(() => {
      const injector = inject(EnvironmentInjector);
      const client = inject(MfeRegistryClient);
      return runInInjectionContext(injector, async () => {
        const remotes = await client.discover(environment.mfeEnv).catch(() => []);
        await Promise.allSettled(remotes.map((remote) =>
          runInInjectionContext(injector, () =>
            loadRemoteCapabilities({
              remote,
              loader: async () => {
                const mod = await loadRemoteModule<{ capability: CapabilityModule }>({
                  remoteName: remote.remoteName, exposedModule: './Capability',
                });
                return { capability: mod.capability };
              },
            }).catch((err) => console.warn('[hub] MFE load failed:', remote.remoteName, err)),
          ),
        ));
      });
    }),
    provideAppInitializer(async () => {
      const source = inject(CatalogExperienceSource);
      await source.hydrate();      // load approved experiences from the catalog
      source.startLiveSync();      // SSE: re-hydrate on Studio edits
    }),
    provideAppInitializer(async () => {
      const forms = inject(CatalogFormSource);
      await forms.hydrate();       // compile kind:'form' capabilities → FormRegistry
      forms.startLiveSync();       // SSE: re-hydrate when a form is edited
    }),
    provideAppInitializer(async () => {
      const flows = inject(CatalogWorkflowSource);
      await flows.hydrate();       // compile kind:'workflow' capabilities → FormRegistry
      flows.startLiveSync();       // SSE: re-hydrate when a workflow is edited
    }),
    provideAppInitializer(async () => {
      const themes = inject(CatalogThemeSource);
      await themes.hydrate();      // load kind:'theme' capabilities (design tokens)
      themes.startLiveSync();      // SSE: re-apply when a theme is edited
    }),
    provideAppInitializer(async () => {
      const app = inject(ApplicationSource);
      const pages = inject(PageSource);
      // The shell page, content pages and route tree must be present before the first route.
      await Promise.all([app.hydrate(), pages.hydrate()]);
      app.startLiveSync();         // SSE: re-hydrate when the app/pages/experiences change
    }),
  ],
};
