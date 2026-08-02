/**
 * Populate the AEP registries with coherent, properly-configured sample content
 * (Prompts / Skills / Knowledge / Memory / Navigation / Tools), and enrich the
 * seeded Forms with descriptions + a visual preview. Idempotent UPSERT: creates
 * what's missing, merges enrichment into what exists. Domain matches the demo
 * experiences (support, onboarding, expense, vendor).
 *
 *   SSO=http://127.0.0.1:9100 API=http://127.0.0.1:8081 TENANT=acme \
 *     node scripts/seed-registries.mjs
 */
import { createHash, randomBytes } from 'node:crypto';

const SSO = process.env.SSO ?? 'http://127.0.0.1:9100';
const API = process.env.API ?? 'http://127.0.0.1:8081';
const TENANT = process.env.TENANT ?? 'acme';

// ── small preview styling for the visual kinds (rendered in the sandboxed iframe)
const CSS = `*{box-sizing:border-box}body{margin:0;font-family:Roboto,system-ui,sans-serif}
.pv{--b:#6750a4;--bs:#eaddff;--in:#21005d;--out:#79747e;--s:#fff;--t:#1d1b20;--s2:#f7f2fa;
background:var(--s2);color:var(--t);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:18px}
@media (prefers-color-scheme:dark){.pv{--s:#1d1b20;--t:#e6e0e9;--s2:#141218;--b:#d0bcff;--bs:#4f378b;--in:#eaddff}}
.card{background:var(--s);border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.2);padding:16px;width:320px}
.bubble{background:var(--bs);color:var(--in);border-radius:14px 14px 14px 4px;padding:12px 14px;font-size:14px;line-height:1.5}
.who{font-size:11px;text-transform:uppercase;letter-spacing:.08em;opacity:.6;margin-bottom:8px}
.tok{background:rgba(103,80,164,.16);border-radius:4px;padding:0 3px}
.field{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}
.lbl{font-size:12px;color:var(--b)}.inp{border:1px solid var(--out);border-radius:6px;padding:10px 12px;font-size:14px;color:var(--t)}
.btn{background:var(--b);color:#fff;border:none;border-radius:20px;height:38px;padding:0 20px;font-size:14px;font-weight:500;cursor:pointer;width:100%}
.nav{width:230px;background:var(--s);border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.2);padding:8px}
.nav .it{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:8px;font-size:14px}
.nav .it.on{background:var(--bs);color:var(--in);font-weight:500}.nav .ic{width:20px;text-align:center}`;
const html = (markup) => `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div class="pv">${markup}</div>`;

const promptPreview = (t) => html(`<div class="card"><div class="who">Prompt template</div><div class="bubble">${t.replace(/\{\{(\w+)\}\}/g, '<span class="tok">{{$1}}</span>')}</div></div>`);
const navPreview = (items) => html(`<div class="nav">${items.map((i, k) => `<div class="it ${k === 0 ? 'on' : ''}"><span class="ic">${i.icon}</span> ${i.title}</div>`).join('')}</div>`);
const formPreview = (title, fields) => html(`<div class="card"><div class="who">${title}</div>${fields.map((f) => `<div class="field"><span class="lbl">${f}</span><div class="inp">&nbsp;</div></div>`).join('')}<button class="btn">Submit</button></div>`);

