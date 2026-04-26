import { EnvironmentProviders, inject, makeEnvironmentProviders, provideEnvironmentInitializer } from '@angular/core';
import { BackendRegistry } from '../registries/backend-registry';
import type { AgenticBackend } from '../types/agentic-backend';
import type { BackendCapabilities, BackendDef } from '../types/registry-defs';

export interface AgenticBackendConfig {
  readonly id: string;
  readonly label: string;
  readonly capabilities: BackendCapabilities;
  readonly factory: () => AgenticBackend;
  /** When true (default), this backend becomes the active selection. */
  readonly setActive?: boolean;
}

/**
 * Registers an `AgenticBackend` adapter with the `BackendRegistry`.
 * Use within `provideAgenticUi(...)` or directly in app providers.
 */
export function provideAgenticBackend(config: AgenticBackendConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      const registry = inject(BackendRegistry);
      const def: BackendDef = {
        name: config.id,
        id: config.id,
        label: config.label,
        capabilities: config.capabilities,
        factory: config.factory,
      };
      registry.register(def);
      if (config.setActive !== false) {
        registry.setActive(config.id);
      }
    }),
  ]);
}
