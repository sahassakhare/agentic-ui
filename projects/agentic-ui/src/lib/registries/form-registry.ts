import { Injectable } from '@angular/core';
import { RegistryBase } from './registry-base';
import type { FormDef } from '../types/registry-defs';

/**
 * Registry of schema-driven forms the agent can ask the user to complete.
 * Each form pairs a Zod fields schema with a submit handler; the
 * `<mvk-form-renderer>` component renders fields, validates input via the
 * configured `ValidationRegistry`, and invokes `submit` on success.
 */
@Injectable({ providedIn: 'root' })
export class FormRegistry extends RegistryBase<FormDef> {
  protected readonly registryName = 'form';
}
