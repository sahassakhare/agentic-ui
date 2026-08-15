import { Injectable } from '@angular/core';
import { RegistryBase } from './registry-base';
import type { WorkflowCapabilityDef } from '../types/registry-defs';

/**
 * Registry of workflows promoted to first-class capabilities (AEP Seam B).
 * Wraps a `WorkflowDef` step graph as a registered, versioned, discoverable
 * entry — previously workflows only existed embedded in a synthesized
 * `FormDef.workflow` and could not be addressed or federated.
 */
@Injectable({ providedIn: 'root' })
export class WorkflowRegistry extends RegistryBase<WorkflowCapabilityDef> {
  protected readonly registryName = 'workflow';
}
