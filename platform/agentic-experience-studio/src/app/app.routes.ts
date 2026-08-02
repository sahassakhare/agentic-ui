import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import {
  COMPONENT_STUDIO,
  FORM_STUDIO,
  KNOWLEDGE_STUDIO,
  MEMORY_STUDIO,
  NAVIGATION_STUDIO,
  PROMPT_STUDIO,
  SKILL_STUDIO,
  TOOL_STUDIO,
} from './studio-configs';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'experiences' },
  {
    path: 'login',
    loadComponent: () => import('./pages/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'callback',
    loadComponent: () => import('./pages/callback.component').then((m) => m.CallbackComponent),
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
  {
    path: 'skills',
    canActivate: [authGuard],
    data: { config: SKILL_STUDIO },
    loadComponent: () => import('./pages/capability-studio.component').then((m) => m.CapabilityStudioComponent),
  },
  {
    path: 'knowledge',
    canActivate: [authGuard],
    data: { config: KNOWLEDGE_STUDIO },
    loadComponent: () => import('./pages/capability-studio.component').then((m) => m.CapabilityStudioComponent),
  },
  {
    path: 'memory',
    canActivate: [authGuard],
    data: { config: MEMORY_STUDIO },
    loadComponent: () => import('./pages/capability-studio.component').then((m) => m.CapabilityStudioComponent),
  },
  {
    path: 'workflows',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/workflow.component').then((m) => m.WorkflowComponent),
  },
  {
    path: 'components',
    canActivate: [authGuard],
    data: { config: COMPONENT_STUDIO },
    loadComponent: () => import('./pages/capability-studio.component').then((m) => m.CapabilityStudioComponent),
  },
  {
    path: 'forms',
    canActivate: [authGuard],
    data: { config: FORM_STUDIO },
    loadComponent: () => import('./pages/capability-studio.component').then((m) => m.CapabilityStudioComponent),
  },
  {
    path: 'tools',
    canActivate: [authGuard],
    data: { config: TOOL_STUDIO },
    loadComponent: () => import('./pages/capability-studio.component').then((m) => m.CapabilityStudioComponent),
  },
  {
    path: 'policy',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/policy.component').then((m) => m.PolicyComponent),
  },
];
