import { type EnvironmentInjector, runInInjectionContext } from '@angular/core';
import {
  CapabilityRegistry,
  ComponentRegistry,
  ToolRegistry,
  type CapabilityDef,
  type CapabilityManifest,
  type ComponentDef,
  type DashboardDef,
  type PlaybookDef,
  type Registry,
  type ToolDef,
  type TriggerDef,
} from '../internal';
import { DashboardRegistry } from '../registries/dashboard-registry';
import { PlaybookRegistry } from '../registries/playbook-registry';
import { TriggerRegistry } from '../registries/trigger-registry';

/**
 * Concrete registry instances passed into `apply()` from the host. Required
 * when host and remote bundle their own copies of the lib (no federation
 * sharing): `hostInjector.get(ToolRegistry)` would resolve `ToolRegistry`
 * against the remote's class identity, creating a separate root instance
 * the host's chat shell never reads. Passing instances directly bypasses
 * that lookup.
 *
 * The three optional registries — `triggers`, `dashboards`, `playbooks` —
 * are present per the post-chat-surfaces program (ADRs 044 + 045 +
 * plan §3 Pillar 3 + §4 Workflow G). Adopters whose host hasn't taken
 * on those registries omit them; existing capability modules that don't
 * declare triggers/dashboards/playbooks see no change.
 */
export interface CapabilityRegistries {
  readonly tools: Registry<ToolDef>;
  readonly components: Registry<ComponentDef>;
  readonly capabilities: Registry<CapabilityDef>;
  readonly triggers?: Registry<TriggerDef>;
  readonly dashboards?: Registry<DashboardDef>;
  readonly playbooks?: Registry<PlaybookDef>;
}

export interface CapabilityModuleOptions {
  readonly remoteName: string;
  readonly version: string;
  readonly tools?: readonly ToolDef[];
  readonly components?: readonly ComponentDef[];
  readonly prompts?: readonly { readonly name: string; readonly text: string }[];
  /** Post-chat-surfaces P2 (ADR-045): cron / webhook / queue triggers. */
  readonly triggers?: readonly TriggerDef[];
  /** Post-chat-surfaces P3 (ADR-044): dashboard templates. */
  readonly dashboards?: readonly DashboardDef[];
  /** Post-chat-surfaces P5: versioned tool-call sequences. */
  readonly playbooks?: readonly PlaybookDef[];
}

export interface CapabilityModule {
  readonly manifest: CapabilityManifest;
  readonly tools: readonly ToolDef[];
  readonly components: readonly ComponentDef[];
  readonly prompts: readonly { readonly name: string; readonly text: string }[];
  readonly triggers: readonly TriggerDef[];
  readonly dashboards: readonly DashboardDef[];
  readonly playbooks: readonly PlaybookDef[];
  /**
   * Register this module with the host's registries. Two call shapes:
   *
   *  - `apply(hostInjector)` — convenience for federated setups where host +
   *    remote share the lib singleton; resolves registries via DI from the
   *    host's `EnvironmentInjector`.
   *
   *  - `apply({ tools, components, capabilities, triggers?, dashboards?, playbooks? })`
   *    — for setups where each app bundles its own copy of the lib (no
   *    federation sharing). Pass the HOST'S concrete registry instances so
   *    writes land where the chat shell will read from. Triggers /
   *    dashboards / playbooks are optional — modules that don't contribute
   *    them work unchanged, hosts that don't accept them work unchanged.
   *
   * Returns a disposer that strips this remote's entries by source across
   * every contributed registry symmetrically.
   */
  apply(hostInjectorOrRegistries: EnvironmentInjector | CapabilityRegistries): () => void;
}

export function defineCapabilityModule(options: CapabilityModuleOptions): CapabilityModule {
  const source = `remote:${options.remoteName}` as const;
  const tools = (options.tools ?? []).map((t) => ({ ...t, source }));
  const components = (options.components ?? []).map((c) => ({ ...c, source }));
  const prompts = options.prompts ?? [];
  const triggers = (options.triggers ?? []).map((t) => ({ ...t, source }));
  const dashboards = (options.dashboards ?? []).map((d) => ({ ...d, source }));
  const playbooks = (options.playbooks ?? []).map((p) => ({ ...p, source }));

  const manifest: CapabilityManifest = {
    remoteName: options.remoteName,
    version: options.version,
    exposes: {
      tools: tools.map((t) => t.name),
      components: components.map((c) => c.name),
      prompts: prompts.map((p) => p.name),
      ...(triggers.length > 0 ? { triggers: triggers.map((t) => t.name) } : {}),
      ...(dashboards.length > 0 ? { dashboards: dashboards.map((d) => d.name) } : {}),
      ...(playbooks.length > 0 ? { playbooks: playbooks.map((p) => p.name) } : {}),
    },
  };

  return {
    manifest,
    tools,
    components,
    prompts,
    triggers,
    dashboards,
    playbooks,
    apply(input: EnvironmentInjector | CapabilityRegistries): () => void {
      const registries: CapabilityRegistries = isInjector(input)
        ? runInInjectionContext(input, () => ({
            tools: input.get(ToolRegistry),
            components: input.get(ComponentRegistry),
            capabilities: input.get(CapabilityRegistry),
            // Optional registries — only injected if the contributed
            // module actually has entries for them. Saves the lookup
            // (and the failed DI when adopters opted out of these
            // registries — providedIn: 'root' singletons mean they're
            // always reachable, but pulling them in only when needed
            // keeps tree-shaking honest).
            ...(triggers.length > 0 ? { triggers: input.get(TriggerRegistry) } : {}),
            ...(dashboards.length > 0 ? { dashboards: input.get(DashboardRegistry) } : {}),
            ...(playbooks.length > 0 ? { playbooks: input.get(PlaybookRegistry) } : {}),
          }))
        : input;

      const toolDispose = registries.tools.registerAll(tools);
      const componentDispose = registries.components.registerAll(components);
      const triggerDispose = triggers.length > 0 && registries.triggers
        ? registries.triggers.registerAll(triggers)
        : () => undefined;
      const dashboardDispose = dashboards.length > 0 && registries.dashboards
        ? registries.dashboards.registerAll(dashboards)
        : () => undefined;
      const playbookDispose = playbooks.length > 0 && registries.playbooks
        ? registries.playbooks.registerAll(playbooks)
        : () => undefined;

      const capabilityDef: CapabilityDef = {
        name: options.remoteName,
        source,
        ...manifest,
      };
      const capDispose = registries.capabilities.register(capabilityDef);

      return () => {
        toolDispose();
        componentDispose();
        triggerDispose();
        dashboardDispose();
        playbookDispose();
        capDispose();
        registries.tools.removeBySource(source);
        registries.components.removeBySource(source);
        registries.triggers?.removeBySource(source);
        registries.dashboards?.removeBySource(source);
        registries.playbooks?.removeBySource(source);
        registries.capabilities.removeBySource(source);
      };
    },
  };
}

function isInjector(x: EnvironmentInjector | CapabilityRegistries): x is EnvironmentInjector {
  return typeof (x as EnvironmentInjector).get === 'function' && !('tools' in x);
}
