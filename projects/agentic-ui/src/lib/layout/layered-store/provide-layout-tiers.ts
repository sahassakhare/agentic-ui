import type { EnvironmentProviders, Provider } from '@angular/core';
import { makeEnvironmentProviders } from '@angular/core';
import { LAYOUT_TIER, type LayoutTier } from './types';

/**
 * Wire one or more `LayoutTier`s into the DI tree. Each tier is
 * registered as a multi-provider against `LAYOUT_TIER`; the
 * `LayeredLayoutStore` injects the combined array.
 *
 * Order matters — earlier tiers in the input array take precedence on
 * `read()`. Typical wiring:
 *
 * ```ts
 * provideLayoutTiers([
 *   { ...STANDARD_LAYOUT_TIERS.userSaved,   scope: () => userId() },
 *   { ...STANDARD_LAYOUT_TIERS.matterDefault, scope: () => matterId() },
 *   { ...STANDARD_LAYOUT_TIERS.orgDefault,   scope: () => tenantId() },
 * ])
 * ```
 *
 * @see [ADR-046 D2 + D3](../../../../../docs/adr/0046-layered-layout-engine.md)
 */
export function provideLayoutTiers(tiers: readonly LayoutTier[]): EnvironmentProviders {
  const providers: Provider[] = tiers.map((tier) => ({
    provide: LAYOUT_TIER,
    useValue: tier,
    multi: true,
  }));
  return makeEnvironmentProviders(providers);
}
