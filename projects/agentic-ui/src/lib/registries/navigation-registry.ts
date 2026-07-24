import { Injectable } from '@angular/core';
import { RegistryBase } from './registry-base';
import type { NavigationDef } from '../types/registry-defs';

/**
 * Registry of navigation entries (AEP Seam B). Lets apps and MFEs contribute
 * nav capability-driven (contributable + persona-scopable + federation-
 * symmetric via `removeBySource`) instead of hardcoding a nav array in the
 * shell. Adds tree helpers on top of the standard registry machinery.
 */
@Injectable({ providedIn: 'root' })
export class NavigationRegistry extends RegistryBase<NavigationDef> {
  protected readonly registryName = 'navigation';

  /** All entries sorted by `order` ascending (unset sorts last, then by name). */
  ordered(): readonly NavigationDef[] {
    return [...this.list()].sort(compareNav);
  }

  /** Top-level entries (no `parent`), ordered. */
  roots(): readonly NavigationDef[] {
    return this.ordered().filter((n) => n.parent == null);
  }

  /** Direct children of `parentName`, ordered. */
  childrenOf(parentName: string): readonly NavigationDef[] {
    return this.ordered().filter((n) => n.parent === parentName);
  }
}

function compareNav(a: NavigationDef, b: NavigationDef): number {
  const ao = a.order ?? Number.POSITIVE_INFINITY;
  const bo = b.order ?? Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;
  return a.name.localeCompare(b.name);
}
