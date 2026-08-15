import { describe, expect, it } from 'vitest';
import { buildPublishedBundle, type BundleSources } from './bundle.js';
import type { Experience } from '../domain/experience.js';

function experience(overrides: Partial<Experience> = {}): Experience {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    tenantId: 'acme',
    name: 'support-ticket',
    title: 'Support Ticket',
    goal: 'open a support ticket',
    body: { defaultLayout: 'wizard', requires: [{ kind: 'workflow', name: 'support-flow' }] },
    approvalState: 'approved',
    approvalChain: [],
    owner: null,
    tags: [],
    version: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    createdBy: 'root',
    softDeletedAt: null,
    ...overrides,
  };
}

describe('buildPublishedBundle', () => {
  it('folds sources into a self-contained manifest', () => {
    const sources: BundleSources = {
      experience: experience(),
      workflow: {
        steps: [
          { id: 'category', widget: 'category-picker', section: 'Issue type', next: 'priority' },
          {
            id: 'priority',
            widget: 'priority-picker',
            next: { branches: [{ when: { field: 'priority', op: '==', value: 'high' }, goto: 'escalate' }], default: 'review' },
          },
          { id: 'review', widget: 'review-summary', next: null },
        ],
      },
      widgets: [
        { name: 'category-picker', kind: 'component' },
        { name: 'priority-picker', kind: 'component' },
        { name: 'review-summary', kind: 'component' },
      ],
    };

    const bundle = buildPublishedBundle(sources, 3, '2026-08-01T12:00:00.000Z');

    expect(bundle.experience).toEqual({ name: 'support-ticket', title: 'Support Ticket', goal: 'open a support ticket', defaultLayout: 'wizard' });
    expect(bundle.workflow?.steps).toHaveLength(3);
    expect(bundle.widgets.map((w) => w.name)).toEqual(['category-picker', 'priority-picker', 'review-summary']);
    expect(bundle.publishedVersionNo).toBe(3);
    expect(bundle.publishedAt).toBe('2026-08-01T12:00:00.000Z');
  });

  it('omits defaultLayout when absent and allows a null workflow', () => {
    const bundle = buildPublishedBundle(
      { experience: experience({ body: {} }), workflow: null, widgets: [] },
      1,
      '2026-08-01T00:00:00.000Z',
    );
    expect(bundle.experience).not.toHaveProperty('defaultLayout');
    expect(bundle.workflow).toBeNull();
  });
});
