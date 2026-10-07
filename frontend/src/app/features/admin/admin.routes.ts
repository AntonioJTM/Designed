import { Routes } from '@angular/router';
import { AdminLayout } from './admin-layout';
import { inicioGuard, permisoGuard } from '../../core/guards/permiso.guard';

/**
 * Cada pantalla dice qué permiso pide (`data.permiso`, el mismo de
 * `core/navegacion.ts`): sin él, ni aparece en el menú ni se abre escribiendo la
 * dirección. `null` = todo el personal; 'admin' = solo el administrador.
 */
const p = (permiso: string | null) => ({ canActivate: [permisoGuard], data: { permiso } });

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    component: AdminLayout,
    children: [
      // Cada quien entra a lo suyo: Hoy, o el punto de venta si es cajero.
      { path: '', pathMatch: 'full', canActivate: [inicioGuard], children: [] },

      { path: 'asistente', ...p(null), loadComponent: () => import('./asistente/asistente').then((m) => m.Asistente) },
      { path: 'hoy', ...p('ver:hoy'), loadComponent: () => import('./hoy/hoy').then((m) => m.Hoy) },

      // ---- Vender
      { path: 'pos', ...p('ver:pos'), loadComponent: () => import('./pos/pos').then((m) => m.Pos) },
      { path: 'caja', ...p('ver:caja'), loadComponent: () => import('./caja/caja').then((m) => m.CajaPantalla) },
      // Las VENTAS (antes "Pedidos"). Los enlaces viejos a una venta
      // (/admin/pedidos/123) llevan a su nuevo lugar.
      { path: 'ventas', ...p('ver:pedidos'), loadComponent: () => import('./pedidos/pedidos-list').then((m) => m.PedidosList) },
      { path: 'ventas/:id', ...p('ver:pedidos'), loadComponent: () => import('./pedidos/pedido-detalle').then((m) => m.PedidoDetalle) },
      { path: 'pedidos/:id', redirectTo: 'ventas/:id' },
      // Los PEDIDOS de clientes (encargos): por preparar, listos, en camino.
      { path: 'pedidos', ...p('ver:encargos'), loadComponent: () => import('./encargos/encargos').then((m) => m.EncargosPantalla) },
      { path: 'apartados', ...p('ver:apartados'), loadComponent: () => import('./apartados/apartados').then((m) => m.ApartadosPantalla) },

      // ---- Clientes: seis pestañas (rutas literales, ANTES de ':id' para que
      // "deuda" no se tome por el id de un cliente) y el expediente.
      { path: 'clientes', pathMatch: 'full', redirectTo: 'clientes/frecuencia' },
      ...['frecuencia', 'dejaron', 'deuda', 'que-compra', 'cuando', 'gasto'].map((vista) => ({
        path: 'clientes/' + vista,
        canActivate: [permisoGuard],
        data: { permiso: 'ver:clientes', vista },
        loadComponent: () => import('./clientes/clientes').then((m) => m.ClientesPantalla),
      })),
      { path: 'clientes/:id', ...p('ver:clientes'), loadComponent: () => import('./clientes/cliente-expediente').then((m) => m.ClienteExpediente) },

      // ---- Mercancía
      { path: 'inventario', ...p('ver:inventario'), loadComponent: () => import('./inventario/inventario').then((m) => m.Inventario) },
      { path: 'remesas', ...p('ver:remesa'), loadComponent: () => import('./remesas/remesas').then((m) => m.Remesas) },
      { path: 'traspasos', ...p('ver:surtir'), loadComponent: () => import('./traspasos/traspasos').then((m) => m.Traspasos) },
      { path: 'kardex', ...p('ver:kardex'), loadComponent: () => import('./inventario/kardex').then((m) => m.Kardex) },

      // ---- Catálogo
      { path: 'productos', ...p('ver:catalogo'), loadComponent: () => import('./productos/productos-list').then((m) => m.ProductosList) },
      {
        path: 'productos/:id/presentaciones',
        ...p('ver:catalogo'),
        loadComponent: () => import('./productos/producto-presentaciones').then((m) => m.ProductoPresentaciones),
      },
      // El alta y la edición son un modal sobre el listado; `productos/:id` ya
      // no existe. Se conserva el redirect para un enlace o marcador viejo.
      { path: 'productos/:id', redirectTo: 'productos' },
      { path: 'categorias', ...p('ver:catalogo'), loadComponent: () => import('./categorias/categorias').then((m) => m.Categorias) },

      // ---- Números
      { path: 'tablero', ...p('ver:negocio'), loadComponent: () => import('./tablero/tablero').then((m) => m.Tablero) },
      { path: 'reportes', ...p('ver:reportes'), loadComponent: () => import('./reportes/reportes').then((m) => m.Reportes) },

      // ---- Administración
      { path: 'almacenes', ...p('ver:almacenes'), loadComponent: () => import('./almacenes/almacenes').then((m) => m.Almacenes) },
      { path: 'tipos-cliente', ...p('ver:almacenes'), loadComponent: () => import('./tipos-cliente/tipos-cliente').then((m) => m.TiposCliente) },
      { path: 'usuarios', ...p('ver:personal'), loadComponent: () => import('./usuarios/usuarios').then((m) => m.Usuarios) },
      { path: 'permisos', ...p('admin'), loadComponent: () => import('./permisos/permisos').then((m) => m.PermisosPantalla) },
      // La ruta específica va primero para que no la absorba 'nomina'.
      { path: 'nomina/configuracion', ...p('ver:nomina'), loadComponent: () => import('./nomina/nomina-config').then((m) => m.NominaConfig) },
      { path: 'nomina', ...p('ver:nomina'), loadComponent: () => import('./nomina/nomina').then((m) => m.Nomina) },
      { path: 'configuracion', ...p('ver:config'), loadComponent: () => import('./configuracion/configuracion').then((m) => m.Configuracion) },
    ],
  },
];
