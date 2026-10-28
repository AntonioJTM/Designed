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
  // Un turno abierto de varios días: se corta en Caja (2026-10-20). Con su caja ya
  // elegida (`?caja=`, 2026-10-26): `cajaDe(id)`.
  caja: { ruta: '/admin/caja' },
  cobranza: { ruta: '/admin/clientes/deuda' },
  dejaronDeVenir: { ruta: '/admin/clientes/dejaron' },
  autorizaciones: { ruta: '/admin/autorizaciones' },
  // El WhatsApp de la tienda se desconectó: se vuelve a enlazar en Configuración.
  whatsapp: { ruta: '/admin/configuracion' },
  // Los clientes nuevos sin crédito que no caben en el aviso: Todos los clientes, los más nuevos arriba.
  clientesNuevos: { ruta: '/admin/clientes/todos', query: { orden: 'nuevo' } },
} satisfies Record<string, DestinoAviso>;

/** El expediente de un cliente (el cliente nuevo al que falta decidirle el crédito). */
export function clienteDe(clienteId: number | string): DestinoAviso {
  return { ruta: `/admin/clientes/${clienteId}` };
}

/** Caja con ESA caja elegida: el aviso del turno abierto lleva a la que lo tiene (2026-10-26). */
export function cajaDe(cajaId: number | null | undefined): DestinoAviso {
  return cajaId ? { ruta: '/admin/caja', query: { caja: String(cajaId) } } : DESTINO_AVISO.caja;
}

/** La dirección completa ("/admin/inventario?ver=minimo"), para `navigateByUrl`. */
export function urlDe(d: DestinoAviso): string {
  const q = d.query ? new URLSearchParams(d.query).toString() : '';
  return q ? `${d.ruta}?${q}` : d.ruta;
}
