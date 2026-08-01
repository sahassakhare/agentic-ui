/**
 * The component registry's "UI kit" — a set of reusable, standalone Angular
 * components that the ExperiencePlanner assembles into a generative UI. In a
 * real deployment these could be Angular Material components, a corporate
 * design-system library, or federated MFE widgets loaded at runtime; the
 * platform is UI-library-agnostic — it renders whatever is registered, by name.
 *
 * Each is registered into `ComponentRegistry` (see capabilities.ts) and mounted
 * by `<mvk-widget-container>` / `<mvk-workflow-renderer>` via *ngComponentOutlet.
 * All inputs are optional so the workflow renderer can mount them with no props.
 */
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

const CARD = `
  :host { display:block; }
  .w { display:flex; flex-direction:column; gap:14px; }
  .lead { color:var(--muted); font-size:14px; margin:0; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; }
  .chip { border:1px solid var(--line); border-radius:999px; padding:8px 14px; font-size:14px;
    background:var(--surface-2); cursor:pointer; transition:.14s; }
  .chip:hover { border-color:var(--brand); color:var(--brand); }
  .chip.on { background:var(--brand); color:#fff; border-color:transparent; }
  .field { display:flex; flex-direction:column; gap:6px; }
  .field label { font-size:13px; font-weight:600; }
  .field .box { border:1px solid var(--line); border-radius:10px; padding:11px 13px; background:var(--surface);
    color:var(--muted); font-size:14px; }
  .row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .toggle { display:flex; align-items:center; justify-content:space-between; padding:11px 14px;
    border:1px solid var(--line); border-radius:10px; }
  .sw { width:38px; height:22px; border-radius:999px; background:var(--brand); position:relative; }
  .sw::after { content:""; position:absolute; right:3px; top:3px; width:16px; height:16px; border-radius:50%; background:#fff; }
  .sw.off { background:var(--line); } .sw.off::after { left:3px; right:auto; }
  .amt { display:flex; align-items:center; gap:10px; border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
  .amt .cur { color:var(--muted); font-weight:600; } .amt .val { font-size:26px; font-weight:650; letter-spacing:-.02em; }
  .drop { border:1.5px dashed var(--line); border-radius:12px; padding:26px; text-align:center; color:var(--muted); }
  .drop .ic { width:38px;height:38px;border-radius:10px;background:var(--brand-soft);color:var(--brand);
    display:grid;place-items:center;margin:0 auto 8px; }
  .sev { display:flex; gap:8px; }
  .sev button { flex:1; border:1px solid var(--line); border-radius:10px; padding:10px; font:inherit; background:var(--surface); cursor:pointer; }
  .sev button.on { color:#fff; border-color:transparent; }
  .sev .lo.on{background:#0f8a4f} .sev .md.on{background:#a5680a} .sev .hi.on{background:#c23934}
  textarea { border:1px solid var(--line); border-radius:10px; padding:12px 13px; font:inherit; min-height:96px; resize:vertical; background:var(--surface); }
  .sum { display:flex; flex-direction:column; gap:10px; }
  .sum .r { display:flex; justify-content:space-between; padding:9px 0; border-bottom:1px solid var(--line); font-size:14px; }
  .sum .r span:first-child { color:var(--muted); } .sum .r span:last-child { font-weight:600; }
  .ok { display:inline-flex; align-items:center; gap:7px; color:var(--ok); font-weight:600; font-size:14px; }
`;

@Component({ selector: 'w-role-picker', changeDetection: ChangeDetectionStrategy.OnPush, styles: [CARD],
  template: `<div class="w"><p class="lead">Which role is this hire for?</p>
    <div class="chips"><span class="chip on">Engineer</span><span class="chip">Designer</span>
    <span class="chip">Product Manager</span><span class="chip">Sales</span><span class="chip">Support</span></div></div>` })
export class RolePickerWidget { label = input<string>(); }

@Component({ selector: 'w-profile-fields', changeDetection: ChangeDetectionStrategy.OnPush, styles: [CARD],
  template: `<div class="w"><div class="row">
    <div class="field"><label>Full name</label><div class="box">Alex Morgan</div></div>
    <div class="field"><label>Work email</label><div class="box">alex.morgan@acme.com</div></div></div>
    <div class="field"><label>Department</label><div class="box">Platform Engineering</div></div></div>` })
export class ProfileFieldsWidget { label = input<string>(); }

@Component({ selector: 'w-access-picker', changeDetection: ChangeDetectionStrategy.OnPush, styles: [CARD],
  template: `<div class="w"><p class="lead">Grant starter access</p>
    <div class="toggle"><span>Email &amp; calendar</span><span class="sw"></span></div>
    <div class="toggle"><span>Source control</span><span class="sw"></span></div>
    <div class="toggle"><span>Production systems</span><span class="sw off"></span></div></div>` })
export class AccessPickerWidget { label = input<string>(); }

@Component({ selector: 'w-category-picker', changeDetection: ChangeDetectionStrategy.OnPush, styles: [CARD],
  template: `<div class="w"><p class="lead">Choose a category</p>
    <div class="chips"><span class="chip on">Travel</span><span class="chip">Meals</span>
    <span class="chip">Software</span><span class="chip">Hardware</span><span class="chip">Other</span></div></div>` })
export class CategoryPickerWidget { label = input<string>(); }

@Component({ selector: 'w-amount-entry', changeDetection: ChangeDetectionStrategy.OnPush, styles: [CARD],
  template: `<div class="w"><p class="lead">Enter the amount</p>
    <div class="amt"><span class="cur">USD</span><span class="val">1,240.00</span></div>
    <div class="field"><label>Date</label><div class="box">2026-07-28</div></div></div>` })
export class AmountEntryWidget { label = input<string>(); }

@Component({ selector: 'w-receipt-upload', changeDetection: ChangeDetectionStrategy.OnPush, styles: [CARD],
  template: `<div class="w"><div class="drop"><div class="ic">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div><strong>receipt-oct.pdf</strong><div>attached · 84 KB</div></div></div>` })
export class ReceiptUploadWidget { label = input<string>(); }

@Component({ selector: 'w-describe', changeDetection: ChangeDetectionStrategy.OnPush, styles: [CARD],
  template: `<div class="w"><p class="lead">Describe the issue</p>
    <textarea readonly>Checkout fails with a 500 when applying a promo code at the payment step.</textarea></div>` })
export class DescribeWidget { label = input<string>(); }

@Component({ selector: 'w-priority-picker', changeDetection: ChangeDetectionStrategy.OnPush, styles: [CARD],
  template: `<div class="w"><p class="lead">Set the priority</p>
    <div class="sev"><button class="lo">Low</button><button class="md on">Medium</button><button class="hi">High</button></div></div>` })
export class PriorityPickerWidget { label = input<string>(); }

@Component({ selector: 'w-review-summary', changeDetection: ChangeDetectionStrategy.OnPush, styles: [CARD],
  template: `<div class="w"><p class="lead">Review before you submit</p>
    <div class="sum">
      <div class="r"><span>Assembled by</span><span>Experience plan</span></div>
      <div class="r"><span>Steps completed</span><span>All required</span></div>
      <div class="r"><span>Governance</span><span>Approved · audited</span></div>
    </div>
    <span class="ok"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="m5 13 4 4L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>Ready to submit</span></div>` })
export class ReviewSummaryWidget { label = input<string>(); }
