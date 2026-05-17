import { Injectable, InjectionToken } from '@angular/core';

export interface ValidationResult<T = unknown> {
  readonly success: boolean;
  readonly data?: T;
  readonly errors?: readonly { readonly path: string; readonly message: string }[];
}

/**
 * Pluggable schema validator. Schemas live on registry defs as opaque values
 * — `ValidationRegistry` knows how to interpret them.
 *
 * Default implementation handles Zod schemas (since the rest of the lib uses
 * Zod). Apps register Ajv, Joi, Yup, or custom validators via
 * `provideValidator(token, validator)`.
 */
export interface SchemaValidator {
  readonly id: string;
  /** Returns true if this validator recognizes the schema. */
  accepts(schema: unknown): boolean;
  validate<T = unknown>(schema: unknown, value: unknown): ValidationResult<T>;
}

/**
 * Default Zod-backed validator. Recognizes any object with `safeParse`.
 */
export class ZodSchemaValidator implements SchemaValidator {
  readonly id = 'zod';
  accepts(schema: unknown): boolean {
    return Boolean(schema && typeof (schema as { safeParse?: unknown }).safeParse === 'function');
  }
  validate<T>(schema: unknown, value: unknown): ValidationResult<T> {
    const s = schema as { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues?: { path: (string | number)[]; message: string }[] } } };
    const r = s.safeParse(value);
    if (r.success) return { success: true, data: r.data };
    const errors = (r.error?.issues ?? []).map((iss) => ({
      path: iss.path.join('.'),
      message: iss.message,
    }));
    return { success: false, errors };
  }
}

@Injectable({ providedIn: 'root' })
export class ValidationRegistry {
  private readonly validators: SchemaValidator[] = [new ZodSchemaValidator()];

  /** Register an additional validator (e.g., Ajv, Joi, custom). Earlier registrations have higher priority. */
  registerValidator(validator: SchemaValidator): () => void {
    this.validators.unshift(validator);
    return () => {
      const idx = this.validators.indexOf(validator);
      if (idx >= 0) this.validators.splice(idx, 1);
    };
  }

  validate<T = unknown>(schema: unknown, value: unknown): ValidationResult<T> {
    const validator = this.validators.find((v) => v.accepts(schema));
    if (!validator) {
      return { success: false, errors: [{ path: '', message: 'No validator accepts this schema.' }] };
    }
    return validator.validate<T>(schema, value);
  }
}

export const ADDITIONAL_VALIDATORS = new InjectionToken<readonly SchemaValidator[]>(
  'ADDITIONAL_VALIDATORS',
  { providedIn: 'root', factory: () => [] },
);
