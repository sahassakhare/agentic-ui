/**
 * Seed the Angular Material component catalog as `component`-kind capabilities.
 * Each entry is component-AGNOSTIC from the catalog's view — it just carries a
 * self-describing `body.preview` (type: 'html') with a self-contained Material-3
 * snippet. The Studio's generic PreviewHost renders that in a sandboxed iframe;
 * nothing about Material lives in the Studio. Real Material classes ship in the
 * component MFEs the runtime federates — this is the authoring-time reference.
 *
 *   SSO=http://127.0.0.1:9100 API=http://127.0.0.1:8081 TENANT=acme \
 *     node scripts/seed-material-components.mjs
 */
import { createHash, randomBytes } from 'node:crypto';

const SSO = process.env.SSO ?? 'http://127.0.0.1:9100';
const API = process.env.API ?? 'http://127.0.0.1:8081';
const TENANT = process.env.TENANT ?? 'acme';

// Material-3 styling shared by every preview snippet (rendered inside a sandboxed iframe).
const CSS = `
*{box-sizing:border-box} body{margin:0;font-family:Roboto,'Helvetica Neue',system-ui,sans-serif}
.mp{--p:#6750a4;--on-p:#fff;--pc:#eaddff;--on-pc:#21005d;--out:#79747e;--surf:#fff;--on-surf:#1d1b20;--surf2:#f7f2fa;
--elev:0 1px 3px rgba(0,0,0,.2),0 1px 1px rgba(0,0,0,.14);color:var(--on-surf);background:var(--surf2);
min-height:100vh;display:flex;align-items:center;justify-content:center;padding:18px;gap:10px;flex-wrap:wrap}
.col{flex-direction:column;align-items:flex-start}
.m-btn{font:inherit;font-size:14px;font-weight:500;height:40px;padding:0 24px;border-radius:20px;border:none;cursor:pointer}
.m-btn.text{background:transparent;color:var(--p);padding:0 12px}.m-btn.elevated{background:var(--surf);color:var(--p);box-shadow:var(--elev)}
.m-btn.filled{background:var(--p);color:var(--on-p)}.m-btn.tonal{background:var(--pc);color:var(--on-pc)}
.m-btn.outlined{background:transparent;color:var(--p);border:1px solid var(--out)}.m-btn.light{color:var(--pc)}
.m-iconbtn{width:40px;height:40px;border-radius:50%;border:none;background:transparent;color:var(--on-surf);font-size:18px;cursor:pointer}
.m-fab{min-width:56px;height:56px;border-radius:16px;border:none;background:var(--pc);color:var(--on-pc);font-size:22px;box-shadow:var(--elev);cursor:pointer;padding:0 16px}
.m-fab.ext{display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:500}
.m-toggleset{display:inline-flex;border:1px solid var(--out);border-radius:20px;overflow:hidden}
.m-tog{font:inherit;font-size:13px;padding:8px 18px;border:none;background:transparent;color:var(--on-surf);cursor:pointer;border-left:1px solid var(--out)}
.m-tog:first-child{border-left:none}.m-tog.on{background:var(--pc);color:var(--on-pc)}
.m-field{display:flex;flex-direction:column;gap:4px;min-width:220px;position:relative}.m-lbl{font-size:12px;color:var(--p)}
.m-input{font:inherit;font-size:15px;padding:12px 14px;border:1px solid var(--out);border-radius:6px;background:transparent;color:var(--on-surf)}
.m-input.row{display:flex;align-items:center;justify-content:space-between}
.m-field.fill .m-input{border:none;border-bottom:2px solid var(--p);border-radius:6px 6px 0 0;background:rgba(103,80,164,.06)}
.cal{color:var(--p)}.m-select{display:flex;align-items:center;justify-content:space-between;font-size:15px;padding:12px 14px;border:1px solid var(--out);border-radius:6px}
.caret{opacity:.7}.m-panel{position:absolute;top:100%;left:0;right:0;margin-top:4px;background:var(--surf);border-radius:8px;box-shadow:var(--elev);padding:8px 0;z-index:2}
.m-panel.wide{position:static;margin-top:8px;min-width:180px}.m-opt{padding:10px 14px;font-size:14px;cursor:pointer}.m-opt.sel{background:var(--pc);color:var(--on-pc)}
.m-check,.m-radio,.m-switch{display:inline-flex;align-items:center;gap:10px;font-size:15px}
.box{width:18px;height:18px;border:2px solid var(--out);border-radius:3px;display:grid;place-items:center;font-size:13px;color:var(--on-p)}
.box.on,.box.ind{background:var(--p);border-color:var(--p)}
.dot{width:20px;height:20px;border:2px solid var(--out);border-radius:50%;position:relative}.dot.on{border-color:var(--p)}
.dot.on::after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--p)}
.track{width:52px;height:32px;border-radius:16px;background:#e7e0ec;border:2px solid var(--out);position:relative}
.track .thumb{position:absolute;top:6px;left:6px;width:16px;height:16px;border-radius:50%;background:var(--out)}
.track.on{background:var(--p);border-color:var(--p)}.track.on .thumb{left:26px;width:24px;height:24px;top:2px;background:var(--on-p)}
.m-slider{position:relative;width:240px;height:20px;display:flex;align-items:center}.m-slider .rail{width:100%;height:4px;border-radius:2px;background:#e7e0ec}
.m-slider .fill{display:block;height:100%;background:var(--p);border-radius:2px}.m-slider .knob{position:absolute;width:18px;height:18px;border-radius:50%;background:var(--p);transform:translateX(-50%)}
.m-chip{display:inline-flex;align-items:center;gap:6px;font-size:13px;padding:6px 12px;border-radius:8px;border:1px solid var(--out)}
.m-chip b{cursor:pointer;opacity:.7;font-weight:400}.m-chip.sel{background:var(--pc);color:var(--on-pc);border-color:transparent}
.m-card{width:280px;background:var(--surf);border-radius:12px;box-shadow:var(--elev);overflow:hidden}
.m-card-h{display:flex;align-items:center;gap:12px;padding:16px}.m-avatar{width:40px;height:40px;border-radius:50%;background:var(--pc);color:var(--on-pc);display:grid;place-items:center;font-weight:600}
.m-avatar.sm{width:28px;height:28px;font-size:14px}.m-card-h .t{font-weight:500}.m-card-h .s{font-size:13px;opacity:.7}
.m-card-b{padding:0 16px 16px;font-size:14px;opacity:.85}.m-card-a{display:flex;gap:8px;padding:8px;border-top:1px solid rgba(0,0,0,.08)}
.m-table{border-collapse:collapse;background:var(--surf);border-radius:8px;overflow:hidden;box-shadow:var(--elev);font-size:14px}
.m-table th,.m-table td{text-align:left;padding:12px 20px;border-bottom:1px solid rgba(0,0,0,.08)}.m-table th{font-size:12px;opacity:.7;font-weight:500}.m-table tr:last-child td{border-bottom:none}
.m-tabs{width:300px;background:var(--surf);border-radius:8px;box-shadow:var(--elev);overflow:hidden}.m-tabbar{display:flex;border-bottom:1px solid rgba(0,0,0,.08)}
.m-tabbar .tab{flex:1;text-align:center;padding:14px 0;font-size:14px;font-weight:500;opacity:.6}.m-tabbar .tab.on{opacity:1;color:var(--p);box-shadow:inset 0 -2px 0 var(--p)}.m-tabbody{padding:16px;font-size:14px}
.m-exp{width:300px;background:var(--surf);border-radius:8px;box-shadow:var(--elev);overflow:hidden}.m-exp-h{display:flex;justify-content:space-between;padding:16px;font-weight:500;font-size:14px;border-top:1px solid rgba(0,0,0,.06)}.m-exp-h:first-child{border-top:none}.m-exp-b{padding:0 16px 16px;font-size:14px;opacity:.8}
.m-list{width:260px;background:var(--surf);border-radius:8px;box-shadow:var(--elev);padding:8px 0}.m-li{display:flex;align-items:center;gap:12px;padding:10px 16px;font-size:14px}
.m-menuwrap{display:inline-flex;flex-direction:column;align-items:flex-start}
.m-toolbar{display:flex;align-items:center;gap:8px;width:320px;background:var(--p);color:var(--on-p);padding:8px 12px;border-radius:8px}.m-toolbar .m-iconbtn{color:var(--on-p)}.m-toolbar .tt{font-size:18px;font-weight:500}.m-toolbar .sp{flex:1}
.m-prog{width:240px;height:4px;border-radius:2px;background:#e7e0ec;overflow:hidden}.m-prog span{display:block;height:100%;background:var(--p)}.m-prog.buffer{background:repeating-linear-gradient(90deg,#e7e0ec 0 6px,transparent 6px 10px)}
.m-spinner{width:48px;height:48px;border-radius:50%;border:4px solid #e7e0ec;border-top-color:var(--p);animation:sp 1s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
.badged{position:relative}.badged::after{content:attr(data-badge);position:absolute;top:-4px;right:-4px;background:#b3261e;color:#fff;font-size:11px;min-width:18px;height:18px;border-radius:9px;display:grid;place-items:center;padding:0 4px}
.m-stepper{display:flex;align-items:center;gap:6px;font-size:13px}.m-stepper .step{display:inline-flex;align-items:center;gap:6px;opacity:.6}.m-stepper .step.on,.m-stepper .step.done{opacity:1}
.m-stepper .n{width:24px;height:24px;border-radius:50%;background:var(--out);color:#fff;display:grid;place-items:center;font-size:12px}.m-stepper .step.on .n,.m-stepper .step.done .n{background:var(--p)}.m-stepper .bar{width:32px;height:1px;background:var(--out)}
.m-snack{display:flex;align-items:center;gap:16px;background:#322f35;color:#f5eff7;padding:8px 8px 8px 16px;border-radius:6px;font-size:14px;box-shadow:var(--elev)}
.m-ttwrap{display:flex;flex-direction:column;align-items:center;gap:6px}.m-tt{background:#322f35;color:#fff;font-size:12px;padding:6px 10px;border-radius:4px}
`;

