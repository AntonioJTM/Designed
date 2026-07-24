import { Routes } from '@angular/router';
import { AdminLayout } from './admin-layout';

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    component: AdminLayout,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'productos' },
      {
        path: 'categorias',
        loadComponent: () => import('./categorias/categorias').then((m) => m.Categorias),
      },
      {
        path: 'productos',
        loadComponent: () => import('./productos/productos-list').then((m) => m.ProductosList),
      },
      {
        path: 'productos/:id',
        loadComponent: () => import('./productos/producto-form').then((m) => m.ProductoForm),
      },
      {
        path: 'inventario',
        loadComponent: () => import('./inventario/inventario').then((m) => m.Inventario),
      },
      {
        path: 'kardex',
        loadComponent: () => import('./inventario/kardex').then((m) => m.Kardex),
      },
      {
        path: 'pos',
        loadComponent: () => import('./pos/pos').then((m) => m.Pos),
      },
      {
        path: 'pedidos',
        loadComponent: () => import('./pedidos/pedidos-list').then((m) => m.PedidosList),
      },
      {
        path: 'pedidos/:id',
        loadComponent: () => import('./pedidos/pedido-detalle').then((m) => m.PedidoDetalle),
      },
      {
        path: 'reportes',
        loadComponent: () => import('./reportes/reportes').then((m) => m.Reportes),
      },
      {
        path: 'usuarios',
        loadComponent: () => import('./usuarios/usuarios').then((m) => m.Usuarios),
      },
    ],
  },
];
