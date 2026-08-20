import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  COMPOSITION_SLOT,
  ComponentRegistry,
  CompositionStore,
  FormRegistry,
  agenticWidget,
  agenticWorkflow,
  type FormDef,
} from '../internal';
import { WorkflowRendererComponent } from './workflow-renderer.component';

/**
 * Store-aware test step. Reads + writes through CompositionStore under
 * the renderer-supplied COMPOSITION_SLOT (= step id) — same contract as
 * production widgets follow.
 */
@Component({
  selector: 'mvk-test-step',
  template: `<div data-testid="step" [attr.data-slot]="slot ?? ''" [attr.data-value]="current()"></div>`,
})
class TestStepComponent {
  readonly slot = inject(COMPOSITION_SLOT, { optional: true });
  readonly store = inject(CompositionStore, { optional: true });
  current(): string {
    return String(this.store?.values()[this.slot ?? ''] ?? '');
  }
}

@Component({
  selector: 'mvk-test-step-b',
  template: `<div data-testid="step-b" [attr.data-slot]="slot ?? ''"></div>`,
})
class TestStepBComponent {
  readonly slot = inject(COMPOSITION_SLOT, { optional: true });
}

@Component({
  selector: 'mvk-test-step-c',
  template: `<div data-testid="step-c" [attr.data-slot]="slot ?? ''"></div>`,
})
class TestStepCComponent {
  readonly slot = inject(COMPOSITION_SLOT, { optional: true });
}

function setup() {
  const components = TestBed.inject(ComponentRegistry);
  const forms = TestBed.inject(FormRegistry);
  components.register(
    agenticWidget({ name: 'step-a', component: TestStepComponent, propsSchema: z.object({}) }),
  );
  components.register(
    agenticWidget({ name: 'step-b', component: TestStepBComponent, propsSchema: z.object({}) }),
  );
  components.register(
    agenticWidget({ name: 'step-c', component: TestStepCComponent, propsSchema: z.object({}) }),
  );
  return { components, forms };
}

