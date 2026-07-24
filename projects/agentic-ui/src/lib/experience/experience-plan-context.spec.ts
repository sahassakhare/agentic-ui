import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { ExperiencePlanStore } from './experience-plan-store';
import { ExperiencePlanContextContributor } from './experience-plan-context-contributor';
import { provideExperiencePlatform } from './provide-experience-platform';
import { AgentContextProvider } from '../layout/agent-context/agent-context-provider';
import type { ExperiencePlan } from './experience-planner';

function plan(overrides: Partial<ExperiencePlan> = {}): ExperiencePlan {
  return {
    experienceId: 'legalIntake',
    goal: 'Create Legal Matter',
    access: { allowed: true },
    layout: 'legal-intake-layout',
    components: ['approvalCard'],
    forms: ['customerSearch'],
    tools: ['conflictCheck', 'aiSummary'],
    dataSources: [],
    prompts: ['intakeGreeting'],
    knowledge: [],
    memory: [],
    skills: [],
    workflow: 'intakeFlow',
    policies: ['maverick/legal/allow'],
    unmet: [],
    rationale: [],
    ...overrides,
  };
}

describe('ExperiencePlanContextContributor (Seam D → agent context)', () => {
  let store: ExperiencePlanStore;
  let contributor: ExperiencePlanContextContributor;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(ExperiencePlanStore);
    contributor = TestBed.inject(ExperiencePlanContextContributor);
  });

  it('returns null when no plan is active', () => {
    expect(contributor.contribute()).toBeNull();
  });

  it('returns null when the active plan was denied', () => {
    store.set(plan({ access: { allowed: false, reason: 'nope' }, tools: [] }));
    expect(contributor.contribute()).toBeNull();
  });

  it('emits a structured experience-plan fragment for an allowed plan', () => {
    store.set(plan());
    const fragment = contributor.contribute()!;
    expect(fragment.tag).toBe('experience-plan');
    expect(fragment.attrs).toMatchObject({ id: 'legalIntake', goal: 'Create Legal Matter', layout: 'legal-intake-layout' });
    const children = fragment.content as { tag: string; content: string }[];
    const tools = children.find((c) => c.tag === 'tools');
    expect(tools?.content).toBe('conflictCheck, aiSummary');
    expect(children.find((c) => c.tag === 'workflow')?.content).toBe('intakeFlow');
  });

  it('renders unmet requirements with a count attribute', () => {
    store.set(plan({ unmet: [{ from: 'experience:legalIntake', requirement: { kind: 'tool', name: 'conflictCheck' } }] }));
    const fragment = contributor.contribute()!;
    const children = fragment.content as { tag: string; attrs?: Record<string, unknown>; content: string }[];
    const unmet = children.find((c) => c.tag === 'unmet');
    expect(unmet?.attrs).toMatchObject({ count: 1 });
    expect(unmet?.content).toBe('tool:conflictCheck');
  });

  it('is wired into the AgentContextProvider XML block via provideExperiencePlatform()', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideExperiencePlatform()] });
    const s = TestBed.inject(ExperiencePlanStore);
    const provider = TestBed.inject(AgentContextProvider);
    s.set(plan());

    const xml = provider.compose();
    expect(xml).toContain('<experience-plan');
    expect(xml).toContain('id="legalIntake"');
    expect(xml).toContain('conflictCheck, aiSummary');
  });
});
