import { Routes } from '@angular/router';
import { AdminLayout } from './admin-layout';
import { inicioGuard, permisoGuard } from '../../core/guards/permiso.guard';
import { nombreDe } from '../../core/navegacion';

/**
 * Cada pantalla dice qué permiso pide (`data.permiso`, el mismo de
 * `core/navegacion.ts`): sin él, ni aparece en el menú ni se abre escribiendo la
 * dirección. `null` = todo el personal; 'admin' = solo el administrador.
 */
const p = (permiso: string | null) => ({ canActivate: [permisoGuard], data: { permiso } });

/**
 * Las pestañas de Clientes con el nombre que lleva cada una en pantalla: el
 * título de la pestaña del navegador dice "Cuánto debe · Clientes · Hitex".
 */
const VISTAS_CLIENTES: [string, string][] = [
  ['todos', 'Todos los clientes'],
  ['frecuencia', 'Frecuencia de compra'],
  ['dejaron', 'Dejaron de venir'],
  ['deuda', 'Cuánto debe'],
  ['que-compra', 'Qué compra'],
  ['cuando', 'Cuándo compra'],
  ['gasto', 'Cuánto gasta'],
  ['lugares', 'Dónde entrego'],
];

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    component: AdminLayout,
    children: [
      // Cada quien entra a lo suyo: Hoy, o el punto de venta si es cajero.
      { path: '', pathMatch: 'full', canActivate: [inicioGuard], children: [] },

      // Quien no tiene ninguna pantalla (un puesto sin permisos) llega aquí. Antes caía en
      // "Pregúntame", que se quitó el 2026-10-13.
      { path: 'sin-acceso', ...p(null), title: 'Sin acceso', loadComponent: () => import('./sin-acceso/sin-acceso').then((m) => m.SinAcceso) },
      // Un enlace viejo a "Pregúntame" lleva a la pantalla de inicio de cada quien.
      { path: 'asistente', redirectTo: '' },
      { path: 'hoy', ...p('ver:hoy'), title: nombreDe('hoy'), loadComponent: () => import('./hoy/hoy').then((m) => m.Hoy) },
      { path: 'autorizaciones', ...p('ver:autorizaciones'), title: nombreDe('autorizaciones'), loadComponent: () => import('./autorizaciones/autorizaciones').then((m) => m.Autorizaciones) },

      // ---- Vender
      { path: 'pos', ...p('ver:pos'), title: nombreDe('pos'), loadComponent: () => import('./pos/pos').then((m) => m.Pos) },
      { path: 'caja', ...p('ver:caja'), title: nombreDe('caja'), loadComponent: () => import('./caja/caja').then((m) => m.CajaPantalla) },
      // Las VENTAS (antes "Pedidos"). Los enlaces viejos a una venta
      // (/admin/pedidos/123) llevan a su nuevo lugar.
      { path: 'ventas', ...p('ver:pedidos'), title: nombreDe('ventas'), loadComponent: () => import('./pedidos/pedidos-list').then((m) => m.PedidosList) },
      { path: 'transferencias', canActivate: [permisoGuard], data: { permiso: 'ver:transferencias', todasLasTiendas: true },
        title: nombreDe('transferencias'), loadComponent: () => import('./transferencias/transferencias').then((m) => m.Transferencias) },
      { path: 'ventas/:id', ...p('ver:pedidos'), title: 'Detalle de la venta', loadComponent: () => import('./pedidos/pedido-detalle').then((m) => m.PedidoDetalle) },
      { path: 'pedidos/:id', redirectTo: 'ventas/:id' },
      // Las NOTAS EN ESPERA (antes "Pedidos", encargos): se modifican y se entregan
      // cobrando, a crédito o como nota pendiente de pago. El enlace viejo lleva aquí.
      { path: 'notas-en-espera', ...p('ver:encargos'), title: nombreDe('pedidos'), loadComponent: () => import('./encargos/encargos').then((m) => m.EncargosPantalla) },
      { path: 'pedidos', pathMatch: 'full', redirectTo: 'notas-en-espera' },
      // Las NOTAS PENDIENTES DE PAGO (2026-10-13): registrar su pago o pasarlas a crédito.
      { path: 'notas-pendientes', ...p('ver:notas_pendientes'), title: nombreDe('notas'), loadComponent: () => import('./notas-pendientes/notas-pendientes').then((m) => m.NotasPendientesPantalla) },
      // Apartados se quitó el 2026-10-13: un enlace viejo lleva al inicio de cada quien.
      { path: 'apartados', redirectTo: '' },

      // ---- Clientes: seis pestañas (rutas literales, ANTES de ':id' para que
      // "deuda" no se tome por el id de un cliente) y el expediente.
      // Clientes abre en la lista de todos (2026-10-14: "no tengo un lugar donde ver todos los clientes").
      { path: 'clientes', pathMatch: 'full', redirectTo: 'clientes/todos' },
      ...VISTAS_CLIENTES.map(([vista, nombre]) => ({
        path: 'clientes/' + vista,
        title: `${nombre} · ${nombreDe('clientes')}`,
        canActivate: [permisoGuard],
        // Las miradas que suman todas las tiendas, solo para quien las ve todas (2026-10-15).
        data: { permiso: 'ver:clientes', vista, todasLasTiendas: !['todos', 'lugares'].includes(vista) },
        loadComponent: () => import('./clientes/clientes').then((m) => m.ClientesPantalla),
      })),
      { path: 'clientes/:id', ...p('ver:clientes'), title: 'Expediente del cliente', loadComponent: () => import('./clientes/cliente-expediente').then((m) => m.ClienteExpediente) },

      // ---- Mercancía
      { path: 'inventario', ...p('ver:inventario'), title: nombreDe('inventario'), loadComponent: () => import('./inventario/inventario').then((m) => m.Inventario) },
      { path: 'remesas', ...p('ver:remesa'), title: nombreDe('remesa'), loadComponent: () => import('./remesas/remesas').then((m) => m.Remesas) },
      { path: 'traspasos', ...p('ver:surtir'), title: nombreDe('surtir'), loadComponent: () => import('./traspasos/traspasos').then((m) => m.Traspasos) },
      { path: 'kardex', ...p('ver:kardex'), title: nombreDe('kardex'), loadComponent: () => import('./inventario/kardex').then((m) => m.Kardex) },

      // ---- Catálogo
      { path: 'productos', ...p('ver:catalogo'), title: nombreDe('productos'), loadComponent: () => import('./productos/productos-list').then((m) => m.ProductosList) },
      {
        path: 'productos/:id/presentaciones',
        ...p('ver:catalogo'),
        title: 'Presentaciones del hilo',
        loadComponent: () => import('./productos/producto-presentaciones').then((m) => m.ProductoPresentaciones),
      },
      // El alta y la edición son un modal sobre el listado; `productos/:id` ya
      // no existe. Se conserva el redirect para un enlace o marcador viejo.
      { path: 'productos/:id', redirectTo: 'productos' },
      { path: 'categorias', ...p('ver:catalogo'), title: nombreDe('materiales'), loadComponent: () => import('./categorias/categorias').then((m) => m.Categorias) },

      // ---- Números
      { path: 'tablero', ...p('ver:negocio'), title: nombreDe('negocio'), loadComponent: () => import('./tablero/tablero').then((m) => m.Tablero) },
      { path: 'reportes', ...p('ver:reportes'), title: nombreDe('reportes'), loadComponent: () => import('./reportes/reportes').then((m) => m.Reportes) },

      // ---- Administración
      { path: 'almacenes', ...p('ver:almacenes'), title: nombreDe('almacenes'), loadComponent: () => import('./almacenes/almacenes').then((m) => m.Almacenes) },
      { path: 'tipos-cliente', ...p('ver:almacenes'), title: nombreDe('listas'), loadComponent: () => import('./tipos-cliente/tipos-cliente').then((m) => m.TiposCliente) },
      { path: 'usuarios', ...p('ver:personal'), title: nombreDe('personal'), loadComponent: () => import('./usuarios/usuarios').then((m) => m.Usuarios) },
      { path: 'permisos', ...p('admin'), title: nombreDe('permisos'), loadComponent: () => import('./permisos/permisos').then((m) => m.PermisosPantalla) },
      // La ruta específica va primero para que no la absorba 'nomina'.
      { path: 'nomina/configuracion', ...p('ver:nomina'), title: 'Configuración de nómina', loadComponent: () => import('./nomina/nomina-config').then((m) => m.NominaConfig) },
      { path: 'nomina', ...p('ver:nomina'), title: nombreDe('nomina'), loadComponent: () => import('./nomina/nomina').then((m) => m.Nomina) },
      { path: 'configuracion', ...p('ver:config'), title: nombreDe('config'), loadComponent: () => import('./configuracion/configuracion').then((m) => m.Configuracion) },
    ],
  },
];
