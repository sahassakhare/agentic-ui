import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { Component } from '@angular/core';
import { ExperienceLayoutInput } from './experience-layout-input';
import { ExperiencePlanStore } from './experience-plan-store';
import { provideExperiencePlatform } from './provide-experience-platform';
import { LayoutTemplateRegistry } from '../layout/templates/layout-template-registry';
import { LayoutResolver } from '../layout/resolver/layout-resolver';
import { LAYOUT_INPUT } from '../layout/resolver/types';
import type { LayoutTemplate } from '../layout/templates/types';
import type { ExperiencePlan } from './experience-planner';

@Component({ selector: 'aes-noop', template: '' })
class NoopLayout {}

function template(name: string, slotMap: Record<string, { component: string }>): LayoutTemplate {
  return {
    name,
    title: name,
    description: '',
    approvalState: 'approved',
    approvalChain: [],
    author: { userId: 'u', tenantId: 't' },
    visibility: 'tenant',
    tags: [],
    body: { name, description: '', slots: Object.keys(slotMap), component: NoopLayout, slotMap },
  };
}

function plan(overrides: Partial<ExperiencePlan> = {}): ExperiencePlan {
  return {
    experienceId: 'legalIntake', goal: 'g', access: { allowed: true }, layout: 'legal-layout',
    components: [], forms: [], tools: [], dataSources: [], prompts: [], knowledge: [], skills: [],
    policies: [], unmet: [], rationale: [], ...overrides,
  };
}

describe('ExperienceLayoutInput (Seam D → LayoutResolver)', () => {
  let store: ExperiencePlanStore;
  let templates: LayoutTemplateRegistry;
  let input: ExperienceLayoutInput;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(ExperiencePlanStore);
    templates = TestBed.inject(LayoutTemplateRegistry);
    input = TestBed.inject(ExperienceLayoutInput);
  });

  it('contributes nothing when no plan is active', () => {
    expect(input.evaluate()).toEqual([]);
  });

  it('contributes nothing when the plan names no layout', () => {
    store.set(plan({ layout: undefined }));
    expect(input.evaluate()).toEqual([]);
  });

  it('contributes nothing when the template is missing or unapproved', () => {
    store.set(plan());
    expect(input.evaluate()).toEqual([]); // template not registered

    const draft = { ...template('legal-layout', { primary: { component: 'x' } }), approvalState: 'draft' as const };
    templates.register(draft);
    expect(input.evaluate()).toEqual([]); // registered but not approved
  });

  it('emits a rule from an approved template at the experience source', () => {
    templates.register(template('legal-layout', { primary: { component: 'intakeForm' }, sidebar: { component: 'conflictPanel' } }));
    store.set(plan());

    const rules = input.evaluate();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe('experience');
    expect(Object.keys(rules[0].slots)).toEqual(['primary', 'sidebar']);
    expect(rules[0].id).toBe('experience:legalIntake');
  });
});

describe('provideExperiencePlatform → LayoutResolver end to end', () => {
  it('the experience plan seeds resolved layout slots', () => {
    TestBed.configureTestingModule({ providers: [provideExperiencePlatform()] });
    const store = TestBed.inject(ExperiencePlanStore);
    const templates = TestBed.inject(LayoutTemplateRegistry);
    const resolver = TestBed.inject(LayoutResolver);

    templates.register(template('legal-layout', { primary: { component: 'intakeForm' } }));
    store.set(plan());

    const resolved = resolver.active();
    expect(resolved.slots['primary']).toEqual({ component: 'intakeForm' });
    expect(resolved.appliedRules.find((r) => r.slotName === 'primary')?.source).toBe('experience');
  });

  it('registers the input against LAYOUT_INPUT', () => {
    TestBed.configureTestingModule({ providers: [provideExperiencePlatform()] });
    const inputs = TestBed.inject(LAYOUT_INPUT);
    expect(inputs.some((i) => i.id === 'experience-plan' && i.source === 'experience')).toBe(true);
  });
});
