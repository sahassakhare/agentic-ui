import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./pages/matter-dashboard.component').then((m) => m.MatterDashboardComponent),
  },
  {
    path: 'documents',
    loadComponent: () => import('./pages/documents/documents.component').then((m) => m.DocumentsComponent),
  },
  {
    path: 'custodians',
    loadComponent: () => import('./pages/custodians/custodians.component').then((m) => m.CustodiansComponent),
  },
  {
    path: 'holds',
    loadComponent: () => import('./pages/holds/holds.component').then((m) => m.HoldsComponent),
  },
  {
    path: 'audit',
    loadComponent: () => import('./pages/audit/audit.component').then((m) => m.AuditComponent),
  },
  {
    path: 'productions',
    loadComponent: () => import('./pages/productions/productions.component').then((m) => m.ProductionsComponent),
  },
  {
    path: 'approvals',
    loadComponent: () => import('./pages/approvals/approvals.component').then((m) => m.ApprovalsComponent),
  },
  {
    path: 'operations',
    loadComponent: () => import('./pages/operations/operations.component').then((m) => m.OperationsComponent),
  },
  // ── Post-chat surfaces (P2 / P3 / P5) ─────────────────────────────────
  // Inbox, dashboards, and playbooks routes wrap the dispatch-agnostic
  // widgets shipped in the lib (mvk-inbox / mvk-dashboard-canvas /
  // mvk-playbook-runner). Each reads from a registry the shell registers
  // at boot via `registerPostChatSurfaces` in app.config.ts.
  {
    path: 'inbox',
    loadComponent: () => import('./pages/inbox/inbox.component').then((m) => m.InboxPage),
  },
  {
    path: 'dashboards',
    loadComponent: () => import('./pages/dashboards/dashboards.component').then((m) => m.DashboardsPage),
  },
  {
    path: 'playbooks',
    loadComponent: () => import('./pages/playbooks/playbooks.component').then((m) => m.PlaybooksPage),
  },
  // ── Post-chat surfaces P4 — Workflow surfaces ─────────────────────────
  // /review-queue (Workflow E), /timeline (Workflow D), /cal (Workflow C).
  // Each route wraps the corresponding lib component with seeded demo
  // data; production hosts would wire real tools / data sources.
  {
    path: 'review-queue',
    loadComponent: () => import('./pages/review-queue/review-queue.component').then((m) => m.ReviewQueuePage),
  },
  {
    path: 'timeline',
    loadComponent: () => import('./pages/timeline/timeline.component').then((m) => m.TimelinePage),
  },
  {
    path: 'cal',
    loadComponent: () => import('./pages/cal/cal.component').then((m) => m.CalPage),
  },
  // Use case §17 demo — slot-based workspace via <mvk-workspace-layout>
  // showing the lib's primitive alongside the hand-rolled three-pane.
  {
    path: 'workspace',
    loadComponent: () => import('./pages/workspace/workspace-demo.component').then((m) => m.WorkspaceDemoPage),
  },
  // ADR-046 PR3 D4 — chain-hashed LAYOUT_APPLIED audit trail viewer.
  // Reads from LayoutAuditTracker.chain() + offers a timestamp scrubber
  // for at-or-before-T snapshot inspection.
  {
    path: 'audit/layouts',
    loadComponent: () => import('./pages/audit-layouts/audit-layouts.component').then((m) => m.AuditLayoutsPage),
  },
  // Sprint 2 — admin template review queue (in-review / rejected /
  // drafts). Approve / Reject actions transition through the
  // approval state machine.
  {
    path: 'admin/templates',
    loadComponent: () => import('./pages/admin-templates/admin-templates.component').then((m) => m.AdminTemplatesPage),
  },
  // ── Trimodal direct-mount surfaces (plan R3) ──────────────────────────
  // Same registry definitions the chat agent invokes — without the chat
  // shell. Proves forms/workflows are surface-independent.
  {
    path: 'intake/custodian',
    loadComponent: () => import('./pages/intake/custodian-intake.page').then((m) => m.CustodianIntakePage),
  },
  {
    path: 'workflows/place-hold',
    loadComponent: () => import('./pages/workflows/place-hold.page').then((m) => m.PlaceHoldPage),
  },
  {
    path: 'workflows/place-hold-and-collect',
    loadComponent: () => import('./pages/workflows/place-hold-and-collect.page').then((m) => m.PlaceHoldAndCollectPage),
  },
  { path: '**', redirectTo: '' },
];
