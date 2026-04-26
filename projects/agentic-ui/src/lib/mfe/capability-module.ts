import { type EnvironmentInjector, runInInjectionContext } from '@angular/core';
import {
  CapabilityRegistry,
  ComponentRegistry,
  ToolRegistry,
  type CapabilityDef,
  type CapabilityManifest,
  type ComponentDef,
  type Registry,
  type ToolDef,
} from '../internal';

/**
 * Concrete registry instances passed into `apply()` from the host. Required
 * when host and remote bundle their own copies of the lib (no federation
 * sharing): `hostInjector.get(ToolRegistry)` would resolve `ToolRegistry`
 * against the remote's class identity, creating a separate root instance
 * the host's chat shell never reads. Passing instances directly bypasses
 * that lookup.
 */
export interface CapabilityRegistries {
  readonly tools: Registry<ToolDef>;
  readonly components: Registry<ComponentDef>;
  readonly capabilities: Registry<CapabilityDef>;
}

export interface CapabilityModuleOptions {
  readonly remoteName: string;
  readonly version: string;
  readonly tools?: readonly ToolDef[];
  readonly components?: readonly ComponentDef[];
  readonly prompts?: readonly { readonly name: string; readonly text: string }[];
}

export interface CapabilityModule {
  readonly manifest: CapabilityManifest;
  readonly tools: readonly ToolDef[];
  readonly components: readonly ComponentDef[];
  readonly prompts: readonly { readonly name: string; readonly text: string }[];
  /**
   * Register this module with the host's registries. Two call shapes:
   *
   *  - `apply(hostInjector)` — convenience for federated setups where host +
   *    remote share the lib singleton; resolves registries via DI from the
   *    host's `EnvironmentInjector`.
   *
   *  - `apply({ tools, components, capabilities })` — for setups where each
   *    app bundles its own copy of the lib (no federation sharing). Pass the
   *    HOST'S concrete registry instances so writes land where the chat shell
   *    will read from.
   *
   * Returns a disposer that strips this remote's entries by source.
   */
  apply(hostInjectorOrRegistries: EnvironmentInjector | CapabilityRegistries): () => void;
}

export function defineCapabilityModule(options: CapabilityModuleOptions): CapabilityModule {
  const source = `remote:${options.remoteName}` as const;
  const tools = (options.tools ?? []).map((t) => ({ ...t, source }));
  const components = (options.components ?? []).map((c) => ({ ...c, source }));
  const prompts = options.prompts ?? [];

  const manifest: CapabilityManifest = {
    remoteName: options.remoteName,
    version: options.version,
    exposes: {
      tools: tools.map((t) => t.name),
      components: components.map((c) => c.name),
      prompts: prompts.map((p) => p.name),
    },
  };

  return {
    manifest,
    tools,
    components,
    prompts,
    apply(input: EnvironmentInjector | CapabilityRegistries): () => void {
      const registries = isInjector(input)
        ? runInInjectionContext(input, () => ({
            tools: input.get(ToolRegistry),
            components: input.get(ComponentRegistry),
            capabilities: input.get(CapabilityRegistry),
          }))
        : input;

      const toolDispose = registries.tools.registerAll(tools);
      const componentDispose = registries.components.registerAll(components);
      const capabilityDef: CapabilityDef = {
        name: options.remoteName,
        source,
        ...manifest,
      };
      const capDispose = registries.capabilities.register(capabilityDef);

      return () => {
        toolDispose();
        componentDispose();
        capDispose();
        registries.tools.removeBySource(source);
        registries.components.removeBySource(source);
        registries.capabilities.removeBySource(source);
      };
    },
  };
}

function isInjector(x: EnvironmentInjector | CapabilityRegistries): x is EnvironmentInjector {
  return typeof (x as EnvironmentInjector).get === 'function' && !('tools' in x);
}
