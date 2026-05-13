import { Injectable } from '@angular/core';
import { RegistryBase } from './registry-base';
import type { PlaybookDef } from '../types/registry-defs';

/**
 * Registry of playbooks — versioned, persona-scoped, federated
 * sequences of tool calls. The 18th registry in the Extended tier.
 *
 * Like every other registry in the lib, playbooks federate via
 * `removeBySource`, scope via `setScopePolicy`, and surface in the
 * catalog ops console alongside tools / widgets / triggers /
 * dashboards. An MFE remote can ship its own playbooks
 * (*"Production-Standard Privilege Sweep v1"*) and reap them on
 * unload symmetrically.
 *
 * The `PlaybookRunner` service (in `lib/components/playbook-runner.ts`)
 * is what actually fires the steps. The registry stores definitions
 * + the version chain — same separation as `TriggerRegistry` vs.
 * `provideTriggerRunner` from [ADR-045](../../../../docs/adr/0045-trigger-registry.md).
 *
 * @see [post-chat-surfaces-plan §3 Pillar 3 + §4 Workflow G](../../../../docs/plans/post-chat-surfaces-plan.md#4-complex-workflows-worth-modelling)
 */
@Injectable({ providedIn: 'root' })
export class PlaybookRegistry extends RegistryBase<PlaybookDef> {
  protected readonly registryName = 'playbook';
}
