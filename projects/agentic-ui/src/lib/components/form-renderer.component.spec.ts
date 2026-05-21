import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  COMPOSITION_SLOT,
  ComponentRegistry,
  CompositionStore,
  DataSourceRegistry,
  FormRegistry,
  agenticDataSource,
  agenticForm,
  agenticWidget,
  type FormDef,
} from '../internal';
import { FormRendererComponent } from './form-renderer.component';

@Component({
  selector: 'mvk-test-contact-card',
  template: `<div data-testid="contact-card">contact</div>`,
})
class TestContactCardComponent {}

@Component({
  selector: 'mvk-test-consent',
  template: `<div data-testid="consent">consent</div>`,
})
class TestConsentComponent {}

@Component({
  selector: 'mvk-test-supervisor',
  template: `<div data-testid="supervisor">supervisor</div>`,
})
class TestSupervisorComponent {}

/**
 * Store-aware test widget. Reads + writes through `CompositionStore` under
 * the renderer-supplied `slot` input — mirrors the AC-F1-2 contract that
 * production widgets follow.
 */
@Component({
  selector: 'mvk-test-store-widget',
  template: `<div data-testid="store-widget" [attr.data-slot]="slot" [attr.data-value]="current()"></div>`,
})
class TestStoreWidgetComponent {
  readonly slot = inject(COMPOSITION_SLOT, { optional: true });
  readonly store = inject(CompositionStore, { optional: true });
  current(): string {
    return String(this.store?.values()[this.slot ?? ''] ?? '');
  }
}

function setupRegistries(): { forms: FormRegistry; components: ComponentRegistry } {
  const components = TestBed.inject(ComponentRegistry);
  const forms = TestBed.inject(FormRegistry);
  components.register(
    agenticWidget({
      name: 'contact-card-fields',
      component: TestContactCardComponent,
      propsSchema: z.object({}),
    }),
  );
  components.register(
    agenticWidget({
      name: 'regulatory-consent-checkbox',
      component: TestConsentComponent,
      propsSchema: z.object({}),
    }),
  );
  components.register(
    agenticWidget({
      name: 'supervisor-signoff-picker',
      component: TestSupervisorComponent,
      propsSchema: z.object({}),
    }),
  );
  return { forms, components };
}

