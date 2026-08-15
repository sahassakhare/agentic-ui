/**
 * Compose the seeded forms declaratively: add a JSON `schema` (fields + submit)
 * to each form capability. Fields may `widget`-reference a Component entry, so
 * the form composes with the Component registry. The same JSON drives the Studio
 * renderer AND doubles as an agent's tool-input schema. Idempotent upsert
 * (merges schema into the existing body, preserving description/preview).
 *
 *   SSO=http://127.0.0.1:9100 API=http://127.0.0.1:8081 TENANT=acme \
 *     node scripts/seed-form-schemas.mjs
 */
import { createHash, randomBytes } from 'node:crypto';

const SSO = process.env.SSO ?? 'http://127.0.0.1:9100';
const API = process.env.API ?? 'http://127.0.0.1:8081';
const TENANT = process.env.TENANT ?? 'acme';

const SCHEMAS = {
  'support-form': {
    fields: [
      { name: 'category', type: 'select', label: 'Category', required: true, options: ['Billing', 'Technical', 'Account'], widget: 'category-picker' },
      { name: 'description', type: 'textarea', label: 'Describe the issue', required: true, widget: 'describe' },
      { name: 'priority', type: 'select', label: 'Priority', options: ['low', 'normal', 'high'], widget: 'priority-picker' },
    ],
    submit: 'usage-event',
  },
  'onboarding-form': {
    fields: [
      { name: 'fullName', type: 'text', label: 'Full name', required: true, widget: 'profile-fields' },
      { name: 'team', type: 'select', label: 'Team', options: ['Engineering', 'Sales', 'Support'], required: true },
      { name: 'startDate', type: 'date', label: 'Start date', required: true },
      { name: 'role', type: 'select', label: 'Role', options: ['Admin', 'Editor', 'Viewer'], widget: 'role-picker' },
    ],
    submit: 'usage-event',
  },
  'expense-form': {
    fields: [
      { name: 'amount', type: 'number', label: 'Amount (USD)', required: true, widget: 'amount-entry' },
      { name: 'category', type: 'select', label: 'Category', options: ['Travel', 'Meals', 'Software'], required: true },
      { name: 'receipt', type: 'text', label: 'Receipt', placeholder: 'attach a receipt', widget: 'receipt-upload' },
    ],
    submit: 'usage-event',
  },
};

const b64 = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const v = b64(randomBytes(32)), ch = b64(createHash('sha256').update(v).digest());
const loc = (await fetch(`${SSO}/login?` + new URLSearchParams({ redirect_uri: 'http://localhost/cb', code_challenge: ch, code_challenge_method: 'S256', state: 's' }), {
  method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ sub: 'seed@acme', tenant: TENANT, roles: 'editor' }),
})).headers.get('location');
const code = new URL(loc).searchParams.get('code');
const { access_token } = await (await fetch(`${SSO}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: v, redirect_uri: 'http://localhost/cb' }) })).json();
const H = { authorization: `Bearer ${access_token}`, 'content-type': 'application/json' };
const baseUrl = `${API}/v1/catalogs/${TENANT}/capabilities`;
const list = await (await fetch(`${baseUrl}?kind=form&limit=500`, { headers: H })).json();
const byName = Object.fromEntries((list.items ?? []).map((c) => [c.name, c]));

let updated = 0, missing = 0, failed = 0;
for (const [name, schema] of Object.entries(SCHEMAS)) {
  const cap = byName[name];
  if (!cap) { missing++; console.log(`  ${name}: not in catalog (skipped)`); continue; }
  // Drop the static preview so the live schema-driven form renders instead.
  const body = { ...cap.body, schema };
  delete body.preview;
  const r = await fetch(`${baseUrl}/${cap.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ body }) });
  r.ok ? updated++ : (failed++, console.log(`  ${name}: PATCH ${r.status}`));
}
console.log(`\nForm schemas: ${updated} updated, ${missing} missing, ${failed} failed (tenant=${TENANT}).`);
process.exit(failed ? 1 : 0);