const doc = (markup) => `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div class="mp">${markup}</div>`;

const COMPONENTS = [
  ['mat-button', 'Buttons — text, elevated, filled, tonal, outlined', 'Buttons', 90,
    `<button class="m-btn text">Text</button><button class="m-btn elevated">Elevated</button><button class="m-btn filled">Filled</button><button class="m-btn tonal">Tonal</button><button class="m-btn outlined">Outlined</button>`],
  ['mat-icon-button', 'Icon buttons', 'Buttons', 90, `<button class="m-iconbtn">♥</button><button class="m-iconbtn">↗</button><button class="m-iconbtn">⋮</button>`],
  ['mat-fab', 'Floating action button', 'Buttons', 110, `<button class="m-fab">＋</button><button class="m-fab ext"><span>＋</span> Compose</button>`],
  ['mat-button-toggle', 'Toggle button group', 'Buttons', 90, `<div class="m-toggleset"><button class="m-tog on">Day</button><button class="m-tog">Week</button><button class="m-tog">Month</button></div>`],
  ['mat-form-field', 'Text input field (outline + fill)', 'Form controls', 170, `<div class="col" style="gap:14px"><label class="m-field"><span class="m-lbl">Full name</span><input class="m-input" value="Ada Lovelace"></label><label class="m-field fill"><span class="m-lbl">Email</span><input class="m-input" placeholder="you@example.com"></label></div>`],
  ['mat-select', 'Select dropdown', 'Form controls', 200, `<label class="m-field"><span class="m-lbl">Priority</span><div class="m-select">High <span class="caret">▾</span></div><div class="m-panel"><div class="m-opt sel">High</div><div class="m-opt">Normal</div><div class="m-opt">Low</div></div></label>`],
  ['mat-autocomplete', 'Autocomplete input', 'Form controls', 170, `<label class="m-field"><span class="m-lbl">State</span><input class="m-input" value="Cal"><div class="m-panel"><div class="m-opt sel">California</div><div class="m-opt">Colorado</div></div></label>`],
  ['mat-checkbox', 'Checkbox', 'Form controls', 150, `<div class="col" style="gap:12px"><label class="m-check"><span class="box on">✓</span> Email me updates</label><label class="m-check"><span class="box"></span> Enable beta features</label><label class="m-check"><span class="box ind">–</span> Select all</label></div>`],
  ['mat-radio-group', 'Radio buttons', 'Form controls', 120, `<div class="col" style="gap:12px"><label class="m-radio"><span class="dot on"></span> Standard shipping</label><label class="m-radio"><span class="dot"></span> Express shipping</label></div>`],
  ['mat-slide-toggle', 'Slide toggle', 'Form controls', 120, `<div class="col" style="gap:14px"><label class="m-switch"><span class="track on"><span class="thumb"></span></span> Wi-Fi</label><label class="m-switch"><span class="track"><span class="thumb"></span></span> Bluetooth</label></div>`],
  ['mat-slider', 'Slider', 'Form controls', 80, `<div class="m-slider"><span class="rail"><span class="fill" style="width:60%"></span></span><span class="knob" style="left:60%"></span></div>`],
  ['mat-datepicker', 'Datepicker', 'Form controls', 110, `<label class="m-field"><span class="m-lbl">Choose a date</span><div class="m-input row"><span>8/2/2026</span><span class="cal">▦</span></div></label>`],
  ['mat-chips', 'Chips', 'Form controls', 90, `<span class="m-chip">Angular <b>×</b></span><span class="m-chip">Material <b>×</b></span><span class="m-chip sel">TypeScript <b>×</b></span>`],
  ['mat-card', 'Card', 'Layout', 230, `<div class="m-card"><div class="m-card-h"><span class="m-avatar">A</span><div><div class="t">Aromatic Coffee</div><div class="s">Single origin</div></div></div><div class="m-card-b">Rich, smooth and full-bodied — a preview card body.</div><div class="m-card-a"><button class="m-btn text">LIKE</button><button class="m-btn text">SHARE</button></div></div>`],
  ['mat-table', 'Data table', 'Data', 170, `<table class="m-table"><thead><tr><th>Name</th><th>Kind</th><th>State</th></tr></thead><tbody><tr><td>support-flow</td><td>workflow</td><td>approved</td></tr><tr><td>category-picker</td><td>component</td><td>published</td></tr></tbody></table>`],
  ['mat-tabs', 'Tab group', 'Navigation', 160, `<div class="m-tabs"><div class="m-tabbar"><span class="tab on">Overview</span><span class="tab">Details</span><span class="tab">History</span></div><div class="m-tabbody">Overview content preview.</div></div>`],
  ['mat-expansion-panel', 'Accordion / expansion panel', 'Layout', 180, `<div class="m-exp"><div class="m-exp-h">Personal data <span class="caret">▾</span></div><div class="m-exp-b">Name, email and contact preferences.</div><div class="m-exp-h">Billing address <span class="caret">▸</span></div></div>`],
  ['mat-list', 'List', 'Layout', 180, `<div class="m-list"><div class="m-li"><span class="m-avatar sm">📄</span> Q3 report.pdf</div><div class="m-li"><span class="m-avatar sm">🖼</span> diagram.png</div><div class="m-li"><span class="m-avatar sm">🎞</span> demo.mp4</div></div>`],
  ['mat-menu', 'Menu', 'Navigation', 200, `<div class="m-menuwrap"><button class="m-btn outlined">Menu ▾</button><div class="m-panel wide"><div class="m-opt">Refresh</div><div class="m-opt">Settings</div><div class="m-opt">Sign out</div></div></div>`],
  ['mat-toolbar', 'Toolbar', 'Layout', 90, `<div class="m-toolbar"><span class="m-iconbtn">☰</span><span class="tt">My App</span><span class="sp"></span><span class="m-iconbtn">♥</span><span class="m-iconbtn">⋮</span></div>`],
  ['mat-progress-bar', 'Progress bar', 'Indicators', 90, `<div class="col" style="gap:14px"><div class="m-prog"><span style="width:65%"></span></div><div class="m-prog buffer"><span style="width:40%"></span></div></div>`],
  ['mat-progress-spinner', 'Progress spinner', 'Indicators', 100, `<div class="m-spinner"></div>`],
  ['mat-badge', 'Badge', 'Indicators', 90, `<button class="m-iconbtn badged" data-badge="4">✉</button><button class="m-btn filled badged" data-badge="99+">Inbox</button>`],
  ['mat-stepper', 'Stepper', 'Navigation', 90, `<div class="m-stepper"><span class="step done"><span class="n">✓</span> Cart</span><span class="bar"></span><span class="step on"><span class="n">2</span> Address</span><span class="bar"></span><span class="step"><span class="n">3</span> Payment</span></div>`],
  ['mat-snack-bar', 'Snackbar', 'Popups', 90, `<div class="m-snack">Message sent <button class="m-btn text light">UNDO</button></div>`],
  ['mat-tooltip', 'Tooltip', 'Popups', 110, `<div class="m-ttwrap"><div class="m-tt">Delete this item</div><button class="m-iconbtn">🗑</button></div>`],
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
const url = `${API}/v1/catalogs/${TENANT}/capabilities`;
let created = 0, existed = 0, failed = 0;
for (const [name, description, category, height, markup] of COMPONENTS) {
  const body = { description, library: 'angular-material', selector: name, category, preview: { type: 'html', height, html: doc(markup) } };
  const res = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify({ kind: 'component', name, body, tags: ['angular-material', category] }) });
  if (res.status === 201) created++;
  else if (res.status === 409) existed++;
  else { failed++; console.log(`  ${name}: ${res.status} ${(await res.text()).slice(0, 80)}`); }
}
console.log(`\nAngular Material components: ${created} created, ${existed} already present, ${failed} failed (tenant=${TENANT}).`);
process.exit(failed ? 1 : 0);
