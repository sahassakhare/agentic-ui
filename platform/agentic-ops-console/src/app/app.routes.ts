import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./components/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', redirectTo: 'capabilities', pathMatch: 'full' },
      {
        path: 'capabilities',
        loadComponent: () => import('./pages/capabilities.component').then((m) => m.CapabilitiesComponent),
      },
      {
        path: 'mfes',
        loadComponent: () => import('./pages/mfes.component').then((m) => m.MfesComponent),
      },
      {
        path: 'role-mappings',
        loadComponent: () => import('./pages/role-mappings.component').then((m) => m.RoleMappingsComponent),
      },
      {
        path: 'audit',
        loadComponent: () => import('./pages/audit.component').then((m) => m.AuditComponent),
      },
      {
        path: 'usage',
        loadComponent: () => import('./pages/usage.component').then((m) => m.UsageComponent),
      },
      {
        path: 'activity',
        loadComponent: () => import('./pages/activity.component').then((m) => m.ActivityComponent),
      },
      {
        path: 'topology',
        loadComponent: () => import('./pages/topology.component').then((m) => m.TopologyComponent),
      },
      {
        path: 'tenants',
        loadComponent: () => import('./pages/tenants.component').then((m) => m.TenantsComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
