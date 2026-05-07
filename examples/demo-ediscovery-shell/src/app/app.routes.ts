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
  { path: '**', redirectTo: '' },
];
