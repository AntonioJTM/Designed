import { Routes } from '@angular/router';
import { TiendaLayout } from './tienda-layout';

export const TIENDA_ROUTES: Routes = [
  {
    path: '',
    component: TiendaLayout,
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./catalogo').then((m) => m.Catalogo) },
      {
        path: 'producto/:id',
        loadComponent: () => import('./producto-detalle').then((m) => m.ProductoDetalleTienda),
      },
      { path: 'carrito', loadComponent: () => import('./carrito').then((m) => m.Carrito) },
      { path: 'checkout', loadComponent: () => import('./checkout').then((m) => m.Checkout) },
      { path: 'mis-pedidos', loadComponent: () => import('./mis-pedidos').then((m) => m.MisPedidos) },
    ],
  },
];
