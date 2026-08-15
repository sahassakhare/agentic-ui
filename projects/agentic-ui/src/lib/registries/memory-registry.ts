import { Injectable } from '@angular/core';
import { RegistryBase } from './registry-base';
import type { MemoryDef } from '../types/registry-defs';

/**
 * Registry of memory providers (AEP Seam B; aligns to ROADMAP Tier 1.4
 * "Long-term memory registry"). Metadata only — the provider adapter performs
 * storage/retrieval.
 */
@Injectable({ providedIn: 'root' })
export class MemoryRegistry extends RegistryBase<MemoryDef> {
  protected readonly registryName = 'memory';

  /** Memory providers of a given kind ('long-term', 'episodic', …). */
  byKind(kind: string): readonly MemoryDef[] {
    return this.list().filter((m) => m.kind === kind);
  }
}
