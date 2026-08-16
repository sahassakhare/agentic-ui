import { describe, expect, it, vi } from 'vitest';

import { AgenticWorkflowError, agenticWorkflow } from './agentic-workflow';

describe('agenticWorkflow — factory + registration-time validation (Capability F3)', () => {
  it('returns a FormDef with workflow metadata and a passthrough fieldsSchema', () => {
    const onComplete = vi.fn();
    const def = agenticWorkflow({
      name: 'placeLegalHold',
      description: 'Guided wizard',
      steps: [
        { id: 'scope', widget: 'a', next: 'preview' },
        { id: 'preview', widget: 'b', next: null },
      ],
      onComplete,
    });
    expect(def.name).toBe('placeLegalHold');
    expect(def.description).toBe('Guided wizard');
    expect(def.workflow).toBeDefined();
    expect(def.workflow!.steps).toHaveLength(2);
    expect(def.workflow!.onComplete).toBe(onComplete);
    expect(def.fieldsSchema).toBeDefined();
  });

  it('rejects empty steps array', () => {
    expect(() =>
      agenticWorkflow({ name: 'empty', steps: [], onComplete: async () => undefined }),
    ).toThrow(/at least one step/);
  });

  it('rejects duplicate step ids', () => {
    expect(() =>
      agenticWorkflow({
        name: 'dup',
        steps: [
          { id: 'scope', widget: 'a', next: 'scope' },
          { id: 'scope', widget: 'b', next: null },
        ],
        onComplete: async () => undefined,
      }),
    ).toThrow(/Duplicate step id/);
  });

  it('rejects string `next` referencing an unknown step', () => {
    expect(() =>
      agenticWorkflow({
        name: 'bad-next',
        steps: [
          { id: 'a', widget: 'wA', next: 'nonexistent' },
          { id: 'b', widget: 'wB', next: null },
        ],
        onComplete: async () => undefined,
      }),
    ).toThrow(/unknown step "nonexistent"/);
  });

  it('accepts function `next` (dynamic targets validated at transition time)', () => {
    expect(() =>
      agenticWorkflow({
        name: 'fn-next',
        steps: [
          { id: 'a', widget: 'wA', next: (_state) => 'b' },
          { id: 'b', widget: 'wB', next: null },
        ],
        onComplete: async () => undefined,
      }),
    ).not.toThrow();
  });

  it('rejects bad widget identifier', () => {
    expect(() =>
      agenticWorkflow({
        name: 'bad-widget',
        steps: [{ id: 'a', widget: '../etc/passwd', next: null }],
        onComplete: async () => undefined,
      }),
    ).toThrow(AgenticWorkflowError);
  });

  it('rejects non-identifier step id', () => {
    expect(() =>
      agenticWorkflow({
        name: 'bad-id',
        steps: [{ id: 'oh hello', widget: 'a', next: null }],
        onComplete: async () => undefined,
      }),
    ).toThrow(/not a valid identifier/);
  });

  it('error message includes workflow name + step id', () => {
    let caught: AgenticWorkflowError | undefined;
    try {
      agenticWorkflow({
        name: 'workflowX',
        steps: [
          { id: 'first', widget: 'wA', next: null },
          { id: 'first', widget: 'wB', next: null },
        ],
        onComplete: async () => undefined,
      });
    } catch (e) {
      caught = e as AgenticWorkflowError;
    }
    expect(caught).toBeInstanceOf(AgenticWorkflowError);
    expect(caught!.workflowName).toBe('workflowX');
    expect(caught!.stepId).toBe('first');
    expect(caught!.message).toContain('[workflowX]');
    expect(caught!.message).toContain("step 'first'");
  });

  it('accepts a ConditionalNext (declarative branching) step', () => {
    const def = agenticWorkflow({
      name: 'branchy',
      steps: [
        {
          id: 'triage',
          widget: 'triageForm',
          next: {
            branches: [
              { when: { field: 'priority', op: '==', value: 'high' }, goto: 'escalate' },
              { when: { field: 'ok', op: 'truthy' }, goto: 'done' },
            ],
            default: 'done',
          },
        },
        { id: 'escalate', widget: 'escalateForm', next: 'done' },
        { id: 'done', widget: 'summary', next: null },
      ],
      onComplete: vi.fn(),
    });
    expect(def.workflow!.steps[0].next).toMatchObject({ default: 'done' });
  });

  it('rejects a branch goto that references an unknown step', () => {
    expect(() =>
      agenticWorkflow({
        name: 'badgoto',
        steps: [
          { id: 'a', widget: 'wA', next: { branches: [{ when: { field: 'x', op: 'truthy' }, goto: 'ghost' }], default: null } },
          { id: 'b', widget: 'wB', next: null },
        ],
        onComplete: vi.fn(),
      }),
    ).toThrow(/Branch `goto` references unknown step/);
  });

  it('rejects a branch default that references an unknown step', () => {
    expect(() =>
      agenticWorkflow({
        name: 'baddefault',
        steps: [
          { id: 'a', widget: 'wA', next: { branches: [{ when: { field: 'x', op: 'truthy' }, goto: 'b' }], default: 'ghost' } },
          { id: 'b', widget: 'wB', next: null },
        ],
        onComplete: vi.fn(),
      }),
    ).toThrow(/Branch `default` references unknown step/);
  });
});
