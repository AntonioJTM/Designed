import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { staffGuard } from './core/guards/staff.guard';

/*
 * TIENDA EN LÍNEA APAGADA (2026-10, decisión del usuario: "el cliente por ahora
 * no la quiere"). Se COMENTA, no se borra: el código de `features/tienda` y del
 * registro sigue intacto. Para volver a abrirla:
 *   1. descomentar las dos rutas de abajo y regresar '' a 'tienda';
 *   2. descomentar en el backend registro/login/perfil de clientes
 *      (`backend/src/modules/clientes/routes.js`);
 *   3. regresar el reintento como cliente en `AuthService.login`.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  // {
  //   path: 'tienda',
  //   loadChildren: () => import('./features/tienda/tienda.routes').then((m) => m.TIENDA_ROUTES),
  // },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login').then((m) => m.Login),
  },
  // {
  //   path: 'registro',
  //   loadComponent: () => import('./features/auth/registro').then((m) => m.Registro),
  // },
  {
    path: 'admin',
    canActivate: [authGuard, staffGuard],
    loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },
  { path: '**', redirectTo: 'login' },
];
