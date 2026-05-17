import { Injectable } from '@angular/core';
import { TemplateRegistryBase } from './template-registry-base';
import type { LayoutTemplate } from './types';

/**
 * ADR-046 D6 — registry of named `LayoutTemplate` entries. Adopters
 * publish org-level baseline layouts, matter leads override per
 * matter, end users save personal tweaks. Each template carries
 * approval state + audit chain + parameters.
 *
 * Composition with `LayoutResolver` (PR1 D1):
 *   - An adopter writes a custom `LayoutInput` that reads from this
 *     registry and emits `LayoutRule`s for the approved templates
 *     applicable to the current scope.
 *   - The Resolver merges those rules with route / persona / agent
 *     rules via the precedence model (PR1 D2).
 *
 * Composition with `LayeredLayoutStore` (PR2 D2/D3):
 *   - The registry is in-memory; persistence is the LayeredLayoutStore's
 *     responsibility. An adopter wires `provideEnvironmentInitializer`
 *     to: read every persisted template via the user/matter/org tiers,
 *     register them into this registry at boot.
 */
@Injectable({ providedIn: 'root' })
export class LayoutTemplateRegistry extends TemplateRegistryBase<LayoutTemplate> {}
