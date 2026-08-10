/**
 * Registry contents for the Experience Composer showcase.
 *
 * This is where a platform team + product owners populate the registries:
 *  - ComponentRegistry  ← the UI-kit widgets (widgets.ts)
 *  - FormRegistry       ← forms (agenticForm) + workflows (agenticWorkflow)
 *  - WorkflowRegistry    ← workflow capability defs (so the planner resolves plan.workflow)
 *  - ExperienceRegistry  ← business-intent Experiences (a goal + required capabilities)
 *
 * The end user later states a requirement (a goal); the ExperiencePlanner
 * resolves it against these registries into a concrete, governed generative UI.
 */
import { inject } from '@angular/core';
import { z } from 'zod';
import {
  agenticWidget, agenticForm, agenticWorkflow, agenticExperience,
  FormRegistry, WorkflowRegistry,
  type ComponentDef,
} from '@infra-tools/agentic-ui';
import {
  RolePickerWidget, ProfileFieldsWidget, AccessPickerWidget, CategoryPickerWidget,
  AmountEntryWidget, ReceiptUploadWidget, DescribeWidget, PriorityPickerWidget, ReviewSummaryWidget,
} from './widgets';

// Permissive props schema — these demo widgets render with or without props.
const anyProps = z.object({}).passthrough();
const w = (name: string, component: unknown): ComponentDef =>
  agenticWidget({ name, component: component as never, propsSchema: anyProps });

/** The UI-kit registered into ComponentRegistry. Seeded at boot via provideAgenticUi. */
export const widgets: readonly ComponentDef[] = [
  w('role-picker', RolePickerWidget),
  w('profile-fields', ProfileFieldsWidget),
  w('access-picker', AccessPickerWidget),
  w('category-picker', CategoryPickerWidget),
  w('amount-entry', AmountEntryWidget),
  w('receipt-upload', ReceiptUploadWidget),
  w('describe', DescribeWidget),
  w('priority-picker', PriorityPickerWidget),
  w('review-summary', ReviewSummaryWidget),
];

// ── Forms (FormRegistry) ────────────────────────────────────────────────
const onboardingForm = agenticForm({
  name: 'onboarding-form', description: 'New-hire profile',
  fieldsSchema: z.object({ fullName: z.string(), email: z.string().email(), department: z.string() }),
  submit: async () => {},
});
const expenseForm = agenticForm({
  name: 'expense-form', description: 'Expense details',
  fieldsSchema: z.object({ merchant: z.string(), amount: z.number(), date: z.string() }),
  submit: async () => {},
});
const supportForm = agenticForm({
  name: 'support-form', description: 'Support request',
  fieldsSchema: z.object({ subject: z.string(), details: z.string() }),
  submit: async () => {},
});

// ── Workflows (product-owner-authored step graphs) ──────────────────────
// agenticWorkflow(...) returns a FormDef with a `.workflow` field, registered
// into FormRegistry (what <mvk-workflow-renderer> reads). We ALSO register a
// matching WorkflowCapabilityDef into WorkflowRegistry so the planner's
// plan.workflow resolves and the experience's `requires` is satisfied.
const onboardingFlow = agenticWorkflow({
  name: 'onboarding-flow', description: 'Guided new-hire onboarding',
  steps: [
    { id: 'role', widget: 'role-picker', section: 'Select role', next: 'profile' },
    { id: 'profile', widget: 'profile-fields', section: 'Employee details', next: 'access' },
    { id: 'access', widget: 'access-picker', section: 'Grant access', next: 'review' },
    { id: 'review', widget: 'review-summary', section: 'Review & submit', next: null },
  ],
  onComplete: async () => ({ ok: true }),
});
const expenseFlow = agenticWorkflow({
  name: 'expense-flow', description: 'File an expense claim',
  steps: [
    { id: 'category', widget: 'category-picker', section: 'Expense category', next: 'amount' },
    { id: 'amount', widget: 'amount-entry', section: 'Amount & date', next: 'receipt' },
    { id: 'receipt', widget: 'receipt-upload', section: 'Attach receipt', next: 'review' },
    { id: 'review', widget: 'review-summary', section: 'Review & submit', next: null },
  ],
  onComplete: async () => ({ ok: true }),
});
const supportFlow = agenticWorkflow({
  name: 'support-flow', description: 'Open a support ticket',
  steps: [
    { id: 'type', widget: 'category-picker', section: 'Issue type', next: 'describe' },
    { id: 'describe', widget: 'describe', section: 'Describe the issue', next: 'priority' },
    { id: 'priority', widget: 'priority-picker', section: 'Priority', next: 'review' },
    { id: 'review', widget: 'review-summary', section: 'Review & submit', next: null },
  ],
  onComplete: async () => ({ ok: true }),
});

// ── Experiences (business intent: a goal + the capabilities it needs) ────
const comp = (names: string[]) => names.map((name) => ({ kind: 'component', name }));

const onboardingExp = agenticExperience({
  name: 'employee-onboarding', title: 'Employee Onboarding',
  goal: 'onboard a new employee', approvalState: 'approved',
  intents: ['onboard employee', 'new hire', 'onboard'],
  requires: [
    ...comp(['role-picker', 'profile-fields', 'access-picker', 'review-summary']),
    { kind: 'form', name: 'onboarding-form' },
    { kind: 'workflow', name: 'onboarding-flow' },
  ],
});
const expenseExp = agenticExperience({
  name: 'expense-claim', title: 'Expense Claim',
  goal: 'file an expense claim', approvalState: 'approved',
  intents: ['file expense', 'expense claim', 'reimbursement'],
  requires: [
    ...comp(['category-picker', 'amount-entry', 'receipt-upload', 'review-summary']),
    { kind: 'form', name: 'expense-form' },
    { kind: 'workflow', name: 'expense-flow' },
  ],
});
const supportExp = agenticExperience({
  name: 'support-ticket', title: 'Support Ticket',
  goal: 'open a support ticket', approvalState: 'approved',
  intents: ['support ticket', 'raise issue', 'help'],
  requires: [
    ...comp(['category-picker', 'describe', 'priority-picker', 'review-summary']),
    { kind: 'form', name: 'support-form' },
    { kind: 'workflow', name: 'support-flow' },
  ],
});

/** Forms + workflow-form-defs to register into FormRegistry (workflows are FormDefs). */
export const formDefs = [onboardingForm, expenseForm, supportForm, onboardingFlow, expenseFlow, supportFlow];
/** Workflow capability defs for WorkflowRegistry — so `plan.workflow` resolves. */
export const workflowDefs = [
  { name: 'onboarding-flow', workflow: (onboardingFlow as { workflow: unknown }).workflow },
  { name: 'expense-flow', workflow: (expenseFlow as { workflow: unknown }).workflow },
  { name: 'support-flow', workflow: (supportFlow as { workflow: unknown }).workflow },
];
/** The business-intent Experiences. */
export const experienceDefs = [onboardingExp, expenseExp, supportExp];

/**
 * Register the host KIT — the reusable building blocks the platform/dev team
 * ships: widgets (via provideAgenticUi), forms, and workflows. Experiences are
 * NO LONGER hardcoded here — product owners author them in the Studio and they
 * are loaded at runtime from the catalog by `CatalogExperienceSource`.
 * `experienceDefs` is kept only as a one-time seed reference for the catalog.
 */
export function registerCatalog(): void {
  const forms = inject(FormRegistry);
  const workflows = inject(WorkflowRegistry);
  for (const f of formDefs) forms.register(f as never);
  for (const wf of workflowDefs) workflows.register(wf as never);
}
