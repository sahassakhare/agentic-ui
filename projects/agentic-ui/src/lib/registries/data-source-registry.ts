import { Injectable } from '@angular/core';
import { RegistryBase } from './registry-base';
import type { DataSourceDef } from '../types/registry-defs';

/**
 * Registry of data sources tools can read from. Tools call
 * `inject(DataSourceRegistry).get('flights').adapter(query)` instead of
 * hard-coding fetch URLs — enables stubbing in tests, per-env routing, and
 * MFE-aware overrides.
 */
@Injectable({ providedIn: 'root' })
export class DataSourceRegistry extends RegistryBase<DataSourceDef> {
  protected readonly registryName = 'data-source';

  byKind(kind: DataSourceDef['kind']): readonly DataSourceDef[] {
    return this.list().filter((d) => d.kind === kind);
  }
}
