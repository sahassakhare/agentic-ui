import {
  ApplicationConfig, inject, provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection, provideAppInitializer,
} from '@angular/core';
import { provideAgenticUi } from '@infra-tools/agentic-ui';
import { widgets, registerCatalog } from './registry/capabilities';
import { CatalogExperienceSource } from './catalog/catalog-experience-source';

/**
 * The composer runs on the deterministic ExperiencePlanner + registry
 * render-hosts. At boot it (1) registers the host KIT (widgets/forms/workflows)
 * and (2) hydrates its EXPERIENCES from the catalog server — the governed,
 * per-tenant content product owners author in the Studio (P1 authoring loop).
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideAgenticUi({ widgets }),
    provideAppInitializer(() => registerCatalog()),
    provideAppInitializer(async () => {
      const source = inject(CatalogExperienceSource);
      await source.hydrate();      // load approved experiences from the catalog
      source.startLiveSync();      // SSE: re-hydrate on Studio edits
    }),
  ],
};
