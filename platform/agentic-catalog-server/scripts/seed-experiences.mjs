/**
 * Base demo data: the workflows (journeys) + experiences that the rest of the
 * seeds enrich. Mirrors the composer's canonical defs
 * (examples/demo-experience-composer/src/app/registry/capabilities.ts).
 * support-flow includes the branching decision (priority → escalate/review).
 * Experiences are created then submitted+approved so the runtime serves them.
 * Idempotent-ish (skips names that already exist).
 *
 *   SSO=http://127.0.0.1:9100 API=http://127.0.0.1:8081 TENANT=acme \
 *     node scripts/seed-experiences.mjs
 */
import { createHash, randomBytes } from 'node:crypto';

const SSO = process.env.SSO ?? 'http://127.0.0.1:9100';
const API = process.env.API ?? 'http://127.0.0.1:8081';
const TENANT = process.env.TENANT ?? 'acme';

const WORKFLOWS = [
  ['onboarding-flow', 'Guided new-hire onboarding', [
    { id: 'role', widget: 'role-picker', section: 'Select role', next: 'profile' },
    { id: 'profile', widget: 'profile-fields', section: 'Employee details', next: 'access' },
    { id: 'access', widget: 'access-picker', section: 'Grant access', next: 'review' },
    { id: 'review', widget: 'review-summary', section: 'Review & submit', next: null },
  ]],
  ['expense-flow', 'File an expense claim', [
    { id: 'category', widget: 'category-picker', section: 'Expense category', next: 'amount' },
    { id: 'amount', widget: 'amount-entry', section: 'Amount & date', next: 'receipt' },
    { id: 'receipt', widget: 'receipt-upload', section: 'Attach receipt', next: 'review' },
    { id: 'review', widget: 'review-summary', section: 'Review & submit', next: null },
  ]],
  ['support-flow', 'Open a support ticket', [
    { id: 'type', widget: 'category-picker', section: 'Issue type', next: 'describe' },
    { id: 'describe', widget: 'describe', section: 'Describe the issue', next: 'priority' },
    { id: 'priority', widget: 'priority-picker', section: 'Set priority',
      next: { branches: [{ when: { field: 'priority', op: '==', value: 'high' }, goto: 'escalate' }], default: 'review' } },
    { id: 'escalate', widget: 'access-picker', section: 'Escalate to on-call', next: 'review' },
    { id: 'review', widget: 'review-summary', section: 'Review & submit', next: null },
  ]],
];
const comp = (names) => names.map((name) => ({ kind: 'component', name }));
const EXPERIENCES = [
  ['employee-onboarding', 'Employee Onboarding', 'onboard a new employee', ['onboard employee', 'new hire'],
    [...comp(['role-picker', 'profile-fields', 'access-picker', 'review-summary']), { kind: 'form', name: 'onboarding-form' }, { kind: 'workflow', name: 'onboarding-flow' }]],
  ['expense-claim', 'Expense Claim', 'file an expense claim', ['file expense', 'reimbursement'],
    [...comp(['category-picker', 'amount-entry', 'receipt-upload', 'review-summary']), { kind: 'form', name: 'expense-form' }, { kind: 'workflow', name: 'expense-flow' }]],
  ['support-ticket', 'Support Ticket', 'open a support ticket', ['support ticket', 'raise issue'],
    [...comp(['category-picker', 'describe', 'priority-picker', 'review-summary']), { kind: 'form', name: 'support-form' }, { kind: 'workflow', name: 'support-flow' }]],
  ['vendor-onboarding', 'Vendor Onboarding', 'onboard a new vendor', ['onboard vendor', 'supplier'],
    [...comp(['role-picker', 'profile-fields', 'review-summary']), { kind: 'form', name: 'onboarding-form' }, { kind: 'workflow', name: 'onboarding-flow' }]],
];

const b64 = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function editorToken() {
  const v = b64(randomBytes(32)), ch = b64(createHash('sha256').update(v).digest());
  const loc = (await fetch(`${SSO}/login?` + new URLSearchParams({ redirect_uri: 'http://localhost/cb', code_challenge: ch, code_challenge_method: 'S256', state: 's' }), {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sub: 'seed@acme', tenant: TENANT, roles: 'editor' }),
  })).headers.get('location');
  const code = new URL(loc).searchParams.get('code');
  const { access_token } = await (await fetch(`${SSO}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: v, redirect_uri: 'http://localhost/cb' }) })).json();
  return access_token;
}

const token = await editorToken();
const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const caps = `${API}/v1/catalogs/${TENANT}/capabilities`;
const exps = `${API}/v1/catalogs/${TENANT}/experiences`;

// workflows
const wfList = await (await fetch(`${caps}?kind=workflow&limit=500`, { headers: H })).json();
const wfNames = new Set((wfList.items ?? []).map((c) => c.name));
let wfCreated = 0;
for (const [name, description, steps] of WORKFLOWS) {
  if (wfNames.has(name)) continue;
  const r = await fetch(caps, { method: 'POST', headers: H, body: JSON.stringify({ kind: 'workflow', name, body: { description, steps }, tags: ['journey'] }) });
  r.status === 201 ? wfCreated++ : console.log(`  workflow ${name}: ${r.status} ${(await r.text()).slice(0, 80)}`);
}

// experiences (create → submit → approve)
const exList = await (await fetch(`${exps}?limit=500`, { headers: H })).json();
const exByName = Object.fromEntries((exList.items ?? []).map((e) => [e.name, e]));
let exCreated = 0, exApproved = 0;
for (const [name, title, goal, intents, requires] of EXPERIENCES) {
  let ex = exByName[name];
  if (!ex) {
    const r = await fetch(exps, { method: 'POST', headers: H, body: JSON.stringify({ name, title, goal, body: { intents, requires }, tags: [] }) });
    if (r.status !== 201) { console.log(`  experience ${name}: ${r.status} ${(await r.text()).slice(0, 80)}`); continue; }
    ex = await r.json(); exCreated++;
  }
  if (ex.approvalState !== 'approved') {
    await fetch(`${exps}/${ex.id}/transition`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'submit' }) });
    const ap = await fetch(`${exps}/${ex.id}/transition`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'approve' }) });
    if (ap.ok) exApproved++;
  }
}
console.log(`\nBase seed: ${wfCreated} workflows, ${exCreated} experiences created, ${exApproved} approved (tenant=${TENANT}).`);