describe('WorkflowRendererComponent — Capability F3 (provisional)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('mounts the initial step (defaults to first) and renders the breadcrumb', () => {
    const { forms } = setup();
    forms.register(
      agenticWorkflow({
        name: 'wf',
        steps: [
          { id: 'first',  widget: 'step-a', section: 'First',  next: 'second' },
          { id: 'second', widget: 'step-b', section: 'Second', next: null },
        ],
        onComplete: async () => undefined,
      }) as FormDef,
    );
    const fixture = TestBed.createComponent(WorkflowRendererComponent);
    fixture.componentRef.setInput('formName', 'wf');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="step"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="step-b"]')).toBeNull();
    const crumbs = fixture.nativeElement.querySelectorAll('.crumb');
    expect(crumbs.length).toBe(2);
    expect(crumbs[0].classList.contains('active')).toBe(true);
  });

  it('initialStepId input overrides the starting step', () => {
    const { forms } = setup();
    forms.register(
      agenticWorkflow({
        name: 'wf',
        steps: [
          { id: 'first',  widget: 'step-a', next: 'second' },
          { id: 'second', widget: 'step-b', next: null },
        ],
        onComplete: async () => undefined,
      }) as FormDef,
    );
    const fixture = TestBed.createComponent(WorkflowRendererComponent);
    fixture.componentRef.setInput('formName', 'wf');
    fixture.componentRef.setInput('initialStepId', 'second');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="step-b"]')).toBeTruthy();
  });

  it('AC-F3-1: terminal step "Submit" calls onComplete with the aggregated store snapshot', async () => {
    const { forms } = setup();
    const onComplete = vi.fn().mockResolvedValue(undefined);
    forms.register(
      agenticWorkflow({
        name: 'wf',
        steps: [
          { id: 'a', widget: 'step-a', next: 'b' },
          { id: 'b', widget: 'step-b', next: null },
        ],
        onComplete,
      }) as FormDef,
    );
    const fixture = TestBed.createComponent(WorkflowRendererComponent);
    fixture.componentRef.setInput('formName', 'wf');
    fixture.detectChanges();

    const store = fixture.debugElement.injector.get(CompositionStore);
    store.write('a', 'value-a');

    // Step 'a' → 'b'  (advance is async — resolveNextAsync supports DecisionNext)
    const nextBtn = fixture.nativeElement.querySelectorAll('button.primary')[0] as HTMLButtonElement;
    nextBtn.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="step-b"]')).toBeTruthy();
    store.write('b', 'value-b');

    // Terminal Submit on step 'b'
    const submitBtn = fixture.nativeElement.querySelector('button.primary') as HTMLButtonElement;
    submitBtn.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith(
      { a: 'value-a', b: 'value-b' },
      expect.objectContaining({}),
    );
    expect(fixture.nativeElement.querySelector('.completed')).toBeTruthy();
  });

  it('AC-F3-2: conditional next branches on the current state', async () => {
    const { forms } = setup();
    forms.register(
      agenticWorkflow({
        name: 'branchy',
        steps: [
          { id: 'a', widget: 'step-a', next: (state) =>
              (state['a'] as string) === 'go-c' ? 'c' : 'b' },
          { id: 'b', widget: 'step-b', next: null },
          { id: 'c', widget: 'step-c', next: null },
        ],
        onComplete: async () => undefined,
      }) as FormDef,
    );
    const fixture = TestBed.createComponent(WorkflowRendererComponent);
    fixture.componentRef.setInput('formName', 'branchy');
    fixture.detectChanges();

    const store = fixture.debugElement.injector.get(CompositionStore);
    store.write('a', 'go-c');
    fixture.detectChanges();

    const nextBtn = fixture.nativeElement.querySelector('button.primary') as HTMLButtonElement;
    nextBtn.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="step-c"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="step-b"]')).toBeNull();
  });

  it('AC-F3-3: Back navigation preserves prior step values via CompositionStore', async () => {
    const { forms } = setup();
    forms.register(
      agenticWorkflow({
        name: 'wf',
        steps: [
          { id: 'a', widget: 'step-a', next: 'b' },
          { id: 'b', widget: 'step-b', next: null },
        ],
        onComplete: async () => undefined,
      }) as FormDef,
    );
    const fixture = TestBed.createComponent(WorkflowRendererComponent);
    fixture.componentRef.setInput('formName', 'wf');
    fixture.detectChanges();
    const store = fixture.debugElement.injector.get(CompositionStore);

    // Fill step 'a' → advance to 'b' (async advance)
    store.write('a', 'a-value');
    (fixture.nativeElement.querySelector('button.primary') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="step-b"]')).toBeTruthy();

    // Click Back → returns to step 'a' with value preserved (back() is synchronous)
    const backBtn = fixture.nativeElement.querySelectorAll('button')[0] as HTMLButtonElement;
    backBtn.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="step"]')).toBeTruthy();
    expect(store.read('a')).toBe('a-value');
  });

  it('reports an error when conditional next returns an unknown step id', async () => {
    const { forms } = setup();
    forms.register(
      agenticWorkflow({
        name: 'wf',
        steps: [
          { id: 'a', widget: 'step-a', next: () => 'nonexistent' },
          { id: 'b', widget: 'step-b', next: null },
        ],
        onComplete: async () => undefined,
      }) as FormDef,
    );
    const fixture = TestBed.createComponent(WorkflowRendererComponent);
    fixture.componentRef.setInput('formName', 'wf');
    fixture.detectChanges();

    const nextBtn = fixture.nativeElement.querySelector('button.primary') as HTMLButtonElement;
    nextBtn.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const err = fixture.nativeElement.querySelector('.error');
    expect(err?.textContent).toContain("Unknown next step 'nonexistent'");
    // Still on step 'a'
    expect(fixture.nativeElement.querySelector('[data-testid="step"]')).toBeTruthy();
  });

  it('renders a placeholder when the step widget is not registered', () => {
    const components = TestBed.inject(ComponentRegistry);
    const forms = TestBed.inject(FormRegistry);
    components.register(
      agenticWidget({ name: 'step-a', component: TestStepComponent, propsSchema: z.object({}) }),
    );
    forms.register(
      agenticWorkflow({
        name: 'wf',
        steps: [{ id: 'orphan', widget: 'never-registered', next: null }],
        onComplete: async () => undefined,
      }) as FormDef,
    );
    const fixture = TestBed.createComponent(WorkflowRendererComponent);
    fixture.componentRef.setInput('formName', 'wf');
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Unknown widget: never-registered');
  });

  it('shows a not-a-workflow placeholder when the form has no `workflow` metadata', () => {
    const forms = TestBed.inject(FormRegistry);
    // Register a plain schema-mode form without workflow metadata.
    forms.register({
      name: 'plain',
      description: '',
      fieldsSchema: z.object({}),
      submit: async () => undefined,
    });
    const fixture = TestBed.createComponent(WorkflowRendererComponent);
    fixture.componentRef.setInput('formName', 'plain');
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('not a workflow');
  });

  it('shows a not-registered placeholder when the form name is unknown', () => {
    setup();
    const fixture = TestBed.createComponent(WorkflowRendererComponent);
    fixture.componentRef.setInput('formName', 'never-registered-workflow');
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('not registered');
  });

  it('completed state propagates onComplete failure to an inline error', async () => {
    const { forms } = setup();
    const onComplete = vi.fn().mockRejectedValue(new Error('downstream tool unavailable'));
    forms.register(
      agenticWorkflow({
        name: 'wf',
        steps: [{ id: 'only', widget: 'step-a', next: null }],
        onComplete,
      }) as FormDef,
    );
    const fixture = TestBed.createComponent(WorkflowRendererComponent);
    fixture.componentRef.setInput('formName', 'wf');
    fixture.detectChanges();

    const submitBtn = fixture.nativeElement.querySelector('button.primary') as HTMLButtonElement;
    submitBtn.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(onComplete).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('.completed')).toBeNull();
    expect(fixture.nativeElement.querySelector('.error')?.textContent).toContain(
      'downstream tool unavailable',
    );
  });
});
