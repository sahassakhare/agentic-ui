import type { EnvironmentInjector } from '@angular/core';
import { DataSourceRegistry } from '@maverick/agentic-ui';
import { documentIndexDataSource } from './data-sources/document-index.data-source';

/**
 * Secondary federation entry — registers the `documentIndex`
 * `DataSourceDef` against the host's `DataSourceRegistry`. Tools in
 * the search remote resolve the data source via
 * `inject(DataSourceRegistry).get('documentIndex')` so the underlying
 * transport (in-memory now, vector-store later) is invisible to them.
 *
 * The host's `loadDemoRemotes()` calls this immediately after applying
 * the capability module — same pattern as the production remote's
 * `./RegisterForm`.
 */
export function registerDataSources(env: EnvironmentInjector): void {
  env.get(DataSourceRegistry).register(documentIndexDataSource);
}
