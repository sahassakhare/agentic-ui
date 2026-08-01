import { describe, expect, it } from 'vitest';
import { buildWorkflowGraphElements, stepsToWorkflowBody, type WorkflowStepDraft } from './workflow-graph';
import { partitionGraph } from './experience-graph';

const steps: WorkflowStepDraft[] = [
  { id: 's1', widget: 'intakeForm', next: 's2' },
  { id: 's2', widget: 'reviewCard', section: 'Review', next: '' },
];

describe('buildWorkflowGraphElements', () => {
  it('renders steps as nodes and next as edges', () => {
    const { nodes, edges } = partitionGraph(buildWorkflowGraphElements(steps));
    expect(nodes.map((n) => n.id)).toEqual(['s1', 's2']);
    expect(nodes.find((n) => n.id === 's1')?.state).toBe('root');
    expect(nodes.find((n) => n.id === 's2')?.state).toBe('matched'); // terminal
    expect(edges).toEqual([{ id: 's1->s2', source: 's1', target: 's2', optional: false }]);
  });

  it('flags a next pointing at an unknown step', () => {
    const { nodes } = partitionGraph(buildWorkflowGraphElements([{ id: 's1', widget: 'w', next: 'ghost' }]));
    expect(nodes.find((n) => n.id === 'ghost')?.label).toBe('ghost (?)');
  });

  it('ignores rows without an id', () => {
    const { nodes } = partitionGraph(buildWorkflowGraphElements([{ id: '', widget: 'w', next: '' }]));
    expect(nodes).toEqual([]);
  });
});

describe('stepsToWorkflowBody', () => {
  it('serializes complete steps, terminal next → null', () => {
    expect(stepsToWorkflowBody(steps)).toEqual({
      workflow: {
        steps: [
          { id: 's1', widget: 'intakeForm', next: 's2' },
          { id: 's2', widget: 'reviewCard', section: 'Review', next: null },
        ],
      },
    });
  });

  it('drops incomplete steps (missing id or widget)', () => {
    const body = stepsToWorkflowBody([{ id: 's1', widget: '', next: '' }, { id: '', widget: 'w', next: '' }]);
    expect((body['workflow'] as { steps: unknown[] }).steps).toEqual([]);
  });

  it('encodes a conditional step as a ConditionalNext (gap B3)', () => {
    const body = stepsToWorkflowBody([{
      id: 'priority', widget: 'priority-picker', next: 'review',
      conditional: true,
      branches: [
        { field: 'priority', op: '==', value: 'high', goto: 'escalation' },
        { field: 'category', op: 'in', value: 'fraud, legal', goto: 'compliance' },
      ],
      defaultNext: 'review',
    }]);
    const step = (body['workflow'] as { steps: Array<{ next: unknown }> }).steps[0];
    expect(step.next).toEqual({
      branches: [
        { when: { field: 'priority', op: '==', value: 'high' }, goto: 'escalation' },
        { when: { field: 'category', op: 'in', value: ['fraud', 'legal'] }, goto: 'compliance' },
      ],
      default: 'review',
    });
  });
});
