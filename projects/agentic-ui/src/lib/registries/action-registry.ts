import { Injectable } from '@angular/core';
import { RegistryBase } from './registry-base';
import type { ActionDef } from '../types/registry-defs';

/**
 * Registry of agent-issued UI actions (NgRx-style command pattern). Used by the
 * A2UI backend's `ui-action` event class — when the agent emits an action, the
 * chat shell looks up the matching `ActionDef` and runs its effect with the
 * validated payload. Apps register actions via `provideAgenticUi({...})` or
 * the {@link agenticAction} factory.
 */
@Injectable({ providedIn: 'root' })
export class ActionRegistry extends RegistryBase<ActionDef> {
  protected readonly registryName = 'action';

  /** Lookup an action by its discriminating `type` string. */
  byType(type: string): ActionDef | undefined {
    return this.list().find((a) => a.type === type);
  }
}
