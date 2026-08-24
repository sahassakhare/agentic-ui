import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SchemaFormComponent, type SchemaField } from './schema-form.component';

/**
 * Rendering contract for the live form preview: every field type the catalog
 * (or an agent) can author must resolve to a real control — never fall through
 * to a bare text box. The fields below mirror the shapes seen in the seeded
 * `acme` catalog forms (notably `type:'boolean'` and the `receipt-upload` /
 * `profile-fields` component widgets) plus the full authoring palette.
 */
describe('SchemaFormComponent rendering', () => {
  function render(fields: SchemaField[]): HTMLElement {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(SchemaFormComponent);
    fixture.componentRef.setInput('body', { schema: { fields } });
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('renders a distinct control for every field type — none fall through to a plain textbox', () => {
    const el = render([
      { name: 'text', type: 'text' },
      { name: 'email', type: 'email' },
      { name: 'num', type: 'number' },
      { name: 'when', type: 'date' },
      { name: 'at', type: 'time' },
      { name: 'notes', type: 'textarea' },
      { name: 'pick', type: 'select', options: ['a', 'b'] },
      { name: 'picks', type: 'multiselect', options: ['a', 'b'] },
      { name: 'agree', type: 'checkbox' },
      { name: 'confirm', type: 'boolean', label: 'I confirm' },
      { name: 'live', type: 'toggle' },
      { name: 'choice', type: 'radio', options: ['x', 'y'] },
      { name: 'level', type: 'range' },
    ]);

    expect(el.querySelectorAll('mat-checkbox').length).toBe(2);     // checkbox + boolean
    expect(el.querySelector('mat-slide-toggle')).toBeTruthy();      // toggle
    expect(el.querySelector('mat-radio-group')).toBeTruthy();       // radio
    expect(el.querySelectorAll('mat-select').length).toBe(2);       // select + multiselect
    expect(el.querySelector('mat-slider')).toBeTruthy();            // range
    expect(el.querySelector('input[type=number]')).toBeTruthy();
    expect(el.querySelector('mat-datepicker-toggle')).toBeTruthy(); // date → Material datepicker
    expect(el.querySelector('input[type=time]')).toBeTruthy();
    expect(el.querySelector('textarea')).toBeTruthy();
  });

  it('renders a boolean field as a checkbox, not a text input', () => {
    const el = render([{ name: 'conflictFound', type: 'boolean', label: 'Conflict found' }]);
    expect(el.querySelector('mat-checkbox')).toBeTruthy();
    expect(el.querySelector('input[type=boolean]')).toBeNull(); // the old fall-through bug
  });

  it('renders an upload-style component widget as a file control', () => {
    const el = render([{ name: 'receipt', type: 'text', widget: 'receipt-upload' }]);
    expect(el.querySelector('.sf-file')).toBeTruthy();
    expect(el.querySelector('input[type=file]')).toBeTruthy();
  });

  it('renders a composite component widget as a component slot (not a textbox)', () => {
    const el = render([{ name: 'profile', type: 'text', widget: 'profile-fields' }]);
    const slot = el.querySelector('.sf-slot');
    expect(slot).toBeTruthy();
    expect(slot!.textContent).toContain('profile-fields');
    // A composite slot must not degrade into a lone text input.
    expect(el.querySelector('.sf-slot input')).toBeNull();
  });

  it('keeps primitive-mapped widgets rendering their control (picker → select)', () => {
    const el = render([{ name: 'priority', type: 'select', widget: 'priority-picker', options: ['Low', 'High'] }]);
    expect(el.querySelector('mat-select')).toBeTruthy();
    expect(el.querySelector('.sf-slot')).toBeNull();
  });

  it('keeps the submit action disabled while a required field is invalid', () => {
    const el = render([{ name: 'email', type: 'email', required: true }]);
    const submit = el.querySelector('button[type=submit]') as HTMLButtonElement | null;
    expect(submit).toBeTruthy();
    expect(submit!.disabled).toBe(true);
  });

  it('falls back to a text input for unknown types rather than an invalid input type', () => {
    const el = render([{ name: 'mystery', type: 'quantum' as unknown as SchemaField['type'] }]);
    const input = el.querySelector('.sf-field input') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    expect(input!.getAttribute('type')).toBe('text');
  });
});
