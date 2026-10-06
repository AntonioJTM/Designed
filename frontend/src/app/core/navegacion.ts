/**
 * El menú del panel, por tareas (rediseño 2026-10, "Rediseño · Menú y Clientes").
 *
 * Es la ÚNICA lista de pantallas: de aquí salen el menú lateral, la guarda que
 * impide abrir una pantalla escribiendo la dirección y la pantalla a la que entra
 * cada quien. Cada opción lleva el permiso que la deja ver (Administración →
 * Permisos); `null` = la ve todo el personal.
 *
 * Los nombres son los de siempre: el usuario pidió conservarlos.
 */
export interface OpcionMenu {
  clave: string;
  nombre: string;
  ruta: string;
  /** Trazo del icono (viewBox 24×24, línea de 1.75). */
  icono: string;
  /** Permiso que la deja ver. 'admin' = solo el administrador. */
  permiso: string | null;
}

export interface GrupoMenu {
  titulo: string | null;
  opciones: OpcionMenu[];
}

const I = {
  chat: 'M4 5h16v11H9l-5 4z',
  hoy: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4 M8 14h3',
  cobrar: 'M4 8V5h3 M17 5h3v3 M20 16v3h-3 M7 19H4v-3 M8 9v6 M11 9v6 M14 9v6 M17 9v6',
  caja: 'M3 7h18v11H3z M12 15a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M6 10h.01 M18 15h.01',
  pedidos: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6 M9 16h3',
  apartados: 'M6 3h12v18l-6-4-6 4z',
  clientes: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5 M16 4.5a3.5 3.5 0 0 1 0 6.5 M18.5 14.5c1.7.8 2.8 2.8 3 5.5',
  existencias: 'M3 8l9-5 9 5v8l-9 5-9-5z M3 8l9 5 9-5 M12 13v8',
  recibir: 'M12 3v11 M8 10l4 4 4-4 M4 15v5h16v-5',
  mandar: 'M2 6h12v10H2z M14 10h4l3 3v3h-7 M6 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M17 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  movimientos: 'M7 20V4 M3 8l4-4 4 4 M17 4v16 M13 16l4 4 4-4',
  hilos: 'M7 3h10 M7 21h10 M8.5 3v18 M15.5 3v18 M8.5 8l7 3 M8.5 12l7 3 M8.5 16l7 3',
  materiales: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5',
  negocio: 'M4 20V11 M10 20V5 M16 20v-6 M3 20h18',
  reportes: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 13h6 M9 17h6',
  almacenes: 'M3 21V9l9-6 9 6v12 M9 21v-6h6v6',
  listas: 'M3 12V4h8l10 10-8 8z M7.5 8h.01',
  personal: 'M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M5 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5',
  permisos: 'M12 3l8 3v6c0 4.5-3.4 8.1-8 9-4.6-.9-8-4.5-8-9V6z M9 12l2 2 4-4',
  nomina: 'M3 7h18v13H3z M3 7l3-4h12l3 4 M16 13.5h2',
  config: 'M4 6h9 M17 6h3 M15 4v4 M4 12h3 M11 12h9 M9 10v4 M4 18h11 M19 18h1 M17 16v4',
};

export const MENU: GrupoMenu[] = [
  { titulo: null, opciones: [{ clave: 'preguntame', nombre: 'Pregúntame', ruta: '/admin/asistente', icono: I.chat, permiso: null }] },
  { titulo: 'Inicio', opciones: [{ clave: 'hoy', nombre: 'Hoy', ruta: '/admin/hoy', icono: I.hoy, permiso: 'ver:hoy' }] },
  {
    titulo: 'Vender',
    opciones: [
      { clave: 'pos', nombre: 'Punto de venta', ruta: '/admin/pos', icono: I.cobrar, permiso: 'ver:pos' },
      { clave: 'caja', nombre: 'Caja', ruta: '/admin/caja', icono: I.caja, permiso: 'ver:caja' },
      { clave: 'pedidos', nombre: 'Pedidos', ruta: '/admin/pedidos', icono: I.pedidos, permiso: 'ver:pedidos' },
      { clave: 'apartados', nombre: 'Apartados', ruta: '/admin/apartados', icono: I.apartados, permiso: 'ver:apartados' },
    ],
  },
  { titulo: 'Clientes', opciones: [{ clave: 'clientes', nombre: 'Clientes', ruta: '/admin/clientes', icono: I.clientes, permiso: 'ver:clientes' }] },
  {
    titulo: 'Mercancía',
    opciones: [
      { clave: 'inventario', nombre: 'Inventario', ruta: '/admin/inventario', icono: I.existencias, permiso: 'ver:inventario' },
      { clave: 'remesa', nombre: 'Surtir inventario', ruta: '/admin/remesas', icono: I.recibir, permiso: 'ver:remesa' },
      { clave: 'surtir', nombre: 'Surtir sucursal', ruta: '/admin/traspasos', icono: I.mandar, permiso: 'ver:surtir' },
      { clave: 'kardex', nombre: 'Kardex', ruta: '/admin/kardex', icono: I.movimientos, permiso: 'ver:kardex' },
    ],
  },
  {
    titulo: 'Catálogo',
    opciones: [
      { clave: 'productos', nombre: 'Productos', ruta: '/admin/productos', icono: I.hilos, permiso: 'ver:catalogo' },
      { clave: 'materiales', nombre: 'Materiales', ruta: '/admin/categorias', icono: I.materiales, permiso: 'ver:catalogo' },
    ],
  },
  {
    titulo: 'Números',
    opciones: [
      { clave: 'negocio', nombre: 'Cómo va el negocio', ruta: '/admin/tablero', icono: I.negocio, permiso: 'ver:negocio' },
      { clave: 'reportes', nombre: 'Reportes', ruta: '/admin/reportes', icono: I.reportes, permiso: 'ver:reportes' },
    ],
  },
  {
    titulo: 'Administración',
    opciones: [
      { clave: 'almacenes', nombre: 'Almacenes', ruta: '/admin/almacenes', icono: I.almacenes, permiso: 'ver:almacenes' },
      { clave: 'listas', nombre: 'Listas de precio', ruta: '/admin/tipos-cliente', icono: I.listas, permiso: 'ver:almacenes' },
      { clave: 'personal', nombre: 'Personal', ruta: '/admin/usuarios', icono: I.personal, permiso: 'ver:personal' },
      { clave: 'permisos', nombre: 'Permisos', ruta: '/admin/permisos', icono: I.permisos, permiso: 'admin' },
      { clave: 'nomina', nombre: 'Nómina', ruta: '/admin/nomina', icono: I.nomina, permiso: 'ver:nomina' },
      { clave: 'config', nombre: 'Configuración', ruta: '/admin/configuracion', icono: I.config, permiso: 'ver:config' },
    ],
  },
];

/**
 * A dónde entra cada quien: Hoy si lo puede ver; si no, el punto de venta (el
 * cajero); si tampoco, la primera pantalla de su menú.
 */
export function rutaDeInicio(puede: (permiso: string | null) => boolean): string {
  if (puede('ver:hoy')) return '/admin/hoy';
  if (puede('ver:pos')) return '/admin/pos';
  for (const g of MENU) for (const o of g.opciones) if (o.clave !== 'preguntame' && puede(o.permiso)) return o.ruta;
  return '/admin/asistente';
}
