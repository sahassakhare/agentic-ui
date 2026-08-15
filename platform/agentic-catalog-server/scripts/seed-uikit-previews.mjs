/**
 * Add form-control previews to the composer's UI-kit component capabilities so
 * an Experience's journey storyboard renders each step's widget. Idempotent
 * upsert (merges `preview` into the existing body). Same agnostic contract as
 * everything else: the entry carries body.preview; the Studio's PreviewHost
 * renders it in a sandboxed iframe.
 *
 *   SSO=http://127.0.0.1:9100 API=http://127.0.0.1:8081 TENANT=acme \
 *     node scripts/seed-uikit-previews.mjs
 */
import { createHash, randomBytes } from 'node:crypto';

const SSO = process.env.SSO ?? 'http://127.0.0.1:9100';
const API = process.env.API ?? 'http://127.0.0.1:8081';
const TENANT = process.env.TENANT ?? 'acme';

const CSS = `*{box-sizing:border-box}body{margin:0;font-family:Roboto,system-ui,sans-serif}
.pv{--b:#6750a4;--bs:#eaddff;--in:#21005d;--out:#79747e;--s:#fff;--t:#1d1b20;--s2:#f7f2fa;
background:var(--s2);color:var(--t);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
@media (prefers-color-scheme:dark){.pv{--s:#1d1b20;--t:#e6e0e9;--s2:#141218;--b:#d0bcff;--bs:#4f378b;--in:#eaddff}}
.f{display:flex;flex-direction:column;gap:5px;width:260px}.lbl{font-size:12px;color:var(--b)}
.inp{border:1px solid var(--out);border-radius:6px;padding:11px 12px;font-size:14px;color:var(--t);background:transparent;display:flex;justify-content:space-between;align-items:center}
.ta{border:1px solid var(--out);border-radius:6px;padding:11px 12px;font-size:14px;color:var(--t);min-height:64px}
.seg{display:flex;border:1px solid var(--out);border-radius:20px;overflow:hidden}
.seg span{flex:1;text-align:center;padding:8px 0;font-size:13px;border-left:1px solid var(--out)}
.seg span:first-child{border-left:none}.seg .on{background:var(--bs);color:var(--in)}
.chk{display:flex;align-items:center;gap:9px;font-size:14px;margin:5px 0}
.box{width:17px;height:17px;border:2px solid var(--out);border-radius:3px;display:grid;place-items:center;font-size:12px;color:#fff}
.box.on{background:var(--b);border-color:var(--b)}
.drop{border:2px dashed var(--out);border-radius:8px;padding:20px;text-align:center;font-size:13px;color:var(--t);opacity:.85}
.sum{background:var(--s);border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.2);padding:14px;width:280px;font-size:14px}
.sum .r{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(0,0,0,.08)}.sum .r:last-child{border:none}
.sum .k{opacity:.6}.caret{opacity:.6}`;
const html = (m) => `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div class="pv">${m}</div>`;

const PREVIEWS = {
  'category-picker': [120, `<label class="f"><span class="lbl">Category</span><div class="inp">Billing <span class="caret">▾</span></div></label>`],
  'describe': [140, `<label class="f"><span class="lbl">Describe the issue</span><div class="ta">My invoice shows a duplicate charge…</div></label>`],
  'priority-picker': [110, `<label class="f"><span class="lbl">Priority</span><div class="seg"><span>Low</span><span class="on">Normal</span><span>High</span></div></label>`],
  'access-picker': [150, `<div class="f"><span class="lbl">Access level</span><label class="chk"><span class="box on">✓</span> Read</label><label class="chk"><span class="box on">✓</span> Write</label><label class="chk"><span class="box"></span> Admin</label></div>`],
  'review-summary': [170, `<div class="sum"><div class="r"><span class="k">Category</span><span>Billing</span></div><div class="r"><span class="k">Priority</span><span>Normal</span></div><div class="r"><span class="k">Access</span><span>Read, Write</span></div></div>`],
  'role-picker': [120, `<label class="f"><span class="lbl">Role</span><div class="inp">Editor <span class="caret">▾</span></div></label>`],
  'profile-fields': [180, `<div class="f"><span class="lbl">Full name</span><div class="inp">Ada Lovelace</div><span class="lbl" style="margin-top:8px">Email</span><div class="inp">ada@acme.com</div></div>`],
  'amount-entry': [120, `<label class="f"><span class="lbl">Amount</span><div class="inp"><span>$&nbsp;248.00</span><span>USD</span></div></label>`],
  'receipt-upload': [130, `<label class="f"><span class="lbl">Receipt</span><div class="drop">⬆ Drop a file or click to upload<br><small>PNG, JPG or PDF</small></div></label>`],
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
const list = await (await fetch(`${base}?kind=component&limit=500`, { headers: H })).json();
const byName = Object.fromEntries((list.items ?? []).map((c) => [c.name, c]));

let updated = 0, missing = 0, failed = 0;
for (const [name, [height, markup]] of Object.entries(PREVIEWS)) {
  const cap = byName[name];
  if (!cap) { missing++; console.log(`  ${name}: not in catalog (skipped)`); continue; }
  const body = { ...cap.body, preview: { type: 'html', height, html: html(markup) } };
  const r = await fetch(`${base}/${cap.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ body }) });
  r.ok ? updated++ : (failed++, console.log(`  ${name}: PATCH ${r.status}`));
}
console.log(`\nUI-kit previews: ${updated} updated, ${missing} missing, ${failed} failed (tenant=${TENANT}).`);
process.exit(failed ? 1 : 0);
