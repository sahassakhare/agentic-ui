/**
 * End-to-end proof of headless publishing against a LIVE stack: PKCE-login as an
 * editor, publish an approved experience, then exercise the embed deny-matrix
 * with the origin-pinned key. Complements the in-CI specs
 * (routes/experiences.publish.spec.ts + repository/publication-rls.integration.spec.ts).
 *
 *   SSO=http://127.0.0.1:9100 API=http://127.0.0.1:8081 TENANT=acme EXP=support-ticket \
 *     node scripts/verify-embed-e2e.mjs
 */
import { createHash, randomBytes } from 'node:crypto';

const SSO = process.env.SSO ?? 'http://127.0.0.1:9100';
const API = process.env.API ?? 'http://127.0.0.1:8081';
const TENANT = process.env.TENANT ?? 'acme';
const EXP = process.env.EXP ?? 'support-ticket';
const ORIGIN = 'https://portal.acme.com';
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let pass = 0, fail = 0;
const check = (desc, got, want) => {
  const ok = got === want;
  console.log(`  ${ok ? '✓' : '✗'} ${desc} → ${got}${ok ? '' : ` (expected ${want})`}`);
  ok ? pass++ : fail++;
};
const manifestUrl = (tenant, name) => `${API}/v1/embed/${tenant}/experiences/${name}/manifest`;
const status = async (url, headers = {}) => (await fetch(url, { headers })).status;

// 1) PKCE login → editor token
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash('sha256').update(verifier).digest());
const loginParams = new URLSearchParams({ redirect_uri: 'http://localhost/cb', code_challenge: challenge, code_challenge_method: 'S256', state: 's' });
const loc = (await fetch(`${SSO}/login?${loginParams}`, {
  method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ sub: 'alex@acme.com', tenant: TENANT, roles: 'editor' }),
})).headers.get('location');
const code = new URL(loc).searchParams.get('code');
const { access_token: token } = await (await fetch(`${SSO}/token`, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: 'http://localhost/cb' }),
})).json();
const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
console.log(`\n1) editor login (PKCE) → token acquired for tenant=${TENANT}`);

// 2) Find the approved experience
const list = await (await fetch(`${API}/v1/catalogs/${TENANT}/experiences?approvalState=approved`, { headers: H })).json();
const exp = (list.items ?? []).find((e) => e.name === EXP);
if (!exp) { console.log(`✗ approved experience "${EXP}" not found — seed/approve it first`); process.exit(1); }
console.log(`2) found approved experience "${EXP}" (${exp.id})`);

// 3) Publish
console.log('\n── PUBLISH ──');
const pub = await fetch(`${API}/v1/catalogs/${TENANT}/experiences/${exp.id}/publish`, {
  method: 'POST', headers: H, body: JSON.stringify({ allowedOrigins: [ORIGIN] }),
});
check('publish approved experience', pub.status, 201);
const { embedKey, publication } = await pub.json();
console.log(`   embedKey=${embedKey.slice(0, 12)}…  version=${publication.publishedVersionNo}  origins=${JSON.stringify(publication.allowedOrigins)}`);

// 4) Deny matrix
console.log('\n── EMBED READ (deny-matrix) ──');
const read = await fetch(manifestUrl(TENANT, EXP), { headers: { 'x-embed-key': embedKey, origin: ORIGIN } });
check('allowed origin + valid key', read.status, 200);
const manifest = await read.json();
console.log(`   manifest: ${manifest.workflow?.steps?.length ?? 0} steps, widgets=${JSON.stringify(manifest.widgets.map((w) => w.name))}`);

check('server-side (no Origin) + valid key', await status(manifestUrl(TENANT, EXP), { 'x-embed-key': embedKey }), 200);
check('no key', await status(manifestUrl(TENANT, EXP)), 401);
check('bogus key', await status(manifestUrl(TENANT, EXP), { 'x-embed-key': 'emb_bogus' }), 404);
check('valid key, wrong tenant path', await status(manifestUrl('globex', EXP), { 'x-embed-key': embedKey }), 404);
check('valid key, disallowed origin', await status(manifestUrl(TENANT, EXP), { 'x-embed-key': embedKey, origin: 'https://evil.example' }), 403);

// 5) Revoke → key stops working
console.log('\n── REVOKE / ROTATE ──');
await fetch(`${API}/v1/catalogs/${TENANT}/experiences/${exp.id}/unpublish`, { method: 'POST', headers: H });
check('after unpublish, old key', await status(manifestUrl(TENANT, EXP), { 'x-embed-key': embedKey }), 404);

// 6) Re-publish + rotate → old key dead, new key live
const { embedKey: key2 } = await (await fetch(`${API}/v1/catalogs/${TENANT}/experiences/${exp.id}/publish`, {
  method: 'POST', headers: H, body: JSON.stringify({ allowedOrigins: [ORIGIN] }),
})).json();
const { embedKey: key3 } = await (await fetch(`${API}/v1/catalogs/${TENANT}/experiences/${exp.id}/publish/rotate-key`, {
  method: 'POST', headers: H,
})).json();
check('after rotate, superseded key', await status(manifestUrl(TENANT, EXP), { 'x-embed-key': key2, origin: ORIGIN }), 404);
check('after rotate, new key', await status(manifestUrl(TENANT, EXP), { 'x-embed-key': key3, origin: ORIGIN }), 200);

console.log(`\n${fail === 0 ? '✅' : '❌'} embed e2e: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
