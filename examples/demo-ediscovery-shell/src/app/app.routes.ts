import { Routes } from '@angular/router';
import { MatterDashboardComponent } from './pages/matter-dashboard.component';

export const routes: Routes = [
  { path: '', component: MatterDashboardComponent, pathMatch: 'full' },
];
