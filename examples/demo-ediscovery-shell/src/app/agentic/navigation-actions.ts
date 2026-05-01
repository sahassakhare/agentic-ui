import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { ActionRegistry, agenticAction, type ActionDef } from '@maverick/agentic-ui';
import { z } from 'zod';

/**
 * Host-side navigation actions wired into `ActionRegistry`. Tools and
 * widgets dispatch these by name, the host's effects use Angular Router
 * to navigate. This is the seam that lets a federated remote (which
 * doesn't know about the host's routes) trigger host navigation
 * without a hard import.
 *
 * @remarks
 * **Why three discrete actions instead of one generic `navigate`?**
 * Each action's payload schema validates the entity id, so widgets
 * and tools dispatch *intent* ("open this custodian") rather than
 * *implementation* ("go to /custodians?selected=CUST-001"). The host
 * is free to reshape its routes without changing the contract every
 * remote depends on.
 *
 * Each target page reads `?id=…` (or `?selected=…`) on activation and
 * auto-opens the matching row / drawer / detail view.
 */
export function registerNavigationActions(env: EnvironmentInjector): void {
  const actions = env.get(ActionRegistry);

  actions.register(
    agenticAction({
      type: 'openCustodian',
      description: 'Open the Custodians page and select the given custodian.',
      payloadSchema: z.object({
        custodianId: z.string().describe("Custodian id, e.g. 'CUST-001'"),
      }),
      effect: async ({ custodianId }) => {
        await runInInjectionContext(env, () =>
          env.get(Router).navigate(['/custodians'], { queryParams: { id: custodianId } }),
        );
      },
    }) as ActionDef,
  );

  actions.register(
    agenticAction({
      type: 'openDocument',
      description: 'Open the Documents page and slide in the detail drawer for the given document.',
      payloadSchema: z.object({
        documentId: z.string().describe("Document id, e.g. 'DOC-7891234'"),
      }),
      effect: async ({ documentId }) => {
        await runInInjectionContext(env, () =>
          env.get(Router).navigate(['/documents'], { queryParams: { id: documentId } }),
        );
      },
    }) as ActionDef,
  );

  actions.register(
    agenticAction({
      type: 'openHold',
      description: 'Open the Legal Holds page focused on the given hold.',
      payloadSchema: z.object({
        holdId: z.string().describe("Hold id, e.g. 'HOLD-001'"),
      }),
      effect: async ({ holdId }) => {
        await runInInjectionContext(env, () =>
          env.get(Router).navigate(['/holds'], { queryParams: { id: holdId } }),
        );
      },
    }) as ActionDef,
  );

  actions.register(
    agenticAction({
      type: 'openProduction',
      description: 'Open the Productions page focused on the given production set.',
      payloadSchema: z.object({
        productionId: z.string().describe("Production-set id, e.g. 'PROD-A1B2'"),
      }),
      effect: async ({ productionId }) => {
        await runInInjectionContext(env, () =>
          env.get(Router).navigate(['/productions'], { queryParams: { id: productionId } }),
        );
      },
    }) as ActionDef,
  );
}
