import {
  ApplicationConfig, inject, makeEnvironmentProviders,
  provideBrowserGlobalErrorListeners, provideZonelessChangeDetection, provideAppInitializer,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideAgenticUiPlatform, provideAgUiBackend } from '@infra-tools/agentic-ui';
import { provideCatalogRuntime, CATALOG_AUTH, type CatalogAuth } from '@infra-tools/agentic-ui/catalog';
import { widgets, registerCatalog } from './registry/capabilities';
import { dashboardWidgets, registerDashboards } from './registry/dashboards';
import { appTools } from './agentic/tools';
import { environment } from '../environments/environment';
import { AuthService } from './auth/auth.service';

/**
 * The Hub now consumes the Studio catalog entirely through the library:
 * `provideCatalogRuntime(..., { mode: 'shell' })` (from
 * `@infra-tools/agentic-ui/catalog`) compiles all 13 governed capability kinds
 * into the registries, contributes the catalog routes + shell components, wires
 * MFE discovery, and re-hydrates live over ONE shared SSE connection. The Hub's
 * root `App` stays a thin login wrapper around that shell. `provideAgenticUiPlatform`
 * installs the platform + the real AG-UI assistant; the demo host kit
 * (`registerCatalog`/`registerDashboards`) still seeds a few sample capabilities.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    // Ingested libraries (e.g. PrimeNG) use Angular animations; provide them so
    // their components mount instead of throwing on a synthetic @-property.
    provideAnimationsAsync(),
    // Empty base route set — `provideCatalogRuntime` (shell mode) contributes the
    // catalog page-host routes via ROUTES multi.
    provideRouter([], withComponentInputBinding()),
    provideAgenticUiPlatform({
      widgets: [...widgets, ...dashboardWidgets],
      tools: appTools,
      // Single active chat transport: a real LLM-backed AG-UI SSE server.
      transport: makeEnvironmentProviders([provideAgUiBackend({ url: environment.agentUrl })]),
      mcpUi: false,
    }),
    provideAppInitializer(() => registerCatalog()),
    provideAppInitializer(() => registerDashboards()),
    // Adapt the Hub's AuthService to the runtime's auth seam (token for the
    // catalog fetch in oidc mode; persona/permissions for shell access gating).
    {
      provide: CATALOG_AUTH,
      useFactory: (): CatalogAuth => {
        const a = inject(AuthService);
        return {
          token: () => a.token(),
          persona: () => a.persona(),
          permissions: () => a.permissions(),
          isAuthenticated: () => a.isAuthenticated(),
          principalId: () => a.principal()?.id ?? 'end-user',
          logout: () => a.logout(),
        };
      },
    },
    provideCatalogRuntime(
      {
        baseUrl: environment.catalogBaseUrl,
        tenant: environment.tenant,
        applicationName: environment.applicationName,
        authMode: environment.authMode,
        dataSourceSecrets: environment.dataSourceSecrets,
        mfeRegistryUrl: environment.mfeRegistryUrl,
        mfeEnv: environment.mfeEnv,
      },
      { mode: 'shell' },
    ),
  ],
};
