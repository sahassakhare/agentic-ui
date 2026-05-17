import { Component, type EnvironmentInjector } from '@angular/core';
import {
  DashboardTemplateRegistry,
  LayoutTemplateRegistry,
  type DashboardTemplate,
  type LayoutTemplate,
} from '@infra-tools/agentic-ui';

@Component({ selector: 'app-layout-template-placeholder', template: '' })
class LayoutTemplatePlaceholder {}

/**
 * ADR-046 PR4 — seed a representative set of layout + dashboard
 * templates with varied approval states so the catalog UI has
 * content + the approval workflow has visible inputs/outputs.
 *
 * Templates live in-memory for the demo; production wiring would
 * persist them through `LayeredLayoutStore` so org/matter/tenant
 * admins can publish across sessions.
 */
export function registerLayoutTemplates(env: EnvironmentInjector): void {
  const layoutRegistry = env.get(LayoutTemplateRegistry);
  const dashboardRegistry = env.get(DashboardTemplateRegistry);

  for (const t of seedLayoutTemplates()) layoutRegistry.register(t);
  for (const t of seedDashboardTemplates()) dashboardRegistry.register(t);
}

function seedLayoutTemplates(): readonly LayoutTemplate[] {
  return [
    {
      name: 'privilege-review-v3',
      title: 'Privilege review (v3)',
      description:
        'Three-pane workspace: document preview (primary), privilege panel (sidebar), ' +
        'chain-of-custody (footer). Tuned for the standard Q1 privilege pass.',
      approvalState: 'approved',
      approvalChain: [
        sampleEvent('submit', 'draft', 'review', { userId: 'paralegal-1', displayName: 'Sarah Chen' }, '2026-05-10T14:00:00Z'),
        sampleEvent('approve', 'review', 'approved', { userId: 'lead-counsel-1', displayName: 'Marcus Webb' }, '2026-05-11T09:30:00Z', 'standard shape for Q1 privilege passes'),
      ],
      author: { userId: 'paralegal-1', tenantId: 't1' },
      visibility: 'tenant',
      tags: ['privilege', 'review', 'three-pane'],
      version: 'v3',
      parentVersion: 'v2',
      schemaVersion: 1,
      body: {
        name: 'privilege-review-v3',
        description: 'three-pane privilege review',
        slots: ['primary', 'sidebar', 'footer'],
        component: LayoutTemplatePlaceholder,
      },
    },
    {
      name: 'production-export-prep',
      title: 'Production export prep',
      description:
        'Wide canvas optimised for Bates stamping + redaction QA. Primary spans 80%; ' +
        'sidebar shows the production set summary.',
      approvalState: 'review',
      approvalChain: [
        sampleEvent('submit', 'draft', 'review', { userId: 'lit-support-1', displayName: 'Jamie Reyes' }, '2026-05-14T11:00:00Z', 'pending lead-counsel sign-off'),
      ],
      author: { userId: 'lit-support-1', tenantId: 't1' },
      visibility: 'matter',
      tags: ['production', 'redaction', 'bates'],
      version: 'v1',
      schemaVersion: 1,
      body: {
        name: 'production-export-prep',
        description: 'wide canvas for Bates + redaction QA',
        slots: ['primary', 'sidebar'],
        component: LayoutTemplatePlaceholder,
      },
    },
    {
      name: 'cal-loop-workbench',
      title: 'CAL loop workbench',
      description:
        'TAR continuous-active-learning workbench layout — primary holds the document, ' +
        'sidebar holds the relevance prediction, footer holds the chain-of-custody banner.',
      approvalState: 'draft',
      approvalChain: [],
      author: { userId: 'paralegal-2', tenantId: 't1' },
      visibility: 'private',
      tags: ['tar', 'cal', 'review'],
      version: 'v1',
      schemaVersion: 1,
      body: {
        name: 'cal-loop-workbench',
        description: 'continuous-active-learning workbench',
        slots: ['primary', 'sidebar', 'footer'],
        component: LayoutTemplatePlaceholder,
      },
    },
  ];
}

