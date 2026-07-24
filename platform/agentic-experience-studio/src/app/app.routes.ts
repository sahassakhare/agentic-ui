import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

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
];