// ── content per registry ────────────────────────────────────────────────────
const PROMPTS = [
  ['ticket-summary', 'Summarize a support ticket', 'Summarize this support ticket in two sentences, noting the customer sentiment:\n\n{{ticket}}'],
  ['draft-reply', 'Draft a customer reply', 'Write a friendly, concise reply to the customer about their issue: {{issue}}. Offer a next step.'],
  ['classify-priority', 'Classify ticket priority', 'Classify the priority of this request as low, normal, or high. Return only the label.\n\n{{description}}'],
  ['onboarding-welcome', 'New-hire welcome message', 'Write a warm welcome message for new hire {{name}} joining the {{team}} team.'],
];
const SKILLS = [
  ['triage-support', 'Triage an incoming support ticket', ['classify-priority', 'search-catalog'], 'ticket-summary'],
  ['onboard-employee', 'Guide a new-hire onboarding', ['create-ticket', 'lookup-user'], 'onboarding-welcome'],
  ['process-expense', 'Validate and route an expense claim', ['lookup-user', 'send-email'], null],
];
const KNOWLEDGE = [
  ['support-kb', 'vector', 'Support articles, FAQs and runbooks', 'pinecone', 'support-index'],
  ['hr-handbook', 'document', 'HR policies and the employee handbook', 's3', 's3://acme-docs/hr/'],
  ['product-catalog', 'sql', 'Product, pricing and inventory data', 'postgres', 'products'],
];
const MEMORY = [
  ['user-preferences', 'long-term', 'user', 'redis', 'Per-user settings and preferences'],
  ['conversation-history', 'short-term', 'thread', 'in-memory', 'Recent turns in the current session'],
  ['tenant-profile', 'semantic', 'tenant', 'vector-store', 'Organizational context and glossary'],
];
const NAV = [
  ['nav-home', { title: 'Home', route: '/', icon: '⌂', order: 1 }],
  ['nav-experiences', { title: 'Experiences', route: '/experiences', icon: '◧', order: 2 }],
  ['nav-support', { title: 'Support', route: '/support', icon: '☎', order: 3 }],
  ['nav-docs', { title: 'Docs', route: 'https://docs.example.com', icon: '↗', order: 4, external: true }],
];
const NAV_ITEMS = NAV.map(([, b]) => ({ title: b.title, icon: b.icon }));
const TOOLS = [
  ['search-catalog', 'Full-text search across the catalog', ['query']],
  ['create-ticket', 'Open a support ticket', ['subject', 'priority']],
  ['lookup-user', 'Fetch a user profile by id', ['userId']],
  ['send-email', 'Send a templated email', ['to', 'template']],
];
const FORM_ENRICH = {
  'support-form': ['Support request', ['Category', 'Describe the issue', 'Priority']],
  'onboarding-form': ['New-hire profile', ['Full name', 'Team', 'Start date']],
  'expense-form': ['Expense details', ['Amount', 'Category', 'Receipt']],
};

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
const base = `${API}/v1/catalogs/${TENANT}/capabilities`;
const idByName = {};
async function loadKind(kind) {
  const r = await (await fetch(`${base}?kind=${kind}&limit=500`, { headers: H })).json();
  for (const c of r.items ?? []) idByName[`${kind}:${c.name}`] = { id: c.id, body: c.body };
}
let created = 0, updated = 0, failed = 0;
async function upsert(kind, name, body, tags = []) {
  const known = idByName[`${kind}:${name}`];
  if (known) {
    const r = await fetch(`${base}/${known.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ body: { ...known.body, ...body }, tags }) });
    r.ok ? updated++ : (failed++, console.log(`  PATCH ${kind}/${name}: ${r.status}`));
    return;
  }
  const r = await fetch(base, { method: 'POST', headers: H, body: JSON.stringify({ kind, name, body, tags }) });
  r.status === 201 ? created++ : (failed++, console.log(`  POST ${kind}/${name}: ${r.status} ${(await r.text()).slice(0, 80)}`));
}

for (const k of ['prompt', 'skill', 'knowledge', 'memory', 'navigation', 'tool', 'form']) await loadKind(k);

for (const [name, description, template] of PROMPTS)
  await upsert('prompt', name, { description, template, model: 'claude-opus-5', version: '1.0.0', preview: { type: 'html', height: 150, html: promptPreview(template) } }, ['support']);
for (const [name, description, tools, prompt] of SKILLS)
  await upsert('skill', name, { description, tools, ...(prompt ? { prompt } : {}), version: '1.0.0' }, ['agentic']);
for (const [name, kind, description, connector, uri] of KNOWLEDGE)
  await upsert('knowledge', name, { kind, description, connector, uri }, ['rag']);
for (const [name, kind, scope, provider, description] of MEMORY)
  await upsert('memory', name, { kind, scope, provider, description }, ['memory']);
for (const [name, body] of NAV)
  await upsert('navigation', name, { ...body, preview: { type: 'html', height: 200, html: navPreview(NAV_ITEMS) } }, ['nav']);
for (const [name, description, inputs] of TOOLS)
  await upsert('tool', name, { description, inputs, version: '1.0.0' }, ['tool']);
for (const [name, [title, fields]] of Object.entries(FORM_ENRICH))
  await upsert('form', name, { description: title, submit: 'usage-event', preview: { type: 'html', height: 250, html: formPreview(title, fields) } }, ['form']);

console.log(`\nRegistries seeded: ${created} created, ${updated} updated, ${failed} failed (tenant=${TENANT}).`);
process.exit(failed ? 1 : 0);
