import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import {
  agenticDataSource,
  agenticForm,
  agenticTool,
  agenticWidget,
  DataSourceRegistry,
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
import { PersonaService } from '../services/persona.service';
import { CustodianCardComponent } from './custodian-card.component';
import { CustodianIntakeCardComponent } from './custodian-intake-card.component';
import {
  IntakeAccountingSystemsComponent,
  IntakeIdentityComponent,
  IntakeRegulatoryConsentComponent,
  IntakeSupervisorPickerComponent,
} from './intake-sections.component';
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
    listLegalHoldsTool(env) as ToolDef,
    placeLegalHoldTool(env) as ToolDef,
    releaseLegalHoldTool(env) as ToolDef,
    acknowledgeLegalHoldTool(env) as ToolDef,
    openCustodianIntakeTool(env) as ToolDef,
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
  // ── F1 — composable intake form section widgets ────────────────────────
  agenticWidget({
    name: 'intake-identity-fields',
    component: IntakeIdentityComponent,
    propsSchema: z.object({}),
  }),
  agenticWidget({
    name: 'intake-regulatory-consent',
    component: IntakeRegulatoryConsentComponent,
    propsSchema: z.object({}),
  }),
  agenticWidget({
    name: 'intake-supervisor-picker',
    component: IntakeSupervisorPickerComponent,
    propsSchema: z.object({}),
    // Capability F2: declares the data sources the widget consumes.
    // Mount-time machinery verifies `users` is registered before
    // instantiating the component; missing source surfaces an inline
    // diagnostic instead of a silently-broken widget.
    dataSources: ['users'],
  }),
  agenticWidget({
    name: 'intake-accounting-systems',
    component: IntakeAccountingSystemsComponent,
    propsSchema: z.object({}),
  }),
  // F1 form-card wrapper — agent emits this to surface the composed form.
  agenticWidget({
    name: 'custodianIntakeCard',
    component: CustodianIntakeCardComponent,
    propsSchema: z.object({
      matterType: z.string(),
      persona: z.string(),
      department: z.string().optional(),
    }),
  }),
];

/**
 * Capability F2 — directory data source.
 *
 * The intake form's supervisor picker declares `dataSources: ['users']`.
 * Registering the source here populates autocomplete suggestions; mount-time
 * machinery refuses to instantiate the widget without it (AC-F2-1).
 *
 * Production deployments swap this `agenticDataSource` for a `restDataSource`
 * pointing at the firm's directory; the widget code is unchanged (AC-F2-3).
 */
export interface DirectoryUser {
  readonly email: string;
  readonly name: string;
  readonly role: string;
}

export interface DirectoryUserQuery {
  readonly prefix?: string;
  readonly role?: string;
}

const MOCK_DIRECTORY: readonly DirectoryUser[] = [
  { email: 'eleanor.vance@acme.example',     name: 'Eleanor Vance',     role: 'lead-counsel' },
  { email: 'marcus.osei@acme.example',       name: 'Marcus Osei',       role: 'associate' },
  { email: 'priya.shah@acme.example',        name: 'Priya Shah',        role: 'lit-support' },
  { email: 'james.obrien@acme.example',      name: 'James OBrien',      role: 'paralegal' },
  { email: 'diana.matsunaga@acme.example',   name: 'Diana Matsunaga',   role: 'associate' },
] as const;

export function registerDataSources(env: EnvironmentInjector): void {
  env.get(DataSourceRegistry).register(
    agenticDataSource<DirectoryUserQuery, Promise<readonly DirectoryUser[]>>({
      name: 'users',
      kind: 'rest',
      adapter: async (query) => {
        const prefix = (query.prefix ?? '').toLowerCase().trim();
        const role = query.role?.toLowerCase();
        return MOCK_DIRECTORY.filter((u) => {
          const matchesPrefix = prefix === ''
            || u.name.toLowerCase().includes(prefix)
            || u.email.toLowerCase().includes(prefix);
          const matchesRole = !role || u.role === role;
          return matchesPrefix && matchesRole;
        });
      },
    }),
  );
}

/**
 * Register the custodian intake form (Capability F1 — composable form).
 *
 * The form is composed at runtime from four section widgets. Conditional
 * sections evaluate against the form context (matter type + persona +
 * department) at render time:
 *   - Identity                — always
 *   - Compliance disclosure   — when matter.type === 'securities'
 *   - Supervisor sign-off     — when persona !== 'lead-counsel'
 *   - Accounting systems      — when department === 'Finance'
 *
 * Per-section value aggregation lands in AC-F1-2; this slice demonstrates
 * the composition + reactive toggle, with submit stubbed to add a placeholder
 * custodian until the aggregation contract is finalised.
 */