describe('FormRendererComponent — composition mode (Capability F1)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('renders only sections whose predicates pass against the context (AC-F1-1)', () => {
    const { forms } = setupRegistries();
    forms.register(
      agenticForm({
        name: 'custodianIntake',
        description: 'Onboard a custodian',
        composition: [
          { widget: 'contact-card-fields', section: 'Identity' },
          {
            widget: 'regulatory-consent-checkbox',
            section: 'Compliance',
            if: 'matter.type === "securities"',
          },
          {
            widget: 'supervisor-signoff-picker',
            section: 'Approval',
            if: 'persona !== "lead-counsel"',
          },
        ],
        submit: () => undefined,
      }) as FormDef,
    );

    const fixture = TestBed.createComponent(FormRendererComponent);
    fixture.componentRef.setInput('formName', 'custodianIntake');
    fixture.componentRef.setInput('context', {
      matter: { type: 'securities' },
      persona: 'paralegal',
    });
    fixture.detectChanges();

    const headings = fixture.nativeElement.querySelectorAll('.section-heading');
    const headingTexts = Array.from(headings as NodeListOf<HTMLElement>).map((h) => h.textContent?.trim());
    expect(headingTexts).toEqual(['Identity', 'Compliance', 'Approval']);

    expect(fixture.nativeElement.querySelector('[data-testid="contact-card"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="consent"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="supervisor"]')).toBeTruthy();
  });

  it('hides sections when predicate evaluates false', () => {
    const { forms } = setupRegistries();
    forms.register(
      agenticForm({
        name: 'demo',
        description: 'demo',
        composition: [
          { widget: 'contact-card-fields', section: 'Identity' },
          {
            widget: 'regulatory-consent-checkbox',
            section: 'Compliance',
            if: 'matter.type === "securities"',
          },
        ],
        submit: () => undefined,
      }) as FormDef,
    );
    const fixture = TestBed.createComponent(FormRendererComponent);
    fixture.componentRef.setInput('formName', 'demo');
    fixture.componentRef.setInput('context', { matter: { type: 'employment' } });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="contact-card"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="consent"]')).toBeNull();
  });

  it('toggles sections when context input changes (AC-F1-1 reactive path)', () => {
    const { forms } = setupRegistries();
    forms.register(
      agenticForm({
        name: 'demo',
        description: 'demo',
        composition: [
          { widget: 'contact-card-fields' },
          {
            widget: 'supervisor-signoff-picker',
            if: 'persona !== "lead-counsel"',
          },
        ],
        submit: () => undefined,
      }) as FormDef,
    );
    const fixture = TestBed.createComponent(FormRendererComponent);
    fixture.componentRef.setInput('formName', 'demo');
    fixture.componentRef.setInput('context', { persona: 'paralegal' });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="supervisor"]')).toBeTruthy();

    fixture.componentRef.setInput('context', { persona: 'lead-counsel' });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="supervisor"]')).toBeNull();
  });

  it('renders a fallback when the widget is not registered', () => {
    const { forms } = setupRegistries();
    forms.register(
      agenticForm({
        name: 'broken',
        description: 'broken',
        composition: [{ widget: 'contact-card-fields' }, { widget: 'nonexistent-widget' }],
        submit: () => undefined,
      }) as FormDef,
    );
    const fixture = TestBed.createComponent(FormRendererComponent);
    fixture.componentRef.setInput('formName', 'broken');
    fixture.componentRef.setInput('context', {});
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Unknown widget: nonexistent-widget');
  });

  it('does not break when context is omitted (predicate-less entries still render)', () => {
    const { forms } = setupRegistries();
    forms.register(
      agenticForm({
        name: 'nopred',
        description: 'no predicates',
        composition: [{ widget: 'contact-card-fields' }],
        submit: () => undefined,
      }) as FormDef,
    );
    const fixture = TestBed.createComponent(FormRendererComponent);
    fixture.componentRef.setInput('formName', 'nopred');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="contact-card"]')).toBeTruthy();
  });

  it('renders nothing when the form is unregistered', () => {
    TestBed.inject(ComponentRegistry); // ensure injectable seam
    const fixture = TestBed.createComponent(FormRendererComponent);
    fixture.componentRef.setInput('formName', 'never-registered');
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('not registered');
  });
});