function seedDashboardTemplates(): readonly DashboardTemplate[] {
  return [
    {
      name: 'matter-health-snapshot',
      title: 'Matter health snapshot',
      description:
        'Top-line KPIs for matter status: open holds, pending acknowledgements, ' +
        'documents reviewed, productions issued. Org-approved baseline.',
      approvalState: 'approved',
      approvalChain: [
        sampleEvent('submit', 'draft', 'review', { userId: 'paralegal-1', displayName: 'Sarah Chen' }, '2026-04-20T10:00:00Z'),
        sampleEvent('approve', 'review', 'approved', { userId: 'lead-counsel-1', displayName: 'Marcus Webb' }, '2026-04-22T15:00:00Z'),
      ],
      author: { userId: 'paralegal-1', tenantId: 't1' },
      visibility: 'tenant',
      tags: ['matter-health', 'kpi', 'overview'],
      version: 'v2',
      parentVersion: 'v1',
      schemaVersion: 1,
      body: {
        name: 'matter-health-snapshot',
        title: 'Matter health snapshot',
        description: 'baseline kpi rollup',
        layout: 'rail',
        version: 'v2',
        tiles: [
          {
            id: 'pending-holds',
            slot: 'primary',
            title: 'Pending hold acknowledgements',
            component: 'kpiTile',
            invocation: { kind: 'tool', tool: 'listLegalHolds', args: { status: 'pending' } },
            refreshOn: 'load',
            drilldown: { route: '/holds' },
          },
        ],
      },
    },
    {
      name: 'production-throughput-weekly',
      title: 'Production throughput (weekly)',
      description: 'Bates-range issuance over the last 8 weeks. Matter-lead reviewed.',
      approvalState: 'approved',
      approvalChain: [
        sampleEvent('submit', 'draft', 'review', { userId: 'lit-support-1' }, '2026-05-01T08:00:00Z'),
        sampleEvent('approve', 'review', 'approved', { userId: 'lead-counsel-1' }, '2026-05-02T14:00:00Z'),
      ],
      author: { userId: 'lit-support-1', tenantId: 't1' },
      visibility: 'matter',
      tags: ['production', 'throughput'],
      version: 'v1',
      schemaVersion: 1,
      body: {
        name: 'production-throughput-weekly',
        title: 'Production throughput (weekly)',
        description: 'rolling 8-week Bates issuance',
        layout: 'rail',
        version: 'v1',
        tiles: [
          {
            id: 'bates-issued',
            slot: 'primary',
            title: 'Bates ranges issued',
            component: 'kpiTile',
            invocation: { kind: 'static', props: { markdown: '8-week rolling throughput' } },
            refreshOn: 'load',
          },
        ],
      },
    },
    {
      name: 'tar-precision-tracker',
      title: 'TAR precision tracker',
      description: 'Daily precision/recall for the active continuous-active-learning model.',
      approvalState: 'rejected',
      approvalChain: [
        sampleEvent('submit', 'draft', 'review', { userId: 'paralegal-2' }, '2026-05-12T10:00:00Z'),
        sampleEvent('reject', 'review', 'rejected', { userId: 'lead-counsel-1' }, '2026-05-13T16:00:00Z', 'needs recall component too; please resubmit with both axes'),
      ],
      author: { userId: 'paralegal-2', tenantId: 't1' },
      visibility: 'tenant',
      tags: ['tar', 'cal', 'metrics'],
      version: 'v1',
      schemaVersion: 1,
      body: {
        name: 'tar-precision-tracker',
        title: 'TAR precision tracker',
        description: 'daily precision over CAL model',
        layout: 'rail',
        tiles: [],
      },
    },
  ];
}

function sampleEvent(
  action: 'submit' | 'approve' | 'reject' | 'deprecate' | 'revoke',
  fromState: 'draft' | 'review' | 'approved' | 'rejected' | 'deprecated',
  toState: 'draft' | 'review' | 'approved' | 'rejected' | 'deprecated',
  actor: { userId: string; displayName?: string },
  timestamp: string,
  comment?: string,
) {
  return {
    id: `approval-seed-${action}-${actor.userId}-${timestamp}`,
    timestamp,
    actor,
    action,
    fromState,
    toState,
    comment,
  };
}
