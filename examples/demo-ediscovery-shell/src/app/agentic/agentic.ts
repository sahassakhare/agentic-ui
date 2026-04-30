import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import {
  agenticForm,
  agenticTool,
  agenticWidget,
  FormRegistry,
  type ComponentDef,
  type FormDef,
  type ToolDef,
} from '@maverick/agentic-ui';
import {
  isoNow,
  nextCustodianId,
  nextLegalHoldId,
  type Custodian,
} from '@maverick/demo-ediscovery-shared';
import { z } from 'zod';
import { MatterStore } from '../services/matter.store';
import { CustodianCardComponent } from './custodian-card.component';
import { LegalHoldCardComponent } from './legal-hold-card.component';

/**
 * Phase 1 — collection-domain tools, widgets, and an intake form.
 *
 * @remarks
 * Every tool runs `executeIn: 'host'` (default) — the handler captures
 * the `EnvironmentInjector` at registration time and uses
 * `runInInjectionContext` to reach `MatterStore`. Mutations land on the
 * store's signals, the dashboard re-renders automatically, and an audit
 * event is appended for every change.
 *
 * Phase 2+ adds review / production / search tools as separate MFE
 * remotes federated into this host.
 */
export function buildTools(env: EnvironmentInjector): ToolDef[] {
  return [
    addCustodianTool(env) as ToolDef,
    listCustodiansTool(env) as ToolDef,
    placeLegalHoldTool(env) as ToolDef,
    releaseLegalHoldTool(env) as ToolDef,
    acknowledgeLegalHoldTool(env) as ToolDef,
  ];
}

export const widgets: ComponentDef[] = [
  agenticWidget({
    name: 'custodianCard',
    component: CustodianCardComponent,
    propsSchema: z.object({
      custodianId: z.string(),
      name: z.string(),
      email: z.string(),
      department: z.string(),
      hasLegalHold: z.boolean(),
      collectionStatus: z.string(),
      documentCount: z.number(),
    }),
  }),
  agenticWidget({
    name: 'legalHoldCard',
    component: LegalHoldCardComponent,
    propsSchema: z.object({
      holdId: z.string(),
      scope: z.string(),
      custodianCount: z.number(),
      issuedAt: z.string(),
      acknowledged: z.boolean(),
      released: z.boolean(),
    }),
  }),
];

/**
 * Register the custodian intake form. The form is available via
 * `FormRegistry`, so callers (the future `editCustodianForm` schematic
 * in Phase 4 + the chat shell's slash-command surface) can render it
 * when the user's request lacks the fields `addCustodian` requires.
 */
export function registerForms(env: EnvironmentInjector): void {
  env.get(FormRegistry).register(
    agenticForm({
      name: 'custodianIntakeForm',
      description: 'Intake details for a new custodian.',
      fieldsSchema: z.object({
        name: z.string().min(1).describe('Full name'),
        email: z.string().email().describe('Work email'),
        department: z.string().min(1).describe('Department / org unit'),
      }),
      ui: {
        name: { order: 1, placeholder: 'Sarah Chen' },
        email: { order: 2, placeholder: 'sarah.chen@acme.example' },
        department: { order: 3, placeholder: 'Engineering' },
      },
      submit: async (values) => {
        runInInjectionContext(env, () => {
          const store = env.get(MatterStore);
          const custodian: Custodian = {
            id: nextCustodianId(),
            matterId: store.matterId,
            name: values.name,
            email: values.email,
            department: values.department,
            hasLegalHold: false,
            collectionStatus: 'pending',
            documentCount: 0,
          };
          store.addCustodian(custodian);
        });
      },
    }) as FormDef,
  );
}

// ─── Tool factories ──────────────────────────────────────────────────────

function addCustodianTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'addCustodian',
    description:
      'Add a new custodian to the active matter. Use when the user provides ' +
      'a name, email, and department. If any field is missing, do NOT call this — ' +
      'the user should fill the intake form instead.',
    schema: z.object({
      name: z.string().min(1).describe('Full name'),
      email: z.string().email().describe('Work email address'),
      department: z.string().min(1).describe('Department or org unit'),
    }),
    handler: async ({ name, email, department }) => {
      return runInInjectionContext(env, () => {
        const store = env.get(MatterStore);
        const custodian: Custodian = {
          id: nextCustodianId(),
          matterId: store.matterId,
          name,
          email,
          department,
          hasLegalHold: false,
          collectionStatus: 'pending',
          documentCount: 0,
        };
        store.addCustodian(custodian);
        return {
          ...custodian,
          components: [{ name: 'custodianCard', props: custodian }],
          markdown:
            `**Custodian added** — \`${custodian.id}\`\n\n` +
            `| Name | ${custodian.name} |\n|---|---|\n` +
            `| Email | ${custodian.email} |\n` +
            `| Department | ${custodian.department} |\n` +
            `| Hold | none |\n` +
            `| Collection | pending |`,
        };
      });
    },
  });
}

function listCustodiansTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'listCustodians',
    description:
      'List custodians on the active matter, optionally filtered by hold status, ' +
      'collection status, or department.',
    schema: z.object({
      onHold: z.boolean().optional().describe('Only return custodians with an active legal hold'),
      collectionStatus: z.enum(['pending', 'in-progress', 'complete']).optional(),
      department: z.string().optional(),
    }),
    handler: async ({ onHold, collectionStatus, department }) => {
      return runInInjectionContext(env, () => {
        const store = env.get(MatterStore);
        let list = store.custodians();
        if (onHold !== undefined) list = list.filter((c) => c.hasLegalHold === onHold);
        if (collectionStatus) list = list.filter((c) => c.collectionStatus === collectionStatus);
        if (department) list = list.filter((c) => c.department.toLowerCase() === department.toLowerCase());
        return {
          count: list.length,
          custodians: list.map((c) => ({ id: c.id, name: c.name, department: c.department, hasLegalHold: c.hasLegalHold })),
          // Render the first three as cards; the LLM summarises the rest in text.
          components: list.slice(0, 3).map((c) => ({
            name: 'custodianCard',
            props: {
              custodianId: c.id, name: c.name, email: c.email, department: c.department,
              hasLegalHold: c.hasLegalHold, collectionStatus: c.collectionStatus, documentCount: c.documentCount,
            },
          })),
          markdown: list.length === 0
            ? 'No custodians match those filters.'
            : `Found **${list.length}** custodian(s):\n\n` +
              list.map((c) => `- **${c.name}** (${c.department})${c.hasLegalHold ? ' · on hold' : ''}`).join('\n'),
        };
      });
    },
  });
}

function placeLegalHoldTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'placeLegalHold',
    description:
      'Issue a legal hold covering one or more custodians. The scope is a free-text ' +
      'description that goes in the audit log and will be sent to custodians as the ' +
      "hold notice. Resolve custodian names to ids first via listCustodians if you don't have them.",
    schema: z.object({
      custodianIds: z.array(z.string()).min(1).describe('Custodian ids the hold covers'),
      scope: z.string().min(10).describe('Plain-English scope, e.g. "All emails about Project Phoenix from 2024-09 onward"'),
    }),
    handler: async ({ custodianIds, scope }) => {
      return runInInjectionContext(env, () => {
        const store = env.get(MatterStore);
        const validIds = custodianIds.filter((id) => store.custodians().some((c) => c.id === id));
        if (validIds.length === 0) {
          return {
            error: 'No matching custodian ids',
            providedIds: custodianIds,
            markdown: '⚠️ No matching custodian ids. Try `listCustodians` first to get the right ids.',
          };
        }
        const hold = {
          id: nextLegalHoldId(),
          matterId: store.matterId,
          custodianIds: validIds,
          scope,
          issuedAt: isoNow(),
        };
        store.addLegalHold(hold);
        return {
          ...hold,
          components: [{
            name: 'legalHoldCard',
            props: {
              holdId: hold.id,
              scope: hold.scope,
              custodianCount: hold.custodianIds.length,
              issuedAt: hold.issuedAt,
              acknowledged: false,
              released: false,
            },
          }],
          markdown:
            `**Hold issued** — \`${hold.id}\` covering **${validIds.length}** custodian(s).\n\n` +
            `> ${scope}`,
        };
      });
    },
  });
}

function releaseLegalHoldTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'releaseLegalHold',
    description:
      'Release an existing legal hold. **Destructive** — always confirm with the user ' +
      'and capture a reason for the audit trail before calling this.',
    schema: z.object({
      holdId: z.string().describe("Legal hold id, e.g. 'HOLD-001'"),
      reason: z.string().min(5).describe('Why the hold is being released — required for audit'),
    }),
    handler: async ({ holdId, reason }) => {
      return runInInjectionContext(env, () => {
        const released = env.get(MatterStore).releaseLegalHold(holdId, reason);
        if (!released) {
          return { error: `Unknown hold: ${holdId}`, markdown: `⚠️ No hold with id \`${holdId}\`.` };
        }
        return {
          ...released,
          components: [{
            name: 'legalHoldCard',
            props: {
              holdId: released.id,
              scope: released.scope,
              custodianCount: released.custodianIds.length,
              issuedAt: released.issuedAt,
              acknowledged: Boolean(released.acknowledgedAt),
              released: true,
            },
          }],
          markdown: `**Hold released** — \`${released.id}\`\n\n> ${reason}`,
        };
      });
    },
  });
}

function acknowledgeLegalHoldTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'acknowledgeLegalHold',
    description: 'Mark a legal hold as acknowledged by the custodian.',
    schema: z.object({
      holdId: z.string().describe("Legal hold id, e.g. 'HOLD-001'"),
    }),
    handler: async ({ holdId }) => {
      return runInInjectionContext(env, () => {
        const updated = env.get(MatterStore).acknowledgeLegalHold(holdId);
        if (!updated) {
          return { error: `Unknown hold: ${holdId}`, markdown: `⚠️ No hold with id \`${holdId}\`.` };
        }
        return {
          ...updated,
          markdown: `**Hold acknowledged** — \`${updated.id}\` at ${updated.acknowledgedAt}.`,
        };
      });
    },
  });
}
