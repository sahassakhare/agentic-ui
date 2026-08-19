import { ChangeDetectionStrategy, Component, Type, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IntakeStore } from './intake.store';
import { EXISTING_CLIENTS, FEE_TYPES, MATTER_TYPES } from './manifest';

/* This portal's OWN step components, keyed by the manifest's widget name.
   None of the platform's renderers are used. */

interface ClientData { name?: string; email?: string; org?: string; }
interface MatterData { type?: string; title?: string; opposing?: string; description?: string; }
interface FeesData { type?: string; rate?: string; retainer?: string; }
interface Verdict { hit: boolean; message: string; opposing?: string; }

@Component({
  selector: 'lip-client-form', standalone: true, imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field"><label>Client name <span class="req">*</span></label>
      <input [ngModel]="name()" (ngModelChange)="name.set($event); sync()" placeholder="e.g. Jordan Ellery" autocomplete="off"></div>
    <div class="row2">
      <div class="field"><label>Contact email <span class="req">*</span></label>
        <input type="email" [ngModel]="email()" (ngModelChange)="email.set($event); sync()" placeholder="jordan@…"></div>
      <div class="field"><label>Organization</label>
        <input [ngModel]="org()" (ngModelChange)="org.set($event); sync()" placeholder="Company / individual"></div>
    </div>`,
})
export class ClientStepComponent {
  private readonly store = inject(IntakeStore);
  private readonly v = (this.store.data()['client'] as Record<string, string>) ?? {};
  readonly name = signal(this.v['name'] ?? '');
  readonly email = signal(this.v['email'] ?? '');
  readonly org = signal(this.v['org'] ?? '');
  constructor() { this.sync(); }
  sync(): void {
    this.store.patch({ client: { name: this.name(), email: this.email(), org: this.org() } });
    this.store.setValid(!!this.name().trim() && /.+@.+\..+/.test(this.email()));
  }
}

@Component({
  selector: 'lip-matter-form', standalone: true, imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field"><label>Matter type <span class="req">*</span></label>
      <div class="seg">@for (t of types; track t) {
        <button type="button" [class.on]="type() === t" (click)="type.set(t); sync()">{{ t }}</button>}</div></div>
    <div class="field"><label>Matter title <span class="req">*</span></label>
      <input [ngModel]="title()" (ngModelChange)="title.set($event); sync()" placeholder="Short descriptive title"></div>
    <div class="field"><label>Opposing / counter party</label>
      <input [ngModel]="opposing()" (ngModelChange)="opposing.set($event); sync()" placeholder="Adverse party, if any" autocomplete="off">
      <div class="hint">Checked against the firm's existing clients in the next step.</div></div>
    <div class="field"><label>Summary</label>
      <textarea [ngModel]="desc()" (ngModelChange)="desc.set($event); sync()" placeholder="What does the client need?"></textarea></div>`,
})
export class MatterStepComponent {
  private readonly store = inject(IntakeStore);
  private readonly v = (this.store.data()['matter'] as Record<string, string>) ?? {};
  readonly types = MATTER_TYPES;
  readonly type = signal(this.v['type'] ?? '');
  readonly title = signal(this.v['title'] ?? '');
  readonly opposing = signal(this.v['opposing'] ?? '');
  readonly desc = signal(this.v['description'] ?? '');
  constructor() { this.sync(); }
  sync(): void {
    this.store.patch({ matter: { type: this.type(), title: this.title(), opposing: this.opposing(), description: this.desc() } });
    this.store.setValid(!!this.type() && !!this.title().trim());
  }
}

@Component({
  selector: 'lip-conflict-check', standalone: true, imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scan">
      <div class="who">Screening <b>{{ matter().title || 'this matter' }}</b>
        @if (matter().opposing) { against <b>{{ matter().opposing }}</b> }
        across the firm's book of business.</div>
      <button class="btn" [disabled]="checking()" (click)="run()">{{ verdict() ? 'Re-run' : 'Run conflict check' }}</button>
    </div>
    @if (checking()) {
      <div class="verdict"><div class="v-hd"><span class="spinner"></span> Screening…</div></div>
    } @else if (verdict(); as vd) {
      <div class="verdict" [class.hit]="vd.hit" [class.clear]="!vd.hit">
        <div class="v-hd">{{ vd.hit ? '⚠ Potential conflict' : '✓ No conflict found' }}</div>
        <p>{{ vd.message }}</p>
      </div>
    }`,
})
export class ConflictStepComponent {
  private readonly store = inject(IntakeStore);
  readonly matter = signal<MatterData>((this.store.data()['matter'] as MatterData) ?? {});
  readonly checking = signal(false);
  readonly verdict = signal<Verdict | null>((this.store.data()['conflicts'] as Verdict | undefined) ?? null);
  constructor() { this.store.setValid(this.verdict() !== null); }
  run(): void {
    this.checking.set(true);
    const opp = (this.matter().opposing ?? '').trim();
    setTimeout(() => {
      const hit = !!opp && EXISTING_CLIENTS.some((c) => c.toLowerCase() === opp.toLowerCase());
      const message = hit
        ? `${opp} is an existing client of the firm. The matter routes to conflict review for a waiver decision.`
        : `${opp ? opp + ' does not appear' : 'No adverse party given, and the client does not appear'} in the firm's client list. Cleared to proceed.`;
      const vd: Verdict = { hit, message, opposing: opp };
      this.verdict.set(vd);
      this.checking.set(false);
      this.store.patch({ conflictFound: hit, conflicts: vd });   // <- field the manifest branch reads
      this.store.setValid(true);
    }, 850);
  }
}

