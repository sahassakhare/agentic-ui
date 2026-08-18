/**
 * Runtime registry of compiled validation rules (name → field validator).
 * Populated by `CatalogValidationSource` from `kind:'validation'` rows and read
 * by `CatalogFormSource` when compiling a form field's `validators: [name]`.
 *
 * A lightweight Map service (not `RegistryBase`) — a validation rule is a pure
 * function, not a governed capability entry.
 */
import { Injectable } from '@angular/core';
import type { FieldValidator } from './validation-compile';

@Injectable({ providedIn: 'root' })
export class ValidationRuleRegistry {
  private readonly rules = new Map<string, FieldValidator>();

  set(name: string, validator: FieldValidator): void { this.rules.set(name, validator); }
  clear(): void { this.rules.clear(); }
  get(name: string): FieldValidator | undefined { return this.rules.get(name); }
  get size(): number { return this.rules.size; }

  /** A stable resolver the form compiler calls per field validator name. */
  resolver(): (name: string) => FieldValidator | undefined {
    return (name) => this.rules.get(name);
  }
}
