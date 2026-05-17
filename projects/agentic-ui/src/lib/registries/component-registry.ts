import { Injectable } from '@angular/core';
import { RegistryBase } from './registry-base';
import type { ComponentDef } from '../types/registry-defs';

@Injectable({ providedIn: 'root' })
export class ComponentRegistry extends RegistryBase<ComponentDef> {
  protected readonly registryName = 'component';
}

/** Alias retained from the design plan; ComponentRegistry is canonical. */
export { ComponentRegistry as WidgetRegistry };
