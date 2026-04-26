import { Injectable } from '@angular/core';
import { RegistryBase } from './registry-base';
import type { ToolDef } from '../types/registry-defs';

@Injectable({ providedIn: 'root' })
export class ToolRegistry extends RegistryBase<ToolDef> {
  protected readonly registryName = 'tool';
}
