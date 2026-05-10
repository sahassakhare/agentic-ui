import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  COMPOSITION_SLOT,
  CompositionStore,
  DataSourceRegistry,
} from '@maverick/agentic-ui';
import type { DirectoryUser, DirectoryUserQuery } from './agentic';

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
 *
 * Each section also surfaces **operator-visible validation** (plan R2):
 * touched-and-invalid fields turn red, inline errors name the failing
 * rule, and `aria-invalid` flips so screen readers pick the state up.
 * Validation runs on every keystroke; widgets remain plain, schema-free
 * inputs (the form's submit handler still re-validates server-side).
 */

interface IdentityValue {
  readonly name: string;
  readonly email: string;
  readonly department: string;
}

const EMPTY_IDENTITY: IdentityValue = { name: '', email: '', department: '' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FREE_MAIL_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com']);

@Component({
  selector: 'app-intake-identity',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="grid">
      <label>
        <span class="lbl">Full name <span class="req" aria-label="required">*</span></span>
        <input type="text" [ngModel]="value().name"
               (ngModelChange)="patch({ name: $event })"
               (blur)="touch('name')"
               name="name" placeholder="Sarah Chen"
               [class.invalid]="show('name')"
               [attr.aria-invalid]="show('name') || null"
               [attr.aria-describedby]="show('name') ? 'err-name' : null" />
        @if (show('name'); as msg) {
          <small class="error" id="err-name" role="alert">{{ errors()['name'] }}</small>
        }
      </label>

      <label>
        <span class="lbl">Work email <span class="req" aria-label="required">*</span></span>
        <input type="email" [ngModel]="value().email"
               (ngModelChange)="patch({ email: $event })"
               (blur)="touch('email')"
               name="email" placeholder="sarah.chen@acme.example"
               autocomplete="email"
               [class.invalid]="show('email')"
               [attr.aria-invalid]="show('email') || null"
               [attr.aria-describedby]="show('email') ? 'err-email' : null" />
        @if (show('email')) {
          <small class="error" id="err-email" role="alert">{{ errors()['email'] }}</small>
        }
      </label>

      <label>
        <span class="lbl">Department <span class="req" aria-label="required">*</span></span>
        <input type="text" [ngModel]="value().department"
               (ngModelChange)="patch({ department: $event })"
               (blur)="touch('department')"
               name="department" placeholder="Engineering"
               list="dept-suggestions"
               [class.invalid]="show('department')"
               [attr.aria-invalid]="show('department') || null"
               [attr.aria-describedby]="show('department') ? 'err-department' : null" />
        <datalist id="dept-suggestions">
          @for (d of knownDepartments; track d) { <option [value]="d"></option> }
        </datalist>
        @if (show('department')) {
          <small class="error" id="err-department" role="alert">{{ errors()['department'] }}</small>
        }
      </label>
    </div>
  `,
  styles: `
    :host { display: block; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 0.6rem; }
    label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.85rem; color: #374151; }
    .lbl { font-weight: 500; }
    .req { color: #b91c1c; margin-left: 2px; }
    input { padding: 0.4rem 0.5rem; border: 1px solid #d1d5db; border-radius: 0.3rem; font: inherit; }
    input:focus { outline: 2px solid #3b82f6; outline-offset: -1px; }
    input.invalid { border-color: #dc2626; background: #fef2f2; }
    input.invalid:focus { outline-color: #dc2626; }
    .error { color: #b91c1c; font-size: 0.75rem; margin-top: 0.1rem; }
  `,
})
export class IntakeIdentityComponent {
  private readonly slot = inject(COMPOSITION_SLOT, { optional: true });
  private readonly store = inject(CompositionStore, { optional: true });

  protected readonly knownDepartments = ['Engineering', 'Finance', 'Legal', 'Marketing', 'Operations', 'Sales', 'HR'];

  protected readonly value = computed<IdentityValue>(() => {
    if (!this.store || !this.slot) return EMPTY_IDENTITY;
    const v = this.store.values()[this.slot] as IdentityValue | undefined;
    return v ?? EMPTY_IDENTITY;
  });

  /** Per-field touched flags. Errors hide until the field has been
   *  blurred at least once OR the user has tried to submit. */
  private readonly touched = signal<Record<string, boolean>>({});

  protected readonly errors = computed<Record<string, string>>(() => {
    const v = this.value();
    const out: Record<string, string> = {};
    if (!v.name.trim()) out['name'] = 'Full name is required.';
    else if (v.name.trim().length < 2) out['name'] = 'At least 2 characters.';
    else if (v.name.length > 80) out['name'] = 'Max 80 characters.';

    if (!v.email.trim()) out['email'] = 'Work email is required.';
    else if (!EMAIL_RE.test(v.email)) out['email'] = 'Use a valid email address.';
    else {
      const domain = v.email.split('@')[1]?.toLowerCase();
      if (domain && FREE_MAIL_DOMAINS.has(domain)) out['email'] = 'Use the custodian’s corporate address (no free-mail domains).';
    }

    if (!v.department.trim()) out['department'] = 'Department is required.';
    else if (v.department.trim().length < 2) out['department'] = 'At least 2 characters.';
    return out;
  });

  protected show(field: 'name' | 'email' | 'department'): boolean {
    const t = this.touched();
    const e = this.errors();
    return Boolean(t[field]) && Boolean(e[field]);
  }

  protected touch(field: string): void {
    this.touched.update((t) => ({ ...t, [field]: true }));
  }

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
    <label class="check" [class.invalid]="showError()">
      <input type="checkbox"
             [ngModel]="acknowledged()"
             (ngModelChange)="set($event)"
             (blur)="touch()"
             name="reg-consent"
             [attr.aria-invalid]="showError() || null"
             [attr.aria-describedby]="showError() ? 'err-consent' : null" />
      <span>The custodian has reviewed and accepted the regulatory disclosure.</span>
    </label>
    @if (showError()) {
      <small class="error" id="err-consent" role="alert">Acknowledgement is required for securities matters.</small>
    }
  `,
  styles: `
    :host { display: block; }
    .disclaimer { margin: 0 0 0.4rem; padding: 0.5rem 0.7rem; background: #fef3c7; color: #78350f; font-size: 0.78rem; line-height: 1.4; border-radius: 0.3rem; }
    .check { display: flex; gap: 0.4rem; align-items: flex-start; font-size: 0.85rem; color: #374151; padding: 0.25rem 0.4rem; border-radius: 0.3rem; }
    .check.invalid { background: #fef2f2; outline: 1px solid #fca5a5; }
    .check span { line-height: 1.3; }
    .error { color: #b91c1c; font-size: 0.75rem; margin-top: 0.2rem; display: block; }
  `,
})
export class IntakeRegulatoryConsentComponent {
  private readonly slot = inject(COMPOSITION_SLOT, { optional: true });
  private readonly store = inject(CompositionStore, { optional: true });
  private readonly touched = signal(false);

  protected readonly acknowledged = computed<boolean>(() => {
    if (!this.store || !this.slot) return false;
    return Boolean(this.store.values()[this.slot]);
  });

  protected showError(): boolean {
    return this.touched() && !this.acknowledged();
  }

  protected touch(): void {
    this.touched.set(true);
  }

  protected set(value: boolean): void {
    if (this.store && this.slot) this.store.write(this.slot, value);
    this.touched.set(true);
  }
}

@Component({
  selector: 'app-intake-supervisor-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <p class="hint">Pick a senior reviewer who will sign off on the custodian onboarding.</p>
    <label>
      <span class="lbl">Supervisor email <span class="req" aria-label="required">*</span></span>
      <input type="email"
             [ngModel]="supervisor()"
             (ngModelChange)="onPrefix($event)"
             (blur)="touch()"
             name="supervisor"
             placeholder="Type a name or email…"
             list="supervisor-suggestions"
             [class.invalid]="showError()"
             [attr.aria-invalid]="showError() || null"
             [attr.aria-describedby]="showError() ? 'err-supervisor' : null" />
    </label>
    <datalist id="supervisor-suggestions">
      @for (u of suggestions(); track u.email) {
        <option [value]="u.email">{{ u.name }} — {{ u.role }}</option>
      }
    </datalist>
    @if (showError(); as err) {
      <small class="error" id="err-supervisor" role="alert">{{ err }}</small>
    }
  `,
  styles: `
    :host { display: block; }
    .hint { margin: 0 0 0.4rem; color: #6b7280; font-size: 0.8rem; }
    label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.85rem; color: #374151; }
    .lbl { font-weight: 500; }
    .req { color: #b91c1c; margin-left: 2px; }
    input { padding: 0.4rem 0.5rem; border: 1px solid #d1d5db; border-radius: 0.3rem; font: inherit; }
    input.invalid { border-color: #dc2626; background: #fef2f2; }
    .error { color: #b91c1c; font-size: 0.75rem; margin-top: 0.2rem; display: block; }
  `,
})
export class IntakeSupervisorPickerComponent {
  private readonly slot = inject(COMPOSITION_SLOT, { optional: true });
  private readonly store = inject(CompositionStore, { optional: true });
  // Capability F2: typed view of the `users` source. Throws at construction
  // if the source is missing — but the renderer's mount-time validation
  // catches that earlier and surfaces a placeholder, so callers can rely
  // on this being safe in production.
  private readonly directory = inject(DataSourceRegistry).getTyped<
    DirectoryUserQuery,
    Promise<readonly DirectoryUser[]>
  >('users');

  protected readonly suggestions = signal<readonly DirectoryUser[]>([]);
  private readonly touched = signal(false);

  protected readonly supervisor = computed<string>(() => {
    if (!this.store || !this.slot) return '';
    return String(this.store.values()[this.slot] ?? '');
  });

  /** Returns the active error string, or empty if valid / not yet
   *  touched. Returning `string` rather than `boolean` lets the
   *  template `@if` capture the message in one expression. */
  protected showError(): string {
    if (!this.touched()) return '';
    const v = this.supervisor().trim();
    if (!v) return 'Supervisor is required.';
    if (!EMAIL_RE.test(v)) return 'Use a valid email address.';
    return '';
  }

  protected touch(): void {
    this.touched.set(true);
  }

  protected onPrefix(value: string): void {
    if (this.store && this.slot) this.store.write(this.slot, value);
    void this.refreshSuggestions(value);
  }

  private async refreshSuggestions(prefix: string): Promise<void> {
    const users = await this.directory.adapter({ prefix });
    this.suggestions.set(users);
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
    <p class="hint">Select every accounting system the custodian has access to. <span class="req" aria-label="required">*</span></p>
    <div class="grid" [class.invalid]="showError()" [attr.aria-invalid]="showError() || null"
         [attr.aria-describedby]="showError() ? 'err-accounting' : null"
         (focusout)="touch()">
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
    @if (showError()) {
      <small class="error" id="err-accounting" role="alert">Select at least one system the custodian uses.</small>
    }
  `,
  styles: `
    :host { display: block; }
    .hint { margin: 0 0 0.4rem; color: #6b7280; font-size: 0.8rem; }
    .req { color: #b91c1c; margin-left: 2px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.3rem 0.6rem; padding: 0.3rem 0.4rem; border-radius: 0.3rem; }
    .grid.invalid { background: #fef2f2; outline: 1px solid #fca5a5; }
    .check { display: flex; gap: 0.4rem; align-items: center; font-size: 0.85rem; color: #374151; }
    .error { color: #b91c1c; font-size: 0.75rem; margin-top: 0.2rem; display: block; }
  `,
})
export class IntakeAccountingSystemsComponent {
  protected readonly systems = ACCOUNTING_SYSTEMS;

  private readonly slot = inject(COMPOSITION_SLOT, { optional: true });
  private readonly store = inject(CompositionStore, { optional: true });
  private readonly touched = signal(false);

  // Persisted as string[] so isDirty() / JSON-serialisation work cleanly.
  private readonly selected = computed<readonly string[]>(() => {
    if (!this.store || !this.slot) return [];
    const v = this.store.values()[this.slot];
    return Array.isArray(v) ? (v as readonly string[]) : [];
  });

  protected isSelected(id: string): boolean {
    return this.selected().includes(id);
  }

  protected showError(): boolean {
    return this.touched() && this.selected().length === 0;
  }

  protected touch(): void {
    this.touched.set(true);
  }

  protected toggle(id: string): void {
    if (!this.store || !this.slot) return;
    const cur = this.selected();
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    this.store.write(this.slot, next);
    this.touched.set(true);
  }
}