export function registerForms(env: EnvironmentInjector): void {
  env.get(FormRegistry).register(
    agenticForm({
      name: 'custodianIntakeForm',
      description:
        'Intake details for a new custodian, composed at runtime based on the ' +
        'matter type, requesting persona, and the custodian’s department.',
      composition: [
        { widget: 'intake-identity-fields',     section: 'Identity' },
        { widget: 'intake-regulatory-consent',  section: 'Compliance', if: 'matter.type === "securities"' },
        { widget: 'intake-supervisor-picker',   section: 'Approval',   if: 'persona !== "lead-counsel"' },
        { widget: 'intake-accounting-systems',  section: 'Discovery',  if: 'department === "Finance"' },
      ],
      submit: async (values) => {
        // The form-renderer aggregates per-slot values from the
        // CompositionStore and passes the snapshot here. Slot keys mirror
        // the `widget` names declared in the composition above.
        const identity = (values['intake-identity-fields'] ?? {}) as {
          name?: string; email?: string; department?: string;
        };
        const regulatoryAck = Boolean(values['intake-regulatory-consent']);
        const supervisor = (values['intake-supervisor-picker'] as string | undefined) ?? '';
        const accountingSystems = (values['intake-accounting-systems'] as readonly string[] | undefined) ?? [];

        runInInjectionContext(env, () => {
          const store = env.get(MatterStore);
          const custodian: Custodian = {
            id: nextCustodianId(),
            matterId: store.matterId,
            name: identity.name?.trim() || 'Unnamed custodian',
            email: identity.email?.trim() || 'unknown@acme.example',
            department: identity.department?.trim() || 'Unspecified',
            hasLegalHold: false,
            collectionStatus: 'pending',
            documentCount: 0,
          };
          store.addCustodian(custodian);
          // Demo wiring stops at the custodian record. In a real flow,
          // regulatory ack + supervisor sign-off + accounting-system list
          // would feed dedicated audit-chain entries (Phase 5 hooks).
          // eslint-disable-next-line no-console
          console.info('[custodianIntake] submitted', {
            custodianId: custodian.id,
            regulatoryAck,
            supervisor,
            accountingSystems,
          });
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

function listLegalHoldsTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'listLegalHolds',
    description:
      'List legal holds on the active matter, optionally filtered by acknowledgement ' +
      'status (pending vs acknowledged) or whether the hold is still active. ' +
      'Use this when the user asks "show pending hold acknowledgements", "which ' +
      'holds are open", or anything about hold status.',
    schema: z.object({
      status: z.enum(['pending', 'acknowledged', 'released', 'all']).optional()
        .describe('Filter: pending = not yet acknowledged; acknowledged = ack received; released = hold lifted; all (default) = no filter'),
    }),
    handler: async ({ status }) => {
      return runInInjectionContext(env, () => {
        const store = env.get(MatterStore);
        let list = store.legalHolds();
        if (status === 'pending')      list = list.filter((h) => !h.acknowledgedAt && !h.releasedAt);
        else if (status === 'acknowledged') list = list.filter((h) => h.acknowledgedAt && !h.releasedAt);
        else if (status === 'released')     list = list.filter((h) => !!h.releasedAt);

        const verdict = (h: { acknowledgedAt?: string; releasedAt?: string }) =>
          h.releasedAt ? 'released' : h.acknowledgedAt ? 'acknowledged' : 'pending';

        return {
          count: list.length,
          status: status ?? 'all',
          holds: list.map((h) => ({
            id: h.id, scope: h.scope, custodianCount: h.custodianIds.length,
            issuedAt: h.issuedAt, acknowledgedAt: h.acknowledgedAt ?? null,
            releasedAt: h.releasedAt ?? null, verdict: verdict(h),
          })),
          // Render up to 3 hold cards inline; the LLM summarises the rest.
          components: list.slice(0, 3).map((h) => ({
            name: 'legalHoldCard',
            props: {
              holdId: h.id, scope: h.scope, custodianCount: h.custodianIds.length,
              issuedAt: h.issuedAt,
              acknowledged: !!h.acknowledgedAt,
              released: !!h.releasedAt,
            },
          })),
          markdown: list.length === 0
            ? `No legal holds match status="${status ?? 'all'}".`
            : `Found **${list.length}** hold(s) (${status ?? 'all'}):\n\n` +
              list.map((h) =>
                `- \`${h.id}\` — ${verdict(h)} · ${h.custodianIds.length} custodian(s)\n  > ${h.scope}`
              ).join('\n'),
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

/**
 * Capability F1 — surface the composable custodian-intake form.
 *
 * The agent calls this when the user wants to onboard a custodian. The
 * tool returns a `custodianIntakeCard` widget; the chat shell mounts it,
 * the wrapper instantiates `<mvk-form-renderer>`, and the form composes
 * itself based on the active persona, the matter type, and any department
 * the user mentioned. Sections appear/disappear as the context changes.
 */
function openCustodianIntakeTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'openCustodianIntake',
    description:
      'Open the runtime-composed custodian intake form. Use whenever the ' +
      'user wants to onboard a new custodian. The form renders different ' +
      'sections (compliance disclosure, supervisor sign-off, accounting ' +
      'system picker) based on matter type, persona, and the custodian’s ' +
      'department. Pass `department` if the user mentioned it; otherwise ' +
      'leave it blank and the form will skip the accounting-systems section.',
    schema: z.object({
      department: z.string().optional()
        .describe("The custodian's department (e.g. 'Finance', 'Engineering')"),
      matterType: z.string().optional()
        .describe("Matter type override (defaults to 'securities' for the demo Project Phoenix matter)"),
    }),
    handler: async ({ department, matterType }) => {
      return runInInjectionContext(env, () => {
        const persona = env.get(PersonaService).active();
        return {
          components: [{
            name: 'custodianIntakeCard',
            props: {
              matterType: matterType ?? 'securities',
              persona,
              department: department ?? '',
            },
          }],
          markdown:
            `Opening custodian intake for matter type **${matterType ?? 'securities'}**, ` +
            `persona **${persona}**${department ? `, department **${department}**` : ''}.`,
        };
      });
    },
  });
}