@Component({
  selector: 'lip-conflict-review', standalone: true, imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="banner"><span class="ic">⚠</span><div>This matter is adverse to
      <b>{{ opposing() || 'an existing client' }}</b>. A supervising partner must approve an ethical wall before intake continues.</div></div>
    <div class="field"><label>Supervising partner <span class="req">*</span></label>
      <input [ngModel]="partner()" (ngModelChange)="partner.set($event); sync()" placeholder="Partner name"></div>
    <div class="field"><label>Waiver / ethical-wall note</label>
      <textarea [ngModel]="note()" (ngModelChange)="note.set($event); sync()" placeholder="How the conflict is addressed"></textarea></div>
    <label class="check"><input type="checkbox" [ngModel]="ack()" (ngModelChange)="ack.set($event); sync()">
      <span>I confirm an ethical wall is in place and informed consent will be obtained.</span></label>`,
})
export class WaiverStepComponent {
  private readonly store = inject(IntakeStore);
  private readonly v = (this.store.data()['conflictReview'] as Record<string, unknown>) ?? {};
  readonly opposing = signal((this.store.data()['conflicts'] as Verdict | undefined)?.opposing
    ?? (this.store.data()['matter'] as MatterData | undefined)?.opposing ?? '');
  readonly partner = signal((this.v['partner'] as string) ?? '');
  readonly note = signal((this.v['note'] as string) ?? '');
  readonly ack = signal((this.v['ack'] as boolean) ?? false);
  constructor() { this.sync(); }
  sync(): void {
    this.store.patch({ conflictReview: { partner: this.partner(), note: this.note(), ack: this.ack() } });
    this.store.setValid(!!this.partner().trim() && this.ack());
  }
}

@Component({
  selector: 'lip-fee-form', standalone: true, imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field"><label>Fee arrangement <span class="req">*</span></label>
      <div class="seg">@for (t of types; track t) {
        <button type="button" [class.on]="type() === t" (click)="type.set(t); sync()">{{ t }}</button>}</div></div>
    <div class="row2">
      <div class="field"><label>{{ rateLabel() }}</label>
        <input [ngModel]="rate()" (ngModelChange)="rate.set($event); sync()" placeholder="e.g. 450"></div>
      <div class="field"><label>Retainer</label>
        <input [ngModel]="retainer()" (ngModelChange)="retainer.set($event); sync()" placeholder="e.g. 5,000"></div>
    </div>`,
})
export class FeesStepComponent {
  private readonly store = inject(IntakeStore);
  private readonly v = (this.store.data()['fees'] as Record<string, string>) ?? {};
  readonly types = FEE_TYPES;
  readonly type = signal(this.v['type'] ?? '');
  readonly rate = signal(this.v['rate'] ?? '');
  readonly retainer = signal(this.v['retainer'] ?? '');
  rateLabel(): string {
    return ({ Hourly: 'Hourly rate (USD)', 'Fixed fee': 'Fixed fee (USD)', Contingency: 'Contingency (%)' } as Record<string, string>)[this.type()] ?? 'Rate';
  }
  constructor() { this.sync(); }
  sync(): void {
    this.store.patch({ fees: { type: this.type(), rate: this.rate(), retainer: this.retainer() } });
    this.store.setValid(!!this.type());
  }
}

@Component({
  selector: 'lip-matter-review', standalone: true, imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="summary">
      <div class="grp"><div class="g-lbl">Client</div>
        <dl><dt>Name</dt><dd>{{ client().name || '—' }}</dd><dt>Email</dt><dd>{{ client().email || '—' }}</dd>
        <dt>Organization</dt><dd>{{ client().org || '—' }}</dd></dl></div>
      <div class="grp"><div class="g-lbl">Matter</div>
        <dl><dt>Type</dt><dd>{{ matter().type || '—' }}</dd><dt>Title</dt><dd>{{ matter().title || '—' }}</dd>
        <dt>Opposing party</dt><dd>{{ matter().opposing || 'None' }}</dd></dl></div>
      <div class="grp"><div class="g-lbl">Conflicts</div>
        <dl><dt>Screening</dt><dd>
          @if (conflict()) { <span class="chip hit">⚠ Conflict — waiver by {{ partner() || 'partner' }}</span> }
          @else { <span class="chip clear">✓ Cleared</span> }</dd></dl></div>
      <div class="grp"><div class="g-lbl">Fees</div>
        <dl><dt>Arrangement</dt><dd>{{ fees().type || '—' }}</dd><dt>Rate</dt><dd>{{ money() }}</dd>
        <dt>Retainer</dt><dd>{{ fees().retainer ? '$' + fees().retainer : '—' }}</dd></dl></div>
    </div>`,
})
export class ReviewStepComponent {
  private readonly store = inject(IntakeStore);
  readonly client = signal<ClientData>((this.store.data()['client'] as ClientData) ?? {});
  readonly matter = signal<MatterData>((this.store.data()['matter'] as MatterData) ?? {});
  readonly fees = signal<FeesData>((this.store.data()['fees'] as FeesData) ?? {});
  readonly conflict = signal(!!this.store.data()['conflictFound']);
  readonly partner = signal((this.store.data()['conflictReview'] as { partner?: string } | undefined)?.partner ?? '');
  constructor() { this.store.setValid(true); }
  money(): string {
    const f = this.fees();
    return !f.rate ? '—' : f.type === 'Contingency' ? `${f.rate}%` : `$${f.rate}`;
  }
}

/** Map a manifest widget name → this portal's component. */
export const WIDGETS: Record<string, Type<unknown>> = {
  'legal-client-form': ClientStepComponent,
  'legal-matter-form': MatterStepComponent,
  'legal-conflict-check': ConflictStepComponent,
  'legal-conflict-review': WaiverStepComponent,
  'legal-fee-form': FeesStepComponent,
  'legal-matter-review': ReviewStepComponent,
};
