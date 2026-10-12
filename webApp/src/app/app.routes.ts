import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login.component').then((m) => m.LoginComponent)
  },
  {
    path: 'restablecer-contrasena',
    loadComponent: () =>
      import('./features/reset-password/reset-password.component').then((m) => m.ResetPasswordComponent)
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent)
  },
  {
    path: 'cuenta',
    canActivate: [authGuard],
    loadComponent: () => import('./features/account/account.component').then((m) => m.AccountComponent)
  },
  {
    path: 'ayuda',
    canActivate: [authGuard],
    loadComponent: () => import('./features/help/help.component').then((m) => m.HelpComponent)
  },
  {
    path: 'roster',
    canActivate: [authGuard],
    loadComponent: () => import('./features/roster/roster.component').then((m) => m.RosterComponent)
  },
  {
    path: 'tdp',
    canActivate: [authGuard],
    loadComponent: () => import('./features/tdp/tdp.component').then((m) => m.TdpComponent)
  },
  {
    path: 'captura',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/weekly-capture/weekly-capture.component').then((m) => m.WeeklyCaptureComponent)
  },
  {
    path: 'equipos',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/team-balancer/team-balancer.component').then((m) => m.TeamBalancerComponent)
  },
  {
    path: 'convocatoria',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./features/convocatoria/convocatoria.component').then((m) => m.ConvocatoriaComponent)
  },
  {
    path: 'ajustes',
    canActivate: [adminGuard],
    loadComponent: () => import('./features/settings/settings.component').then((m) => m.SettingsComponent)
  },
  {
    path: 'usuarios',
    canActivate: [adminGuard],
    loadComponent: () => import('./features/admin-users/admin-users.component').then((m) => m.AdminUsersComponent)
  },
  { path: '**', redirectTo: '' }
];
