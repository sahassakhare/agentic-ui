import { Injectable } from '@angular/core';
import { RegistryBase } from './registry-base';
import type { CapabilityDef } from '../types/registry-defs';

/**
 * Indexes loaded MFE remotes and the capabilities (tools, components, actions,
 * forms, prompts) each one exposes. Populated by `loadRemoteCapabilities()`
 * (see `@maverick/agentic-ui/mfe`); read by the chat shell's system-prompt
 * builder and by the run orchestrator when routing tool calls back to the
 * owning remote.
 */
@Injectable({ providedIn: 'root' })
export class CapabilityRegistry extends RegistryBase<CapabilityDef> {
  protected readonly registryName = 'capability';

  /** Lookup the capability record for a given remote (CapabilityDef.name === remoteName). */
  byRemote(remoteName: string): CapabilityDef | undefined {
    return this.get(remoteName);
  }

  /** Find which remote owns a given tool name, if any. */
  forTool(toolName: string): string | undefined {
    return this.list().find((c) => c.exposes.tools.includes(toolName))?.remoteName;
  }

  /** Find which remote owns a given component (widget) name, if any. */
  forComponent(componentName: string): string | undefined {
    return this.list().find((c) => c.exposes.components.includes(componentName))?.remoteName;
  }
}
