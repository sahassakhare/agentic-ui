import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { RenderHandoffStore } from '../services/render-handoff.store';
import {
  agenticApproval,
  agenticDataSource,
  agenticForm,
  agenticTool,
  agenticWidget,
  agenticWorkflow,
  ApprovalCardComponent,
  ApprovalRegistry,
  DataSourceRegistry,
  FormRegistry,
  OperationProgressComponent,
  type ComponentDef,
  type FormDef,
  type ToolDef,
} from '@maverick/agentic-ui';
import { ApprovalSummaryDiffComponent } from './approval-summary-diff.component';
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
import { DynamicFormCardComponent } from './dynamic-form-card.component';
import {
  IntakeAccountingSystemsComponent,
  IntakeIdentityComponent,
  IntakeRegulatoryConsentComponent,
  IntakeSupervisorPickerComponent,
} from './intake-sections.component';
import { LegalHoldCardComponent } from './legal-hold-card.component';
import { PlaceLegalHoldCardComponent } from './place-legal-hold-card.component';
import {
  PlaceHoldCustodiansComponent,
  PlaceHoldDatesComponent,
  PlaceHoldKeywordsComponent,
  PlaceHoldMatterSetupComponent,
  PlaceHoldPreviewComponent,
} from './place-hold-steps.component';
import {
  ApprovalStepComponent,
  CollectPreviewStepComponent,
  CollectStepComponent,
  CustodianSelectStepComponent,
  MatterSetupStepComponent,
} from './place-hold-collect-steps.component';

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
    generateCustodianIntakeFormTool() as ToolDef,
    openPlaceLegalHoldWorkflowTool() as ToolDef,
    runTARClassifierTool() as ToolDef,
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
      // Persona is optional — the widget reads the live persona from
      // PersonaService so the form's predicate context stays reactive
      // when the user switches persona via the header dropdown.
      persona: z.string().optional(),
      department: z.string().optional(),
    }),
  }),
  // ── F3 — placeLegalHold workflow step widgets ──────────────────────────
  agenticWidget({
    name: 'place-hold-keywords',
    component: PlaceHoldKeywordsComponent,
    propsSchema: z.object({}),
  }),
  agenticWidget({
    name: 'place-hold-custodians',
    component: PlaceHoldCustodiansComponent,
    propsSchema: z.object({}),
  }),
  agenticWidget({
    name: 'place-hold-dates',
    component: PlaceHoldDatesComponent,
    propsSchema: z.object({}),
  }),
  agenticWidget({
    name: 'place-hold-preview',
    component: PlaceHoldPreviewComponent,
    propsSchema: z.object({}),
  }),
  agenticWidget({
    name: 'place-hold-matter-setup',
    component: PlaceHoldMatterSetupComponent,
    propsSchema: z.object({}),
  }),
  // ── R5 — placeLegalHoldAndCollect step widgets (multi-actor + HITL + LRO)
  agenticWidget({
    name: 'collect-step-matter-setup',
    component: MatterSetupStepComponent,
    propsSchema: z.object({}),
  }),
  agenticWidget({
    name: 'collect-step-custodians',
    component: CustodianSelectStepComponent,
    propsSchema: z.object({}),
  }),
  agenticWidget({
    name: 'collect-step-approval',
    component: ApprovalStepComponent,
    propsSchema: z.object({}),
  }),
  agenticWidget({
    name: 'collect-step-collect',
    component: CollectStepComponent,
    propsSchema: z.object({}),
  }),
  agenticWidget({
    name: 'collect-step-preview',
    component: CollectPreviewStepComponent,
    propsSchema: z.object({}),
  }),
  // F3 workflow-card wrapper.
  agenticWidget({
    name: 'placeLegalHoldCard',
    component: PlaceLegalHoldCardComponent,
    propsSchema: z.object({}),
  }),
  // ── F4 — approval card + generic diff renderer ────────────────────────
  // The chat-shell intercept emits `{components: [{name: 'mvk-approval-card', ...}]}`
  // when a tool call needs HITL — register the lib's built-in card under
  // that exact name so widget-container can resolve it.
  agenticWidget({
    name: 'mvk-approval-card',
    component: ApprovalCardComponent,
    propsSchema: z.object({ approvalId: z.string() }),
  }),
  // Generic diff renderer used by every approval policy in this demo.
  // Production deployments would register tool-specific diffs.
  agenticWidget({
    name: 'approval-summary-diff',
    component: ApprovalSummaryDiffComponent,
    propsSchema: z.object({}),
  }),
  // ── F5 — long-running operation progress widget ────────────────────────
  // The chat-shell renders this whenever a long-running tool returns
  // `components: [{name: 'mvk-operation-progress', props: {opId}}]`.
  agenticWidget({
    name: 'mvk-operation-progress',
    component: OperationProgressComponent,
    propsSchema: z.object({ opId: z.string() }),
  }),
  // ── F1 (Approach 2) — fully agent-generated form ───────────────────────
  // The agent emits the entire form schema as the tool argument; the
  // widget validates + renders. Compare with `custodianIntakeCard`
  // above (Approach 1) which mounts a registered FormDef and gates
  // pre-built section widgets via predicates.
  agenticWidget({
    name: 'dynamicFormCard',
    component: DynamicFormCardComponent,
    // Pass-through: the strict shape lives inside the widget
    // (`dynamicFormSchema` Zod), so the agent can emit any reasonable
    // form spec and the widget reports parse errors inline if it
    // misses a constraint.
    propsSchema: z.object({ schema: z.unknown() }),
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

/**
 * Capability F4 — approval policies for the eDiscovery demo.
 *
 * Two irreversible mutations are gated:
 *
 *   - `exportProductionSet` (production remote) — delivery to opposing
 *     counsel. Required for any persona except `lead-counsel`.
 *     Approver: lead-counsel only.
 *
 *   - `releaseLegalHold` (host) — drops a hold which may be load-bearing
 *     for an active matter. Required for paralegal / lit-support /
 *     vendor-reviewer. Approvers: lead-counsel + associate.
 *
 * Both surface through the generic `approval-summary-diff` widget; in a
 * real deployment, each tool would have a tool-specific diff (with
 * pre/post visualisations, joined matter-store data, etc.) — the
 * registration shape is identical, only the `diffRenderer` name changes.
 */
export function registerApprovals(env: EnvironmentInjector): void {
  const registry = env.get(ApprovalRegistry);

  registry.register(
    agenticApproval({
      tool: 'exportProductionSet',
      required: (_args, ctx) => ctx.persona !== 'lead-counsel',
      approverRoles: ['lead-counsel'],
      diffRenderer: 'approval-summary-diff',
      signoffMessage: (args) => {
        const pid = (args as { productionId?: string }).productionId ?? '(unknown)';
        return `Approve export + delivery of production ${pid} to opposing counsel? This is irreversible.`;
      },
    }),
  );

  registry.register(
    agenticApproval({
      tool: 'releaseLegalHold',
      required: (_args, ctx) =>
        ctx.persona !== 'lead-counsel' && ctx.persona !== 'associate',
      approverRoles: ['lead-counsel', 'associate'],
      diffRenderer: 'approval-summary-diff',
      signoffMessage: (args) => {
        const hid = (args as { holdId?: string }).holdId ?? '(unknown)';
        const reason = (args as { reason?: string }).reason ?? '';
        return `Approve release of legal hold ${hid}?` + (reason ? ` — "${reason}"` : '');
      },
    }),
  );
}

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

        await runInInjectionContext(env, async () => {
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

          // Navigate to /custodians with the new row focused so the
          // operator sees confirmation immediately AND the form
          // unmounts -- prevents accidental double-submit. The
          // /custodians page reads ?id= on activation and scrolls/
          // highlights the matching row.
          await env.get(Router).navigate(['/custodians'], {
            queryParams: { id: custodian.id, created: '1' },
          });
        });
      },
    }) as FormDef,
  );

  // ── Capability F3 — placeLegalHold workflow ─────────────────────────────
  //
  // Same domain handler as `placeLegalHoldTool` (one-shot agent call), now
  // surfaced as a four-step wizard. Conditional next on step 'custodians':
  // zero selected → jump to 'matter-setup' redirect (AC-F3-2). On terminal
  // 'preview' Submit, onComplete aggregates the per-step state and adds the
  // hold to MatterStore — same audit posture as the tool path.
  env.get(FormRegistry).register(
    agenticWorkflow({
      name: 'placeLegalHold',
      description:
        'Guided wizard to draft, scope, and send a legal hold notice in four steps.',
      steps: [
        { id: 'scope',        widget: 'place-hold-keywords',     section: 'Scope',       next: 'custodians' },
        {
          id: 'custodians',
          widget: 'place-hold-custodians',
          section: 'Custodians',
          next: (state) => {
            const ids = (state['custodians'] as readonly string[] | undefined) ?? [];
            return ids.length === 0 ? 'matter-setup' : 'date-range';
          },
        },
        { id: 'date-range',   widget: 'place-hold-dates',        section: 'Date range',  next: 'preview' },
        { id: 'preview',      widget: 'place-hold-preview',      section: 'Preview',     next: null },
        { id: 'matter-setup', widget: 'place-hold-matter-setup', section: 'Setup',       next: null },
      ],
      onComplete: async (state) => {
        await runInInjectionContext(env, async () => {
          const keywords = (state['scope'] as readonly string[] | undefined) ?? [];
          const custodianIds = (state['custodians'] as readonly string[] | undefined) ?? [];
          const range = (state['date-range'] as { from?: string; to?: string } | undefined) ?? {};

          const scopeParts = [
            keywords.length > 0 ? `Keywords: ${keywords.join(', ')}` : '',
            (range.from || range.to) ? `Date range: ${range.from ?? '—'} → ${range.to ?? '—'}` : '',
          ].filter(Boolean);
          const scope = scopeParts.length > 0
            ? scopeParts.join('. ')
            : 'Hold placed via wizard.';

          const store = env.get(MatterStore);
          const validIds = custodianIds.filter((id) =>
            store.custodians().some((c) => c.id === id),
          );
          if (validIds.length === 0) {
            // The matter-setup branch handles the empty-custodians case
            // before we get here, so this is a defensive guard rather than
            // a normal path.
            // eslint-disable-next-line no-console
            console.warn('[placeLegalHold] workflow completed with no custodians; skipping addLegalHold');
            return;
          }
          const hold = {
            id: nextLegalHoldId(),
            matterId: store.matterId,
            custodianIds: validIds,
            scope,
            issuedAt: isoNow(),
          };
          store.addLegalHold(hold);
          // Same confirmation path as placeLegalHoldTool -- navigate
          // the operator to /holds with ?id= + ?created=1 so the flash
          // banner fires and the new hold is focused.
          await env.get(Router).navigate(['/holds'], {
            queryParams: { id: hold.id, created: '1' },
          });
        });
      },
    }) as FormDef,
  );

  // ── R5 — placeLegalHoldAndCollect (multi-actor + HITL + LRO) ─────────────
  //
  // Five-step workflow that exercises three patterns the simpler
  // `placeLegalHold` doesn't cover:
  //   1. Persona gating — each step checks PersonaService.active()
  //      and shows a "waiting on …" panel when the wrong persona is
  //      seated. Operator switches via the header to advance.
  //   2. HITL pause — step 3 (approval) is gated to senior-counsel.
  //      Lead-counsel drafts; senior-counsel approves; lead-counsel
  //      collects. Three persona switches across the flow.
  //   3. Long-running step — step 4 simulates a 5s collection job
  //      with progress bar + status messages.
  //
  // onComplete runs the same MatterStore.addLegalHold() the simpler
  // workflow does — single source of truth for the audit chain.
  env.get(FormRegistry).register(
    agenticWorkflow({
      name: 'placeLegalHoldAndCollect',
      description:
        'Multi-actor wizard that drafts, gets senior-counsel approval, sends ' +
        'the notice, and collects documents. Five steps across two personas.',
      steps: [
        { id: 'matter-setup',  widget: 'collect-step-matter-setup',  section: 'Setup',     next: 'custodians' },
        {
          id: 'custodians',
          widget: 'collect-step-custodians',
          section: 'Custodians',
          next: (state) => {
            const ids = (state['custodians'] as readonly string[] | undefined) ?? [];
            return ids.length === 0 ? 'matter-setup' : 'approval';
          },
        },
        { id: 'approval',      widget: 'collect-step-approval',      section: 'Approval',   next: 'collect' },
        { id: 'collect',       widget: 'collect-step-collect',       section: 'Collection', next: 'preview' },
        { id: 'preview',       widget: 'collect-step-preview',       section: 'Done',       next: null },
      ],
      onComplete: async (state) => {
        await runInInjectionContext(env, async () => {
          const setup = (state['matter-setup'] as { matterId?: string; scope?: string } | undefined) ?? {};
          const approval = (state['approval'] as { approved?: boolean } | undefined) ?? {};
          const custodianIds = (state['custodians'] as readonly string[] | undefined) ?? [];
          const collectStatus = (state['collect'] as { phase?: string } | undefined)?.phase ?? 'unknown';

          if (approval.approved !== true) {
            // eslint-disable-next-line no-console
            console.warn('[placeLegalHoldAndCollect] completed without approval — skipping audit write');
            return;
          }

          const store = env.get(MatterStore);
          const validIds = custodianIds.filter((id) =>
            store.custodians().some((c) => c.id === id),
          );
          if (validIds.length === 0) {
            // eslint-disable-next-line no-console
            console.warn('[placeLegalHoldAndCollect] no valid custodians — skipping addLegalHold');
            return;
          }

          const hold = {
            id: nextLegalHoldId(),
            matterId: store.matterId,
            custodianIds: validIds,
            scope: setup.scope || 'Hold issued via place-hold-and-collect workflow.',
            issuedAt: isoNow(),
          };
          store.addLegalHold(hold);
          // eslint-disable-next-line no-console
          console.info('[placeLegalHoldAndCollect] complete', {
            matterId: setup.matterId, custodians: validIds.length, collectStatus,
          });
          // Land the operator on /holds with the new hold focused
          // and the flash banner armed -- same pattern as the
          // simpler placeLegalHold + the tool path.
          await env.get(Router).navigate(['/holds'], {
            queryParams: { id: hold.id, created: '1' },
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
      return runInInjectionContext(env, async () => {
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

        // Render-target routing (plan R1) — stash the hold card in
        // the holds page's primary slot and navigate the user there.
        // The chat bubble keeps a small markdown summary + a link;
        // the actual widget mounts on /holds, where the operator can
        // see it in context with all other holds.
        const card = {
          name: 'legalHoldCard',
          props: {
            holdId: hold.id,
            scope: hold.scope,
            custodianCount: hold.custodianIds.length,
            issuedAt: hold.issuedAt,
            acknowledged: false,
            released: false,
          },
        };
        env.get(RenderHandoffStore).publish('holds.primary', [card]);
        await env.get(Router).navigate(['/holds'], { queryParams: { id: hold.id } });

        return {
          ...hold,
          // No `components` — the card mounts on /holds via the slot,
          // not in the chat panel. Avoids dual mount + matches the
          // operator's mental model ("legal holds live on /holds").
          markdown:
            `**Hold issued** — \`${hold.id}\` covering **${validIds.length}** custodian(s). ` +
            `Opened in [/holds](/holds?id=${hold.id}) — view there.\n\n> ${scope}`,
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
      'department. CALL THIS TOOL EXACTLY ONCE PER USER REQUEST. Before ' +
      'calling, extract the department from the user message — phrases ' +
      'like "from the Finance team", "Engineering custodian", "in Legal" ' +
      'all map to a department string. Pass it as `department`. Only omit ' +
      '`department` when the user gave no department hint at all (then the ' +
      'form skips the accounting-systems section).',
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

/**
 * Capability F1 (Approach 2) — fully agent-generated form.
 *
 * Counterpart to {@link openCustodianIntakeTool}. Where Approach 1 lets
 * the LLM only supply *context* (`matterType`, `persona`, `department`)
 * and the host composes a predefined catalog via the F1 closed-AST
 * predicate evaluator, this tool lets the agent emit the *whole form
 * schema* — title, sections, fields, types, options, required-ness —
 * each turn. The widget's strict Zod dialect guards the surface
 * (`dynamicFormSchema`): max 8 sections, max 12 fields/section, string
 * length caps, allow-listed field types only.
 *
 * Trade-offs in flight:
 * - Pro: any one-off intake the agent invents on the fly; no catalog
 *   touching needed for new shapes.
 * - Con: no named-form audit signature, no domain-handler guarantees;
 *   submit dispatches to a generic mapper that opportunistically calls
 *   `MatterStore.addCustodian` when `name` + `email` are present.
 *
 * Use this tool when the user explicitly asks the agent to "generate"
 * or "design" a form, or when the form is genuinely one-off. Prefer
 * `openCustodianIntake` for repeatable workflows that need stable
 * audit trails.
 */
const dynamicFieldSchemaForTool = z.object({
  name: z.string(),
  label: z.string(),
  type: z.enum(['text', 'email', 'textarea', 'select', 'multiselect', 'checkbox', 'number']),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  options: z.array(z.string()).optional(),
});

function generateCustodianIntakeFormTool() {
  return agenticTool({
    name: 'generateCustodianIntakeForm',
    description:
      'Generate a custodian intake form on the fly. Use when the user ' +
      'asks the agent to "design", "generate", "author", or "create" a ' +
      'form rather than open the existing one. Emit the full form ' +
      'schema yourself — title, sections, fields. Best practice: include ' +
      'an Identity section with name + email + department fields so the ' +
      'system can register the resulting custodian. Field types: text, ' +
      'email, textarea, select, multiselect, checkbox, number. ' +
      'CALL THIS TOOL EXACTLY ONCE PER USER REQUEST.',
    schema: z.object({
      title: z.string().describe('Form title shown at the top of the card'),
      description: z.string().optional()
        .describe('One- to two-sentence subtitle explaining the purpose of the form'),
      submitLabel: z.string().optional().describe('Custom submit button label'),
      sections: z.array(z.object({
        title: z.string(),
        description: z.string().optional(),
        fields: z.array(dynamicFieldSchemaForTool).min(1),
      })).min(1).describe('Ordered list of form sections; each must have at least one field'),
    }),
    handler: async (schema) => {
      // The widget validates the schema again with the strict dialect
      // (`dynamicFormSchema` in dynamic-form-card.component.ts) and
      // surfaces parse errors inline if anything slipped past Gemini's
      // schema coercion.
      return {
        components: [{
          name: 'dynamicFormCard',
          props: { schema },
        }],
        markdown:
          `Generated form **${schema.title}** with ${schema.sections.length} ` +
          `section${schema.sections.length === 1 ? '' : 's'}, ` +
          `${schema.sections.reduce((s, sec) => s + sec.fields.length, 0)} fields total.`,
      };
    },
  });
}

/**
 * Capability F3 — surface the placeLegalHold guided workflow.
 *
 * The chat shell mounts `placeLegalHoldCard`, which in turn instantiates
 * `<mvk-workflow-renderer formName="placeLegalHold">`. The wizard walks
 * the user through scope → custodians → date range → preview, with a
 * conditional jump to `matter-setup` when zero custodians are selected
 * (AC-F3-2). On terminal Submit, `WorkflowDef.onComplete` calls
 * `MatterStore.addLegalHold` — same domain handler as the one-shot
 * `placeLegalHoldTool`, two surfaces.
 */
/**
 * Capability F5 demo — simulated TAR (technology-assisted review)
 * classifier. Exemplifies the LRO contract: the handler returns
 * promptly with `{ opId }` plus a `mvk-operation-progress` widget;
 * a background loop drives `reportProgress` over several seconds and
 * eventually `completeOperation` with the per-batch counts.
 *
 * The corpus + scoring are stubs — what matters is the lifecycle.
 * Production deployments swap the body for the real classifier and
 * keep the same lifecycle calls.
 */
function runTARClassifierTool() {
  return agenticTool({
    name: 'runTARClassifier',
    description:
      'Run technology-assisted review (TAR) classification on a portion ' +
      "of the matter's corpus. Returns immediately with an operation id; " +
      'progress streams to the inline `mvk-operation-progress` widget. ' +
      'Use this when the user asks to score, classify, or rank documents ' +
      'against a topic — the classifier is long-running (typically ' +
      '~10-30 seconds in this demo, minutes in production).',
    longRunning: true,
    schema: z.object({
      topic: z.string().min(1).describe(
        "Topic to score against, e.g. 'SEC inquiry' or 'Project Phoenix budget overrun'.",
      ),
      onlyUntagged: z.boolean().optional().default(true).describe(
        'When true (default), only score documents without an existing tag.',
      ),
    }),
    handler: async ({ topic, onlyUntagged }, ctx) => {
      const totalBatches = 8;
      // Mock estimate of ~12s total — covers ETA rendering exercise.
      const estDurationMs = totalBatches * 1500;
      const opId = ctx.startOperation({
        description: `TAR-classify "${topic}"${onlyUntagged ? ' (untagged only)' : ''}`,
        estDurationMs,
      });

      // Background loop. setTimeout chained — survives the handler return.
      let batch = 0;
      const partialCounts = { responsive: 0, privileged: 0, hot: 0 };

      const tick = (): void => {
        if (ctx.signal.aborted) {
          ctx.failOperation(opId, { code: 'ABORTED', message: 'TAR run aborted.' });
          return;
        }
        batch++;
        // Stub scoring — random-ish but deterministic-leaning counts.
        partialCounts.responsive += 60 + Math.floor(Math.random() * 40);
        partialCounts.privileged += 8 + Math.floor(Math.random() * 12);
        partialCounts.hot += 2 + Math.floor(Math.random() * 5);

        const pct = Math.round((batch / totalBatches) * 100);
        ctx.reportProgress(opId, {
          pct,
          phase: `scoring batch ${batch} / ${totalBatches}`,
          partialResult: { ...partialCounts },
        });
        if (batch >= totalBatches) {
          ctx.completeOperation(opId, {
            topic,
            onlyUntagged,
            ...partialCounts,
            totalScored: partialCounts.responsive + partialCounts.privileged + partialCounts.hot,
          });
          return;
        }
        setTimeout(tick, 1500);
      };
      // Kick off the first batch shortly after the handler returns —
      // a 200ms delay lets the chat shell mount the progress widget
      // before the first reportProgress fires.
      setTimeout(tick, 200);

      return {
        opId,
        topic,
        components: [{ name: 'mvk-operation-progress', props: { opId } }],
        markdown:
          `Started TAR classification for **${topic}**. Progress streams ` +
          `inline; the result lands in the operations panel when complete.`,
      };
    },
  });
}

function openPlaceLegalHoldWorkflowTool() {
  return agenticTool({
    name: 'openPlaceLegalHoldWorkflow',
    description:
      'Open the guided wizard for placing a legal hold. Use whenever the ' +
      'user wants to issue a hold and would benefit from a step-by-step ' +
      'flow (scope keywords → custodian selection → date range → preview). ' +
      'Prefer this over `placeLegalHold` (one-shot) when the user is ' +
      'unsure which custodians to cover or wants to review before sending.',
    schema: z.object({}),
    handler: async () => ({
      components: [{ name: 'placeLegalHoldCard', props: {} }],
      markdown: 'Opening the place-legal-hold wizard.',
    }),
  });
}
