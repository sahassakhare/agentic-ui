import { Injectable } from '@angular/core';
import { TemplateRegistryBase } from './template-registry-base';
import type { DashboardTemplate } from './types';

/**
 * ADR-046 D6 — registry of named `DashboardTemplate` entries. Parallel
 * to `LayoutTemplateRegistry` but for dashboards.
 *
 * Composition with the existing `DashboardRegistry` (ADR-044):
 *   - This registry holds *templates* with approval workflow + metadata.
 *   - The existing `DashboardRegistry` holds *active* dashboards bound
 *     to the canvas + picker. Adopters wire a flow:
 *       1. User picks a template from this registry.
 *       2. Instantiation (with parameters, if any) produces a fresh
 *          `DashboardDef`.
 *       3. The produced def is `register()`-ed into `DashboardRegistry`
 *          with `source: 'user'` (same as the existing Phase A/B path).
 *   - Approval-gated by default: only `approvalState === 'approved'`
 *     templates show up in the user-facing picker.
 */
@Injectable({ providedIn: 'root' })
export class DashboardTemplateRegistry extends TemplateRegistryBase<DashboardTemplate> {}
