/**
 * Seed `validation` capabilities and attach them to form fields — the governed
 * validation path. A field references a validator by name (`validators`), and/or
 * carries inline constraints (`validation: {minLength,…}`). The renderer enforces
 * inline rules live; governed validators are resolved by the platform at runtime.
 * Idempotent upsert.
 *
 *   SSO=http://127.0.0.1:9100 API=http://127.0.0.1:8081 TENANT=acme \
 *     node scripts/seed-validations.mjs
 */
import { createHash, randomBytes } from 'node:crypto';

const SSO = process.env.SSO ?? 'http://127.0.0.1:9100';
const API = process.env.API ?? 'http://127.0.0.1:8081';
const TENANT = process.env.TENANT ?? 'acme';

const VALIDATIONS = [
  ['non-empty', 'Value must not be blank', 'value != null && String(value).trim().length > 0', 'This field is required.', false],
  ['email-format', 'Must be a valid email address', "/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(value)", 'Enter a valid email.', false],
  ['amount-range', 'Amount within the allowed range', 'value >= 0 && value <= 10000', 'Amount must be between 0 and 10,000.', false],
  ['unique-name', 'Name must be unique (checks the directory)', 'directory.isUnique(value)', 'That name is already taken.', true],
  ['conflict-check', 'Runs a conflict check against open matters', 'matters.noConflict(value)', 'A conflict was found — review required.', true],
];
// field → { validators:[...], validation:{inline} }
const BIND = {
  'support-form': { description: { validators: ['non-empty'], validation: { minLength: 10, maxLength: 500 } } },
  'onboarding-form': { fullName: { validators: ['non-empty', 'conflict-check'] }, startDate: { validation: { pattern: '\\d{4}-\\d{2}-\\d{2}' } } },
  'expense-form': { amount: { validators: ['amount-range'], validation: { min: 0, max: 10000 } } },
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

let created = 0, updated = 0, failed = 0, bound = 0;
const vList = await (await fetch(`${base}?kind=validation&limit=500`, { headers: H })).json();
const vByName = Object.fromEntries((vList.items ?? []).map((c) => [c.name, c]));
for (const [name, description, rule, message, async] of VALIDATIONS) {
  const body = { description, rule, message, async };
  const ex = vByName[name];
  const r = ex
    ? await fetch(`${base}/${ex.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ body: { ...ex.body, ...body }, tags: ['validation'] }) })
    : await fetch(base, { method: 'POST', headers: H, body: JSON.stringify({ kind: 'validation', name, body, tags: ['validation'] }) });
  r.status === 201 ? created++ : r.ok ? updated++ : (failed++, console.log(`  validation ${name}: ${r.status} ${(await r.text()).slice(0, 80)}`));
}

const formList = await (await fetch(`${base}?kind=form&limit=500`, { headers: H })).json();
const formByName = Object.fromEntries((formList.items ?? []).map((c) => [c.name, c]));
for (const [name, binds] of Object.entries(BIND)) {
  const cap = formByName[name];
  if (!cap) { console.log(`  ${name}: not found`); continue; }
  const schema = { ...(cap.body.schema ?? {}) };
  schema.fields = (schema.fields ?? []).map((f) => (binds[f.name] ? { ...f, ...binds[f.name] } : f));
  const r = await fetch(`${base}/${cap.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ body: { ...cap.body, schema } }) });
  r.ok ? bound++ : (failed++, console.log(`  bind ${name}: ${r.status}`));
}

console.log(`\nvalidations: ${created} created, ${updated} updated · forms bound: ${bound} · failed: ${failed} (tenant=${TENANT}).`);
process.exit(failed ? 1 : 0);
