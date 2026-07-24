import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { NAVIGATION_STUDIO, PROMPT_STUDIO } from './studio-configs';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'experiences' },
  {
    path: 'login',
    loadComponent: () => import('./pages/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'experiences',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/experiences.component').then((m) => m.ExperiencesComponent),
  },
  {
    path: 'experiences/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/experience-detail.component').then((m) => m.ExperienceDetailComponent),
  },
  {
    path: 'prompts',
    canActivate: [authGuard],
    data: { config: PROMPT_STUDIO },
    loadComponent: () => import('./pages/capability-studio.component').then((m) => m.CapabilityStudioComponent),
  },
  {
    path: 'navigation',
    canActivate: [authGuard],
    data: { config: NAVIGATION_STUDIO },
    loadComponent: () => import('./pages/capability-studio.component').then((m) => m.CapabilityStudioComponent),
  },
];
