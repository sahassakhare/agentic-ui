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
