/**
 * Seed a few `datasource` capabilities and bind form fields to them by reference
 * — the aligned agentic-UI data path: a form field/submit NAMES a governed
 * dataSource/tool capability; the platform resolves it (never a raw URL in the
 * form). Idempotent upsert.
 *
 *   SSO=http://127.0.0.1:9100 API=http://127.0.0.1:8081 TENANT=acme \
 *     node scripts/seed-datasources.mjs
 */
import { createHash, randomBytes } from 'node:crypto';

const SSO = process.env.SSO ?? 'http://127.0.0.1:9100';
const API = process.env.API ?? 'http://127.0.0.1:8081';
const TENANT = process.env.TENANT ?? 'acme';

const DATASOURCES = [
  ['ticket-categories', 'sql', 'Support ticket category taxonomy', 'postgres', 'ticket_categories'],
  ['user-directory', 'api', 'Employee & role directory', 'scim', '/v1/users'],
  ['expense-policy', 'document', 'Expense categories and limits', 's3', 's3://acme-docs/finance/expense-policy'],
];
// Field → source binding + form submit tool, layered onto the existing schemas.
const BIND = {
  'support-form': { submit: 'create-ticket', sources: { category: 'ticket-categories' } },
  'onboarding-form': { submit: 'lookup-user', sources: { role: 'user-directory', team: 'user-directory' } },
  'expense-form': { submit: 'send-email', sources: { category: 'expense-policy' } },
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
const base = `${API}/v1/catalogs/${TENANT}/capabilities`;

// 1) datasources (upsert)
const dsList = await (await fetch(`${base}?kind=datasource&limit=500`, { headers: H })).json();
const dsByName = Object.fromEntries((dsList.items ?? []).map((c) => [c.name, c]));
let created = 0, updated = 0, failed = 0;
for (const [name, kind, description, connector, uri] of DATASOURCES) {
  const body = { kind, description, connector, uri };
  const ex = dsByName[name];
  const r = ex
    ? await fetch(`${base}/${ex.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ body: { ...ex.body, ...body }, tags: ['data'] }) })
    : await fetch(base, { method: 'POST', headers: H, body: JSON.stringify({ kind: 'datasource', name, body, tags: ['data'] }) });
  r.status === 201 ? created++ : r.ok ? updated++ : (failed++, console.log(`  datasource ${name}: ${r.status} ${(await r.text()).slice(0, 80)}`));
}

// 2) bind form fields → sources + submit tool
const formList = await (await fetch(`${base}?kind=form&limit=500`, { headers: H })).json();
const formByName = Object.fromEntries((formList.items ?? []).map((c) => [c.name, c]));
let bound = 0;
for (const [name, { submit, sources }] of Object.entries(BIND)) {
  const cap = formByName[name];
  if (!cap) { console.log(`  ${name}: not found`); continue; }
  const schema = { ...(cap.body.schema ?? {}) };
  schema.submit = submit;
  schema.fields = (schema.fields ?? []).map((f) => (sources[f.name] ? { ...f, source: sources[f.name] } : f));
  const r = await fetch(`${base}/${cap.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ body: { ...cap.body, schema } }) });
  r.ok ? bound++ : (failed++, console.log(`  bind ${name}: ${r.status}`));
}

console.log(`\ndatasources: ${created} created, ${updated} updated · forms bound: ${bound} · failed: ${failed} (tenant=${TENANT}).`);
process.exit(failed ? 1 : 0);
