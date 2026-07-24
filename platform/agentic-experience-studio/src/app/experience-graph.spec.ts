import { describe, expect, it } from 'vitest';
import { buildExperienceGraphElements, partitionGraph } from './experience-graph';
import type { Experience, ExperiencePlanResult } from './services/experience-catalog.service';

function experience(requires: Experience['body']['requires']): Experience {
  return {
    id: 'e1', tenantId: 't', name: 'legalIntake', title: 'Legal Intake', goal: 'Create Legal Matter',
    body: { requires }, approvalState: 'draft', approvalChain: [], owner: null, tags: [],
    version: null, createdAt: '', updatedAt: '', createdBy: 'u', softDeletedAt: null,
  };
}

describe('buildExperienceGraphElements', () => {
  it('emits a root node and dependency edges', () => {
    const els = buildExperienceGraphElements(experience([
      { kind: 'form', name: 'customerSearch' },
      { kind: 'tool', name: 'conflictCheck', reason: 'check conflicts' },
    ]));
    const { nodes, edges } = partitionGraph(els);

    expect(nodes.find((n) => n.state === 'root')?.id).toBe('experience:legalIntake');
    expect(nodes.map((n) => n.id).sort()).toEqual([
      'experience:legalIntake', 'form:customerSearch', 'tool:conflictCheck',
    ]);
    expect(edges).toHaveLength(2);
    expect(edges.find((e) => e.target === 'tool:conflictCheck')?.reason).toBe('check conflicts');
  });

  it('colours nodes matched vs unmet from a plan result', () => {
    const plan: ExperiencePlanResult = {
      experienceId: 'legalIntake', goal: 'g', approvalState: 'draft',
      matched: [{ kind: 'form', name: 'customerSearch' }],
      unmet: [{ kind: 'tool', name: 'conflictCheck' }],
      complete: false,
    };
    const els = buildExperienceGraphElements(
      experience([{ kind: 'form', name: 'customerSearch' }, { kind: 'tool', name: 'conflictCheck' }]),
      plan,
    );
    const { nodes } = partitionGraph(els);
    expect(nodes.find((n) => n.id === 'form:customerSearch')?.state).toBe('matched');
    expect(nodes.find((n) => n.id === 'tool:conflictCheck')?.state).toBe('unmet');
  });

  it('marks optional requirements on the edge', () => {
    const els = buildExperienceGraphElements(experience([{ kind: 'tool', name: 'aiSummary', optional: true }]));
    const { edges } = partitionGraph(els);
    expect(edges[0].optional).toBe(true);
  });

  it('renders tag late-binding requirements with a #tag label', () => {
    const els = buildExperienceGraphElements(experience([{ kind: 'component', tag: 'result-card' }]));
    const { nodes } = partitionGraph(els);
    expect(nodes.find((n) => n.kind === 'component')?.label).toBe('#result-card');
  });
});
