import {
  EnvironmentProviders, EnvironmentInjector, Provider, makeEnvironmentProviders,
  provideAppInitializer, inject, runInInjectionContext,
} from '@angular/core';
import { ROUTES } from '@angular/router';
import {
  AGENTIC_DECISION_EVALUATOR, ComponentRegistry,
  provideStaticJsonMfeRegistry, MfeRegistryClient, loadRemoteCapabilities, createRemoteLoader,
} from '@infra-tools/agentic-ui';
import { CATALOG_CONFIG, type CatalogRuntimeConfig, type ResolvedCatalogConfig } from './catalog-config';
import { DecisionRegistry } from './decision-registry';
import {
  CatalogExperienceSource, CatalogValidationSource, CatalogFormSource, CatalogWorkflowSource,
  CatalogThemeSource, CatalogDataSource, CatalogToolSource, CatalogPromptSource,
  CatalogSkillSource, CatalogNavigationSource, CatalogDecisionSource,
} from './content-sources';
import { ApplicationSource } from './application-source';
import { PageSource } from './page-source';
import { CatalogPageHostComponent } from './render/page-host.component';
import { shellWidgets } from './shell/shell-widgets';

export interface CatalogRuntimeOptions {
  /**
   * `registries` (default) — hydrate the library registries so an existing app
   * embeds governed capabilities (forms/tools/experiences/…) via `<mvk-form-
   * renderer>` etc. `shell` — also load the application + pages and contribute the
   * render hosts + routes so a host can render the full catalog-driven app
   * (bootstrap `CatalogShellComponent` as the app root).
   */
  readonly mode?: 'registries' | 'shell';
}

/**
 * Wire an app to an Experience Studio catalog backend: at boot it compiles the
 * tenant's governed capabilities into the library registries and re-hydrates
 * them live over ONE shared SSE connection (a Studio publish appears with no
 * reload). Opt-in and tree-shakeable.
 *
 * ```ts
 * providers: [
 *   provideAgenticUiPlatform({ ... }),
 *   provideRouter([]),                                  // shell mode contributes routes
 *   provideCatalogRuntime({ baseUrl: 'http://localhost:8081', tenant: 'acme' }),
 * ]
 * ```
 * For OIDC, also provide `{ provide: CATALOG_AUTH, useExisting: MyAuthService }`.
 */
export function provideCatalogRuntime(
  config: CatalogRuntimeConfig,
  options: CatalogRuntimeOptions = {},
): EnvironmentProviders {
  const mode = options.mode ?? 'registries';
  const resolved: ResolvedCatalogConfig = {
    baseUrl: config.baseUrl,
    tenant: config.tenant,
    authMode: config.authMode ?? 'disabled',
    dataSourceSecrets: config.dataSourceSecrets ?? {},
    applicationName: config.applicationName,
    mfeRegistryUrl: config.mfeRegistryUrl,
    mfeEnv: config.mfeEnv,
  };

  const providers: (Provider | EnvironmentProviders)[] = [
    { provide: CATALOG_CONFIG, useValue: resolved },
    // Let the workflow engine branch on a governed decision.
    {
      provide: AGENTIC_DECISION_EVALUATOR,
      useFactory: () => {
        const registry = inject(DecisionRegistry);
        return {
          evaluate: async (decision: string, input: Readonly<Record<string, unknown>>) =>
            registry.evaluate(decision, input as Record<string, unknown>)?.outputs ?? null,
        };
      },
    },
    provideAppInitializer(async () => {
      const experiences = inject(CatalogExperienceSource);
      const validation = inject(CatalogValidationSource);
      const forms = inject(CatalogFormSource);
      const workflows = inject(CatalogWorkflowSource);
      const themes = inject(CatalogThemeSource);
      const data = inject(CatalogDataSource);
      const tools = inject(CatalogToolSource);
      const prompts = inject(CatalogPromptSource);
      const skills = inject(CatalogSkillSource);
      const nav = inject(CatalogNavigationSource);
      const decisions = inject(CatalogDecisionSource);
      const application = inject(ApplicationSource);
      const pages = inject(PageSource);

      // Dependency-ordered hydrate: validation before forms, data before tools.
      await Promise.all([validation.hydrate(), data.hydrate()]);
      await Promise.all([
        experiences.hydrate(), forms.hydrate(), workflows.hydrate(), themes.hydrate(),
        tools.hydrate(), prompts.hydrate(), skills.hydrate(), nav.hydrate(), decisions.hydrate(),
        ...(mode === 'shell' ? [application.hydrate(), pages.hydrate()] : []),
      ]);

      // Subscribe every source to the ONE shared SSE stream (first onMutation opens it).
      for (const s of [experiences, validation, forms, workflows, themes, data, tools, prompts, skills, nav, decisions]) {
        s.startLiveSync();
      }
      if (mode === 'shell') { application.startLiveSync(); pages.startLiveSync(); }
    }),
  ];

  if (mode === 'shell') {
    // Register the master-page shell components so surfaces resolve them by name.
    providers.push(provideAppInitializer(() => {
      inject(ComponentRegistry).registerAll(shellWidgets);
    }));
    // Contribute the catalog routes (merged with the app's own provideRouter).
    providers.push({
      provide: ROUTES,
      multi: true,
      useValue: [
        { path: '', pathMatch: 'full', component: CatalogPageHostComponent },
        { path: '**', component: CatalogPageHostComponent },
      ],
    });
    // Federation: discover catalog-registered remotes and load each into the registries.
    if (resolved.mfeRegistryUrl) {
      providers.push(provideStaticJsonMfeRegistry({ url: resolved.mfeRegistryUrl }));
      providers.push(provideAppInitializer(() => {
        const injector = inject(EnvironmentInjector);
        const client = inject(MfeRegistryClient);
        return runInInjectionContext(injector, async () => {
          const remotes = await client.discover(resolved.mfeEnv).catch(() => []);
          await Promise.allSettled(remotes.map((remote) =>
            runInInjectionContext(injector, () =>
              loadRemoteCapabilities({ remote, loader: createRemoteLoader(remote) })
                .catch((err) => console.warn('[catalog] MFE load failed:', remote.remoteName, err)),
            ),
          ));
        });
      }));
    }
  }

  return makeEnvironmentProviders(providers);
}