describe('FormRendererComponent — AC-F1-2 (preservation + drop/keep prompt)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  function setupStoreScenario(submitFn: (values: unknown) => void = () => undefined) {
    const components = TestBed.inject(ComponentRegistry);
    const forms = TestBed.inject(FormRegistry);
    components.register(
      agenticWidget({
        name: 'always-on',
        component: TestStoreWidgetComponent,
        propsSchema: z.object({}),
      }),
    );
    components.register(
      agenticWidget({
        name: 'conditional',
        component: TestStoreWidgetComponent,
        propsSchema: z.object({}),
      }),
    );
    forms.register(
      agenticForm({
        name: 'storeForm',
        description: 'store form',
        composition: [
          { widget: 'always-on' },
          { widget: 'conditional', if: 'persona !== "lead-counsel"' },
        ],
        submit: submitFn,
      }) as FormDef,
    );
    const fixture = TestBed.createComponent(FormRendererComponent);
    fixture.componentRef.setInput('formName', 'storeForm');
    fixture.componentRef.setInput('context', { persona: 'paralegal' });
    fixture.detectChanges();
    const renderer = fixture.componentInstance as unknown as {
      // expose protected/private members for assertions only
      visibleSections: () => Array<{ entry: { widget: string }; pendingDrop: boolean; keepOverride: boolean }>;
      dropSection: (slot: string) => void;
      keepSection: (slot: string) => void;
    };
    return { fixture, renderer };
  }

  it('preserves a clean slot value across context changes that keep the section visible', () => {
    const { fixture } = setupStoreScenario();
    const store = fixture.debugElement.injector.get(CompositionStore);
    store.write('always-on', 'hello');

    fixture.componentRef.setInput('context', { persona: 'associate' });
    fixture.detectChanges();
    expect(store.read('always-on')).toBe('hello');
  });

  it('clean predicate flip → no banner, section unmounts', () => {
    const { fixture, renderer } = setupStoreScenario();

    fixture.componentRef.setInput('context', { persona: 'lead-counsel' });
    fixture.detectChanges();

    const visible = renderer.visibleSections().map((s) => s.entry.widget);
    expect(visible).toEqual(['always-on']);
    expect(fixture.nativeElement.querySelector('.drop-banner')).toBeNull();
  });

  it('dirty predicate flip → banner appears, section stays mounted with values', () => {
    const { fixture, renderer } = setupStoreScenario();
    const store = fixture.debugElement.injector.get(CompositionStore);
    store.write('conditional', 'has-data');
    fixture.detectChanges();

    fixture.componentRef.setInput('context', { persona: 'lead-counsel' });
    fixture.detectChanges();

    const visible = renderer.visibleSections().map((s) => s.entry.widget);
    expect(visible).toContain('conditional');
    expect(fixture.nativeElement.querySelector('.drop-banner')).not.toBeNull();
    // Value preserved while user decides
    expect(store.read('conditional')).toBe('has-data');
  });

  it('Drop values: store loses the slot, section unmounts on next pass, banner gone', () => {
    const { fixture, renderer } = setupStoreScenario();
    const store = fixture.debugElement.injector.get(CompositionStore);
    store.write('conditional', 'will-be-dropped');
    fixture.detectChanges();

    fixture.componentRef.setInput('context', { persona: 'lead-counsel' });
    fixture.detectChanges();

    renderer.dropSection('conditional');
    fixture.detectChanges();

    expect(store.read('conditional')).toBeUndefined();
    expect(fixture.nativeElement.querySelector('.drop-banner')).toBeNull();
    const visible = renderer.visibleSections().map((s) => s.entry.widget);
    expect(visible).toEqual(['always-on']);
  });

  it('Keep visible: banner gone, section stays mounted with hint, values preserved', () => {
    const { fixture, renderer } = setupStoreScenario();
    const store = fixture.debugElement.injector.get(CompositionStore);
    store.write('conditional', 'preserved');
    fixture.detectChanges();

    fixture.componentRef.setInput('context', { persona: 'lead-counsel' });
    fixture.detectChanges();

    renderer.keepSection('conditional');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.drop-banner')).toBeNull();
    expect(fixture.nativeElement.querySelector('.keep-hint')).not.toBeNull();
    expect(store.read('conditional')).toBe('preserved');

    const sec = renderer.visibleSections().find((s) => s.entry.widget === 'conditional');
    expect(sec?.keepOverride).toBe(true);
  });

  it('predicate goes true again → keepOverride clears, hint disappears, normal operation resumes', () => {
    const { fixture, renderer } = setupStoreScenario();
    const store = fixture.debugElement.injector.get(CompositionStore);
    store.write('conditional', 'preserved');
    fixture.detectChanges();

    fixture.componentRef.setInput('context', { persona: 'lead-counsel' });
    fixture.detectChanges();
    renderer.keepSection('conditional');
    fixture.detectChanges();

    fixture.componentRef.setInput('context', { persona: 'paralegal' });
    fixture.detectChanges();

    const sec = renderer.visibleSections().find((s) => s.entry.widget === 'conditional');
    expect(sec?.keepOverride).toBe(false);
    expect(fixture.nativeElement.querySelector('.keep-hint')).toBeNull();
    expect(store.read('conditional')).toBe('preserved');
  });

  it('Submit aggregates the store snapshot', async () => {
    const submit = vi.fn();
    const { fixture } = setupStoreScenario(submit);
    const store = fixture.debugElement.injector.get(CompositionStore);
    store.write('always-on', { name: 'Sarah' });
    store.write('conditional', { signoff: 'eleanor@x.com' });

    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(submit).toHaveBeenCalledWith({
      'always-on': { name: 'Sarah' },
      conditional: { signoff: 'eleanor@x.com' },
    });
  });

  it('seeds composition slots from initialValues so widgets mount pre-filled', () => {
    const components = TestBed.inject(ComponentRegistry);
    const forms = TestBed.inject(FormRegistry);
    components.register(
      agenticWidget({ name: 'identity', component: TestStoreWidgetComponent, propsSchema: z.object({}) }),
    );
    forms.register(
      agenticForm({
        name: 'seededForm',
        description: 'seeded form',
        composition: [{ widget: 'identity' }],
        submit: () => undefined,
      }) as FormDef,
    );

    const fixture = TestBed.createComponent(FormRendererComponent);
    fixture.componentRef.setInput('formName', 'seededForm');
    // String value so the test widget's String(value) reflection is legible.
    fixture.componentRef.setInput('initialValues', { identity: 'Finance' });
    fixture.detectChanges();

    // The store carries the seeded value (survives the mount-time clear)…
    const store = fixture.debugElement.injector.get(CompositionStore);
    expect(store.read('identity')).toBe('Finance');
    // …and the mounted widget reads it rather than rendering empty.
    const widget = fixture.nativeElement.querySelector('[data-testid="store-widget"]') as HTMLElement;
    expect(widget.getAttribute('data-value')).toBe('Finance');
  });
});

