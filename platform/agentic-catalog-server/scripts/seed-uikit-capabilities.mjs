/**
 * Seed the composer's UI-kit as catalog capabilities (metadata) so an
 * experience's component/form requirements resolve against the catalog: the
 * Studio requirement dropdowns then offer them, and Composition & health shows
 * them matched. The concrete Angular classes stay host-local in the composer
 * (registry-source pattern) — the catalog only stores the metadata mirror.
 *
 *   SSO=http://127.0.0.1:9100 API=http://127.0.0.1:8081 TENANT=acme \
 *     node scripts/seed-uikit-capabilities.mjs
 */
import { createHash, randomBytes } from 'node:crypto';

const SSO = process.env.SSO ?? 'http://127.0.0.1:9100';
const API = process.env.API ?? 'http://127.0.0.1:8081';
const TENANT = process.env.TENANT ?? 'acme';

const COMPONENTS = [
  'role-picker', 'profile-fields', 'access-picker', 'category-picker',
  'amount-entry', 'receipt-upload', 'describe', 'priority-picker', 'review-summary',
];
const FORMS = ['onboarding-form', 'expense-form', 'support-form'];

const b64 = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function editorToken() {
  const v = b64(randomBytes(32));
  const ch = b64(createHash('sha256').update(v).digest());
  const loc = (await fetch(`${SSO}/login?` + new URLSearchParams({ redirect_uri: 'http://localhost/cb', code_challenge: ch, code_challenge_method: 'S256', state: 's' }), {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sub: 'seed@acme', tenant: TENANT, roles: 'editor' }),
  })).headers.get('location');
  const code = new URL(loc).searchParams.get('code');
  const { access_token } = await (await fetch(`${SSO}/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: v, redirect_uri: 'http://localhost/cb' }),
  })).json();
  return access_token;
}

const token = await editorToken();
const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const url = `${API}/v1/catalogs/${TENANT}/capabilities`;

async function ensure(kind, name, body) {
  const res = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify({ kind, name, body }) });
  if (res.status === 201) return 'created';
  if (res.status === 409) return 'exists';
  return `failed(${res.status}: ${(await res.text()).slice(0, 80)})`;
}

let created = 0, existed = 0, failed = 0;
for (const name of COMPONENTS) {
  const r = await ensure('component', name, { propsSchema: { type: 'object', additionalProperties: true } });
  r === 'created' ? created++ : r === 'exists' ? existed++ : (failed++, console.log(`  component ${name}: ${r}`));
}
for (const name of FORMS) {
  const r = await ensure('form', name, { fields: [] });
  r === 'created' ? created++ : r === 'exists' ? existed++ : (failed++, console.log(`  form ${name}: ${r}`));
}
console.log(`\nUI-kit capabilities: ${created} created, ${existed} already present, ${failed} failed (tenant=${TENANT}).`);
process.exit(failed ? 1 : 0);
