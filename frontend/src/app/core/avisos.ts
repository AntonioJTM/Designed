/**
 * A DÓNDE LLEVA CADA AVISO (2026-10-19): la campana y Hoy arman sus enlaces de
 * aquí, así llevan a la MISMA pantalla y con el MISMO filtro. Antes el de
 * "N presentaciones en su mínimo" abría Inventario con todo, y había que buscarlas.
 */
export interface DestinoAviso {
  ruta: string;
  query?: Record<string, string>;
}

export const DESTINO_AVISO = {
  existenciasBajas: { ruta: '/admin/inventario', query: { ver: 'minimo' } },
  sinPrecio: { ruta: '/admin/productos', query: { falta: 'precio' } },
  traspasos: { ruta: '/admin/traspasos' },
  notasPendientes: { ruta: '/admin/notas-pendientes' },
  // Un turno abierto de varios días: se corta en Caja (2026-10-20).
  caja: { ruta: '/admin/caja' },
  cobranza: { ruta: '/admin/clientes/deuda' },
  dejaronDeVenir: { ruta: '/admin/clientes/dejaron' },
  autorizaciones: { ruta: '/admin/autorizaciones' },
} satisfies Record<string, DestinoAviso>;

/** La dirección completa ("/admin/inventario?ver=minimo"), para `navigateByUrl`. */
export function urlDe(d: DestinoAviso): string {
  const q = d.query ? new URLSearchParams(d.query).toString() : '';
  return q ? `${d.ruta}?${q}` : d.ruta;
}
