import { CanalVenta, EstadoPedido } from '../../../core/models/ventas.models';

/**
 * Cómo se nombra y de qué color va cada estado del pedido. Vive en un solo
 * sitio para que la lista, el detalle y su selector digan lo mismo: antes la
 * pantalla enseñaba el valor crudo de la base ("en_preparacion").
 *
 * En el mostrador, una venta "pendiente" es una venta FIADA (la mercancía salió
 * y el dinero no ha entrado), así que se dice así. En la tienda en línea es un
 * pedido que espera el depósito.
 */
export function etiquetaEstado(
  estado: EstadoPedido | string,
  canal?: CanalVenta | null,
  encargo?: boolean | number | null
): string {
  // Un PEDIDO (encargo) habla de sus pasos: por preparar, listo, en camino.
  if (encargo) {
    if (estado === 'en_preparacion') return 'Por preparar';
    if (estado === 'listo') return 'Listo';
    if (estado === 'enviado') return 'En camino';
  }
  switch (estado) {
    case 'apartado': return 'Apartado';
    case 'pendiente': return canal === 'tienda_linea' ? 'Pendiente de pago' : 'Pendiente · a crédito';
    case 'pagado': return 'Pagado';
    case 'en_preparacion': return 'En preparación';
    case 'listo': return 'Listo';
    case 'enviado': return 'Enviado';
    case 'entregado': return 'Entregado';
    case 'cancelado': return 'Cancelado';
    case 'devuelto': return 'Devuelto';
    default: return String(estado);
  }
}

/** La clase de la `.pill`: verde lo cobrado, ámbar lo que se debe, gris lo que ya no cuenta. */
export function tonoEstado(estado: EstadoPedido | string): string {
  switch (estado) {
    case 'pagado': return 'verde';
    case 'pendiente': return 'ambar';
    case 'cancelado':
    case 'devuelto': return 'gris';
    default: return 'azul';
  }
}
