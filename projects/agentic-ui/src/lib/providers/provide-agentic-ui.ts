import { EnvironmentProviders, inject, makeEnvironmentProviders, provideEnvironmentInitializer } from '@angular/core';
import { ComponentRegistry } from '../registries/component-registry';
import { ToolRegistry } from '../registries/tool-registry';
import type { ComponentDef, ToolDef } from '../types/registry-defs';

export interface AgenticUiConfig {
  /** Tool definitions registered as 'host' source at app boot. */
  readonly tools?: readonly ToolDef[];
  /** Component (widget) definitions registered as 'host' source at app boot. */
  readonly widgets?: readonly ComponentDef[];
}

/**
 * Root configuration for an agentic-ui application. Registers seed
 * tools and widgets at boot. Sibling providers (added separately to your
 * `bootstrapApplication` providers array) configure the rest:
 *
 *  - `provideAgUiBackend({ url })` (or `provideHashbrownBackend(...)`, `provideA2uiBackend(...)`)
 *  - `provideMfeCapabilities(...)`            // /mfe entry, M3
 *  - `provideAgenticTelemetry(...)`           // /otel entry
 *
 * Example:
 *   export const appConfig: ApplicationConfig = {
 *     providers: [
 *       provideAgenticUi({ tools: [bookFlightTool], widgets: [flightCardWidget] }),
 *       provideAgUiBackend({ url: '/api/ag-ui' }),
 *     ],
 *   };
 */
export function provideAgenticUi(config: AgenticUiConfig = {}): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      if (config.tools?.length) {
        inject(ToolRegistry).registerAll(config.tools);
      }
      if (config.widgets?.length) {
        inject(ComponentRegistry).registerAll(config.widgets);
      }
    }),
  ]);
}
