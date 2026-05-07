import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { agenticForm, FormRegistry, type FormDef } from '@maverick/agentic-ui';
import { z } from 'zod';
import { createProductionSetTool } from '../tools/create-production-set.tool';

const PATTERN_RE = /^[A-Z][A-Z0-9_-]*-\{seq:\d+d\}$/;

/**
 * `productionConfigForm` — schema-driven confirmation form rendered
 * via `<mvk-form-renderer>`. The agent populates the fields with its
 * proposed values; the user reviews and submits. Submission calls
 * the same `createProductionSetTool` handler the agent would call —
 * one domain handler, two surfaces (form + tool).
 */
export function registerProductionConfigForm(env: EnvironmentInjector): void {
  env.get(FormRegistry).register(
    agenticForm({
      name: 'productionConfigForm',
      description:
        'Confirmation form for a new production set. Use when the agent has the ' +
        'shape of the request but the user should sign off on Bates pattern, ' +
        'format, and scope before the set is created.',
      fieldsSchema: z.object({
        name: z.string().min(3).describe('Set name'),
        format: z.enum(['native', 'tiff', 'pdf', 'load-file']).describe('Delivery format'),
        batesPattern: z.string()
          .regex(PATTERN_RE, "Pattern must look like 'ACME-{seq:07d}'")
          .describe('Bates pattern'),
        includeResponsive: z.boolean().describe('Include `responsive` docs'),
        excludePrivileged: z.boolean().describe('Exclude privileged docs'),
        authoredAfter: z.string().optional().describe('ISO date — start of window'),
        authoredBefore: z.string().optional().describe('ISO date — end of window'),
      }),
      ui: {
        name:             { order: 1, placeholder: 'PROD-002 — Q1 responsive' },
        format:           { order: 2 },
        batesPattern:     { order: 3, placeholder: 'ACME-{seq:07d}' },
        includeResponsive:{ order: 4 },
        excludePrivileged:{ order: 5 },
        authoredAfter:    { order: 6, placeholder: '2025-01-01' },
        authoredBefore:   { order: 7, placeholder: '2025-03-31' },
      },
      submit: async (values) => {
        await runInInjectionContext(env, async () => {
          await createProductionSetTool.handler(
            {
              name: values.name,
              format: values.format,
              batesPattern: values.batesPattern,
              scope: {
                includeTags: values.includeResponsive ? ['responsive'] : [],
                excludePrivileged: values.excludePrivileged,
                authoredAfter: values.authoredAfter,
                authoredBefore: values.authoredBefore,
              },
            },
            syntheticToolContext(),
          );
        });
      },
    }) as FormDef,
  );
}

function syntheticToolContext() {
  const id = `form-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    threadId: 'form',
    runId: id,
    toolCallId: id,
    signal: new AbortController().signal,
    // Capability F5 LRO surface — the form path is synchronous so
    // these are typed stubs. Tools that need real LRO from a form
    // submit would route through ToolRegistry + chat-shell instead.
    startOperation: () => `op-form-${Date.now()}`,
    reportProgress: () => undefined,
    completeOperation: () => undefined,
    failOperation: () => undefined,
  };
}
