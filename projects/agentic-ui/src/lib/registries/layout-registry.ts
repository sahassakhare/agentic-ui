import { Injectable } from '@angular/core';
import { RegistryBase } from './registry-base';
import type { LayoutDef } from '../types/registry-defs';

/**
 * Registry of layout components the agent can ask for. Lets the agent emit
 * `widget-render` events with a layout name + per-slot widgets, instead of
 * single components — useful for richer generative UI like split panes,
 * dashboards, or master-detail views.
 *
 * No default layouts ship; apps register their own (CDK Layout-based, Material,
 * or hand-rolled) and the agent picks from registered options.
 */
@Injectable({ providedIn: 'root' })
export class LayoutRegistry extends RegistryBase<LayoutDef> {
  protected readonly registryName = 'layout';
}