describe('FormRendererComponent — F2 mount-time data-source validation', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('renders the missing-data-sources placeholder when a declared source is absent (AC-F2-1)', () => {
    const components = TestBed.inject(ComponentRegistry);
    const forms = TestBed.inject(FormRegistry);
    components.register(
      agenticWidget({
        name: 'needs-users',
        component: TestStoreWidgetComponent,
        propsSchema: z.object({}),
        dataSources: ['users'],
      }),
    );
    // NOTE: we deliberately do NOT register the 'users' source.
    forms.register(
      agenticForm({
        name: 'f2Form',
        description: 'f2',
        composition: [{ widget: 'needs-users' }],
        submit: () => undefined,
      }) as FormDef,
    );

    const fixture = TestBed.createComponent(FormRendererComponent);
    fixture.componentRef.setInput('formName', 'f2Form');
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('missing required data sources');
    expect(text).toContain('users');
    // Component MUST NOT mount when a required source is missing.
    expect(fixture.nativeElement.querySelector('[data-testid="store-widget"]')).toBeNull();
  });

  it('mounts the widget normally once the required source is registered', () => {
    const components = TestBed.inject(ComponentRegistry);
    const forms = TestBed.inject(FormRegistry);
    const sources = TestBed.inject(DataSourceRegistry);

    sources.register(agenticDataSource({ name: 'users', kind: 'rest', adapter: async () => [] }));
    components.register(
      agenticWidget({
        name: 'needs-users',
        component: TestStoreWidgetComponent,
        propsSchema: z.object({}),
        dataSources: ['users'],
      }),
    );
    forms.register(
      agenticForm({
        name: 'f2FormOk',
        description: 'f2',
        composition: [{ widget: 'needs-users' }],
        submit: () => undefined,
      }) as FormDef,
    );

    const fixture = TestBed.createComponent(FormRendererComponent);
    fixture.componentRef.setInput('formName', 'f2FormOk');
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('missing required data sources');
    expect(fixture.nativeElement.querySelector('[data-testid="store-widget"]')).not.toBeNull();
  });
});

describe('FormRendererComponent — schema mode (no regression)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('renders fields from a Zod schema', () => {
    const forms = TestBed.inject(FormRegistry);
    forms.register(
      agenticForm({
        name: 'schemaForm',
        description: 'schema mode',
        fieldsSchema: z.object({
          name: z.string(),
          email: z.string(),
        }),
        submit: () => undefined,
      }) as FormDef,
    );
    const fixture = TestBed.createComponent(FormRendererComponent);
    fixture.componentRef.setInput('formName', 'schemaForm');
    fixture.detectChanges();

    const labels = fixture.nativeElement.querySelectorAll('label span');
    const labelTexts = Array.from(labels as NodeListOf<HTMLElement>).map((l) => l.textContent?.trim() ?? '');
    expect(labelTexts.some((t) => t.startsWith('Name'))).toBe(true);
    expect(labelTexts.some((t) => t.startsWith('Email'))).toBe(true);
  });
});
