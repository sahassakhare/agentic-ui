import { Injectable } from '@angular/core';
import { RegistryBase } from './registry-base';
import type { TriggerDef } from '../types/registry-defs';

/**
 * Registry of triggers — agent-emitted tool calls that fire on a schedule,
 * a webhook, or a queue event instead of user input.
 *
 * Triggers join the Extended tier alongside `ActionRegistry`,
 * `IntentRegistry`, `FormRegistry`, `DataSourceRegistry`, `ApprovalRegistry`,
 * `OperationRegistry`. Standard `register / list / signal / removeBySource /
 * setScopePolicy` machinery; ~30 LOC of base-class extension per
 * [ADR-045 D1](../../../../docs/adr/0045-trigger-registry.md#d1--triggerregistry-is-a-new-registrybasetriggerdef-in-the-extended-tier).
 *
 * Registration is independent of *firing*. A trigger registered here is
 * visible (and persona-scopable, and auditable, and federation-symmetric)
 * but only fires when a `TriggerRunner` has been wired via
 * `provideTriggerRunner({...})`. Apps that register triggers but don't
 * wire a runner still get the catalog / ops-console listing and the
 * `removeBySource` symmetry — just no automatic invocation.
 *
 * @see [ADR-045 — TriggerRegistry](../../../../docs/adr/0045-trigger-registry.md)
 */
@Injectable({ providedIn: 'root' })
export class TriggerRegistry extends RegistryBase<TriggerDef> {
  protected readonly registryName = 'trigger';
}
