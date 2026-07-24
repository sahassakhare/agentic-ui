import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'experiences' },
  {
    path: 'experiences',
    loadComponent: () => import('./pages/experiences.component').then((m) => m.ExperiencesComponent),
  },
  {
    path: 'experiences/:id',
    loadComponent: () => import('./pages/experience-detail.component').then((m) => m.ExperienceDetailComponent),
  },
];
