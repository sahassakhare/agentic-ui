import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { ExperiencePlanner } from './experience-planner';
import { ExperienceRegistry, type ExperienceDef } from './experience-registry';
import {
  ToolRegistry,
  ComponentRegistry,
  FormRegistry,
  DataSourceRegistry,
  PromptRegistry,
  SkillRegistry,
  WorkflowRegistry,
  MemoryRegistry,
} from '../registries';
import type {
  ComponentDef,
  DataSourceDef,
  FormDef,
  SkillDef,
  ToolDef,
  WorkflowCapabilityDef,
} from '../types/registry-defs';

const user = { id: 'u1', persona: 'lead-counsel' };

describe('ExperiencePlanner (AEP Seam D)', () => {
  let planner: ExperiencePlanner;
  let experiences: ExperienceRegistry;
  let tools: ToolRegistry;
  let components: ComponentRegistry;
  let forms: FormRegistry;
  let dataSources: DataSourceRegistry;
  let prompts: PromptRegistry;
  let skills: SkillRegistry;
  let workflows: WorkflowRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    planner = TestBed.inject(ExperiencePlanner);
    experiences = TestBed.inject(ExperienceRegistry);
    tools = TestBed.inject(ToolRegistry);
    components = TestBed.inject(ComponentRegistry);
    forms = TestBed.inject(FormRegistry);
    dataSources = TestBed.inject(DataSourceRegistry);
    prompts = TestBed.inject(PromptRegistry);
    skills = TestBed.inject(SkillRegistry);
    workflows = TestBed.inject(WorkflowRegistry);
  });

  /** Register minimal capabilities across registries (planner cares about name+kind). */
  function seedCapabilities(): void {
    tools.register({ name: 'conflictCheck' } as ToolDef);
    tools.register({ name: 'aiSummary' } as ToolDef);
    components.register({ name: 'approvalCard' } as ComponentDef);
    forms.register({ name: 'customerSearch' } as FormDef);
    dataSources.register({ name: 'customerEntity' } as DataSourceDef);
    prompts.register({ name: 'intakeGreeting', template: 'hi' });
    workflows.register({
      name: 'intakeFlow',
      workflow: { steps: [{ id: 's', widget: 'w', next: null }], onComplete: async () => undefined },
    } as WorkflowCapabilityDef);
  }

  function registerLegalIntake(extra: Partial<ExperienceDef> = {}): void {
    const exp: ExperienceDef = {
      name: 'legalIntake',
      title: 'Legal Intake',
      goal: 'Create Legal Matter',
      intents: ['create matter'],
      defaultLayout: 'legal-intake-layout',
      policies: ['maverick/legal/allow'],
      requires: [
        { kind: 'form', name: 'customerSearch', reason: 'pick a party' },
        { kind: 'tool', name: 'conflictCheck', reason: 'check conflicts' },
        { kind: 'component', name: 'approvalCard' },
        { kind: 'workflow', name: 'intakeFlow' },
        { kind: 'prompt', name: 'intakeGreeting' },
      ],
      approvalState: 'approved',
      ...extra,
    };
    experiences.register(exp);
  }

  it('returns null when no experience resolves', () => {
    expect(planner.plan({ experienceId: 'nope', user })).toBeNull();
  });

  it('produces a concrete bundle from the capability graph', () => {
    seedCapabilities();
    registerLegalIntake();

    const plan = planner.plan({ experienceId: 'legalIntake', user })!;
    expect(plan.access.allowed).toBe(true);
    expect(plan.goal).toBe('Create Legal Matter');
    expect(plan.layout).toBe('legal-intake-layout');
    expect(plan.forms).toEqual(['customerSearch']);
    expect(plan.tools).toContain('conflictCheck');
    expect(plan.components).toEqual(['approvalCard']);
    expect(plan.workflow).toBe('intakeFlow');
    expect(plan.prompts).toEqual(['intakeGreeting']);
    expect(plan.policies).toEqual(['maverick/legal/allow']);
    expect(plan.unmet).toEqual([]);
    // rationale includes the root goal + edge reasons
    expect(plan.rationale[0]).toMatchObject({ kind: 'experience' });
    expect(plan.rationale.some((r) => r.reason === 'check conflicts')).toBe(true);
  });

  it('surfaces unmet requirements instead of hiding them', () => {
    // Only register the form; conflictCheck tool is missing.
    forms.register({ name: 'customerSearch' } as FormDef);
    experiences.register({
      name: 'legalIntake', title: 'x', goal: 'g', approvalState: 'approved',
      requires: [
        { kind: 'form', name: 'customerSearch' },
        { kind: 'tool', name: 'conflictCheck' },
      ],
    });
    const plan = planner.plan({ experienceId: 'legalIntake', user })!;
    expect(plan.forms).toEqual(['customerSearch']);
    expect(plan.unmet.map((u) => u.requirement.name)).toEqual(['conflictCheck']);
  });

  it('expands skills into their bundled tools', () => {
    tools.register({ name: 'search' } as ToolDef);
    tools.register({ name: 'tag' } as ToolDef);
    skills.register({ name: 'reviewSkill', description: 'review', tools: ['search', 'tag'] } as SkillDef);
    experiences.register({
      name: 'review', title: 'Review', goal: 'review docs', approvalState: 'approved',
      requires: [{ kind: 'skill', name: 'reviewSkill' }],
    });

    const plan = planner.plan({ experienceId: 'review', user })!;
    expect(plan.skills).toEqual(['reviewSkill']);
    expect([...plan.tools].sort()).toEqual(['search', 'tag']);
  });

  it('denies an unapproved experience by default (auditable, no resolution)', () => {
    seedCapabilities();
    registerLegalIntake({ approvalState: 'draft' });

    const plan = planner.plan({ experienceId: 'legalIntake', user })!;
    expect(plan.access.allowed).toBe(false);
    expect(plan.access.reason).toMatch(/not approved/);
    expect(plan.tools).toEqual([]);
    expect(plan.rationale[0].reason).toMatch(/not approved/);
  });

  it('allows unapproved when explicitly opted in', () => {
    seedCapabilities();
    registerLegalIntake({ approvalState: 'draft' });
    const plan = planner.plan({ experienceId: 'legalIntake', user, allowUnapproved: true })!;
    expect(plan.access.allowed).toBe(true);
    expect(plan.forms).toEqual(['customerSearch']);
  });

  it('denies a persona outside the experience allow-list', () => {
    seedCapabilities();
    registerLegalIntake({ personas: ['paralegal'] });
    const plan = planner.plan({ experienceId: 'legalIntake', user })!; // user is lead-counsel
    expect(plan.access.allowed).toBe(false);
    expect(plan.access.reason).toMatch(/persona "lead-counsel" is not permitted/);
  });

  it('resolves an experience by intent phrase', () => {
    seedCapabilities();
    registerLegalIntake();
    const plan = planner.plan({ intent: 'create matter', user });
    expect(plan?.experienceId).toBe('legalIntake');
  });

  it('denies when the user lacks a required permission', () => {
    seedCapabilities();
    registerLegalIntake({ requiredPermissions: ['matter.create'] });
    const denied = planner.plan({ experienceId: 'legalIntake', user })!; // user has no permissions
    expect(denied.access.allowed).toBe(false);
    expect(denied.access.reason).toMatch(/missing permission\(s\): matter\.create/);

    const allowed = planner.plan({
      experienceId: 'legalIntake',
      user: { ...user, permissions: ['matter.create'] },
    })!;
    expect(allowed.access.allowed).toBe(true);
  });

  it('surfaces resolved memory providers in the plan', () => {
    const mem = TestBed.inject(MemoryRegistry);
    mem.register({ name: 'userPrefs', kind: 'long-term' });
    experiences.register({
      name: 'memExp', title: 'x', goal: 'g', approvalState: 'approved',
      requires: [{ kind: 'memory', name: 'userPrefs' }],
    });
    const plan = planner.plan({ experienceId: 'memExp', user })!;
    expect(plan.memory).toEqual(['userPrefs']);
  });

  it('a skill missing its tools array does not crash the plan', () => {
    // Raw-registered skill with no `tools` (bypassing the factory).
    skills.register({ name: 'brokenSkill', description: 'd' } as SkillDef);
    experiences.register({
      name: 'brokenExp', title: 'x', goal: 'g', approvalState: 'approved',
      requires: [{ kind: 'skill', name: 'brokenSkill' }],
    });
    const plan = planner.plan({ experienceId: 'brokenExp', user })!;
    expect(plan.skills).toEqual(['brokenSkill']);
    expect(plan.tools).toEqual([]);
  });
});
