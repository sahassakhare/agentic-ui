import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { COMPOSITION_SLOT, CompositionStore } from '@maverick/agentic-ui';

/**
 * Intake-form section widgets for the F1 composable-form demo.
 *
 * Each component renders one section of the runtime-composed
 * `custodianIntakeForm`. The form-renderer mounts them via
 * `*ngComponentOutlet` after evaluating composition `if` predicates
 * against the form context (matter type + persona + department).
 *
 * `IntakeIdentityComponent` demonstrates the AC-F1-2 contract: it reads
 * and writes its value through the renderer-provided `CompositionStore`
 * under its `slot` input, so values survive section unmount and remount.
 * The other three section components remain visual stubs in this slice.
 */

interface IdentityValue {
  readonly name: string;
  readonly email: string;
  readonly department: string;
}

const EMPTY_IDENTITY: IdentityValue = { name: '', email: '', department: '' };

@Component({
  selector: 'app-intake-identity',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="grid">
      <label>Full name
        <input type="text" [ngModel]="value().name" (ngModelChange)="patch({ name: $event })"
               name="name" placeholder="Sarah Chen" />
      </label>
      <label>Work email
        <input type="email" [ngModel]="value().email" (ngModelChange)="patch({ email: $event })"
               name="email" placeholder="sarah.chen@acme.example" />
      </label>
      <label>Department
        <input type="text" [ngModel]="value().department" (ngModelChange)="patch({ department: $event })"
               name="department" placeholder="Engineering" />
      </label>
    </div>
  `,
  styles: `
    :host { display: block; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 0.5rem; }
    label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.85rem; color: #374151; }
    input { padding: 0.4rem 0.5rem; border: 1px solid #d1d5db; border-radius: 0.3rem; font: inherit; }
  `,
})
export class IntakeIdentityComponent {
  private readonly slot = inject(COMPOSITION_SLOT, { optional: true });
  private readonly store = inject(CompositionStore, { optional: true });

  protected readonly value = computed<IdentityValue>(() => {
    if (!this.store || !this.slot) return EMPTY_IDENTITY;
    const v = this.store.values()[this.slot] as IdentityValue | undefined;
    return v ?? EMPTY_IDENTITY;
  });

  protected patch(part: Partial<IdentityValue>): void {
    if (!this.store || !this.slot) return;
    this.store.write(this.slot, { ...this.value(), ...part });
  }
}

@Component({
  selector: 'app-intake-regulatory-consent',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <p class="disclaimer">
      This matter is securities-related. Per Reg-FD §2.4, the custodian must acknowledge that
      preserved communications may be disclosed to the SEC, opposing counsel, and any
      authorised regulator. The acknowledgement is recorded in the audit chain and is
      irrevocable for the duration of the legal hold.
    </p>
    <label class="check">
      <input type="checkbox"
             [ngModel]="acknowledged()"
             (ngModelChange)="setAcknowledged($event)"
             name="reg-consent" />
      <span>The custodian has reviewed and accepted the regulatory disclosure.</span>
    </label>
  `,
  styles: `
    :host { display: block; }
    .disclaimer { margin: 0 0 0.4rem; padding: 0.5rem 0.7rem; background: #fef3c7; color: #78350f; font-size: 0.78rem; line-height: 1.4; border-radius: 0.3rem; }
    .check { display: flex; gap: 0.4rem; align-items: flex-start; font-size: 0.85rem; color: #374151; }
    .check span { line-height: 1.3; }
  `,
})
export class IntakeRegulatoryConsentComponent {
  private readonly slot = inject(COMPOSITION_SLOT, { optional: true });
  private readonly store = inject(CompositionStore, { optional: true });

  protected readonly acknowledged = computed<boolean>(() => {
    if (!this.store || !this.slot) return false;
    return Boolean(this.store.values()[this.slot]);
  });

  protected setAcknowledged(value: boolean): void {
    if (!this.store || !this.slot) return;
    this.store.write(this.slot, value);
  }
}

@Component({
  selector: 'app-intake-supervisor-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <p class="hint">Pick a senior reviewer who will sign off on the custodian onboarding.</p>
    <label>Supervisor email
      <input type="email"
             [ngModel]="supervisor()"
             (ngModelChange)="setSupervisor($event)"
             name="supervisor"
             placeholder="eleanor.vance@acme.example"
             list="supervisor-suggestions" />
    </label>
    <datalist id="supervisor-suggestions">
      <option value="eleanor.vance@acme.example">Eleanor Vance — Lead Counsel</option>
      <option value="marcus.osei@acme.example">Marcus Osei — Senior Associate</option>
      <option value="priya.shah@acme.example">Priya Shah — Litigation Support Lead</option>
    </datalist>
  `,
  styles: `
    :host { display: block; }
    .hint { margin: 0 0 0.4rem; color: #6b7280; font-size: 0.8rem; }
    label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.85rem; color: #374151; }
    input { padding: 0.4rem 0.5rem; border: 1px solid #d1d5db; border-radius: 0.3rem; font: inherit; }
  `,
})
export class IntakeSupervisorPickerComponent {
  private readonly slot = inject(COMPOSITION_SLOT, { optional: true });
  private readonly store = inject(CompositionStore, { optional: true });

  protected readonly supervisor = computed<string>(() => {
    if (!this.store || !this.slot) return '';
    return String(this.store.values()[this.slot] ?? '');
  });

  protected setSupervisor(value: string): void {
    if (!this.store || !this.slot) return;
    this.store.write(this.slot, value);
  }
}

const ACCOUNTING_SYSTEMS = [
  { id: 'netsuite', label: 'NetSuite' },
  { id: 'sap-s4', label: 'SAP S/4HANA' },
  { id: 'oracle-fusion', label: 'Oracle Fusion' },
  { id: 'dynamics365', label: 'Microsoft Dynamics 365' },
  { id: 'quickbooks', label: 'QuickBooks Enterprise' },
] as const;

@Component({
  selector: 'app-intake-accounting-systems',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="hint">Select every accounting system the custodian has access to.</p>
    <div class="grid">
      @for (sys of systems; track sys.id) {
        <label class="check">
          <input type="checkbox"
                 [checked]="isSelected(sys.id)"
                 (change)="toggle(sys.id)"
                 [name]="'sys-' + sys.id" />
          <span>{{ sys.label }}</span>
        </label>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .hint { margin: 0 0 0.4rem; color: #6b7280; font-size: 0.8rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.3rem 0.6rem; }
    .check { display: flex; gap: 0.4rem; align-items: center; font-size: 0.85rem; color: #374151; }
  `,
})
export class IntakeAccountingSystemsComponent {
  protected readonly systems = ACCOUNTING_SYSTEMS;

  private readonly slot = inject(COMPOSITION_SLOT, { optional: true });
  private readonly store = inject(CompositionStore, { optional: true });

  // Persisted as string[] so isDirty() / JSON-serialisation work cleanly.
  private readonly selected = computed<readonly string[]>(() => {
    if (!this.store || !this.slot) return [];
    const v = this.store.values()[this.slot];
    return Array.isArray(v) ? (v as readonly string[]) : [];
  });

  protected isSelected(id: string): boolean {
    return this.selected().includes(id);
  }

  protected toggle(id: string): void {
    if (!this.store || !this.slot) return;
    const cur = this.selected();
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    this.store.write(this.slot, next);
  }
}
