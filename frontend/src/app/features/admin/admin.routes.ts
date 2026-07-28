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
        // Antes de 'productos/:id' no hace falta: la ruta es más específica.
        path: 'productos/:id/presentaciones',
        loadComponent: () =>
          import('./productos/producto-presentaciones').then((m) => m.ProductoPresentaciones),
      },
      {
        // El alta y la edición del producto son un modal sobre el listado; la
        // pantalla `productos/:id` ya no existe. Se conserva el redirect para
        // que un enlace o marcador viejo no caiga en el `**` (que va a login).
        path: 'productos/:id',
        redirectTo: 'productos',
      },
      {
        path: 'inventario',
        loadComponent: () => import('./inventario/inventario').then((m) => m.Inventario),
      },
      {
        path: 'remesas',
        loadComponent: () => import('./remesas/remesas').then((m) => m.Remesas),
      },
      {
        path: 'traspasos',
        loadComponent: () => import('./traspasos/traspasos').then((m) => m.Traspasos),
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
        path: 'almacenes',
        loadComponent: () => import('./almacenes/almacenes').then((m) => m.Almacenes),
      },
      {
        path: 'usuarios',
        loadComponent: () => import('./usuarios/usuarios').then((m) => m.Usuarios),
      },
      // La ruta específica va primero para que no la absorba 'nomina'.
      {
        path: 'nomina/configuracion',
        loadComponent: () => import('./nomina/nomina-config').then((m) => m.NominaConfig),
      },
      {
        path: 'nomina',
        loadComponent: () => import('./nomina/nomina').then((m) => m.Nomina),
      },
    ],
  },
];
