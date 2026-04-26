import type { ZodTypeAny, z } from 'zod';
import type { FormDef, FormFieldUi } from '../types/registry-defs';

export interface AgenticFormConfig<TSchema extends ZodTypeAny> {
  readonly name: string;
  readonly description: string;
  readonly fieldsSchema: TSchema;
  readonly ui?: Readonly<Record<string, FormFieldUi>>;
  readonly submit: (values: z.infer<TSchema>) => Promise<void> | void;
}

export function agenticForm<TSchema extends ZodTypeAny>(
  config: AgenticFormConfig<TSchema>,
): FormDef<z.infer<TSchema>> {
  return {
    name: config.name,
    description: config.description,
    fieldsSchema: config.fieldsSchema,
    ui: config.ui,
    submit: async (values) => Promise.resolve(config.submit(values)),
  };
}
