// Modelos de ventas: pedidos, pagos y caja.

export interface MetodoPago {
  id: number;
  nombre: string;
}

export interface Caja {
  id: number;
  almacen_id: number;
  almacen?: string;
  nombre: string;
  activo: boolean | number;
}

export interface MovimientoCaja {
  id: number;
  tipo: 'venta' | 'ingreso' | 'retiro' | 'devolucion';
  monto: string;
  referencia_id?: number | null;
  motivo?: string | null;
  creado_en: string;
}

export interface SesionCaja {
  id: number;
  caja_id: number;
  caja?: string;
  usuario?: string;
  usuario_id: number;
  monto_inicial: string;
  monto_esperado?: string | null;
  monto_final?: string | null;
  diferencia?: string | null;
  estado: 'abierta' | 'cerrada';
  fecha_apertura: string;
  fecha_cierre?: string | null;
  movimientos?: MovimientoCaja[];
  esperado_actual?: number;
  totales_por_tipo?: Record<string, number>;
}

export interface PedidoLinea {
  id: number;
  variante_id: number;
  sku: string;
  descripcion: string;
  cantidad: string;
  precio_unitario: string;
  descuento: string;
  impuesto: string;
  subtotal: string;
}

export interface PagoLinea {
  id: number;
  metodo_pago_id: number;
  metodo: string;
  monto: string;
  estado: string;
  referencia_transaccion?: string | null;
  creado_en: string;
}

export type CanalVenta = 'tienda_linea' | 'punto_venta';
export type EstadoPedido =
  | 'pendiente' | 'pagado' | 'en_preparacion' | 'enviado' | 'entregado' | 'cancelado' | 'devuelto';

export interface Pedido {
  id: number;
  numero_pedido: string;
  canal: CanalVenta;
  estado: EstadoPedido;
  cliente?: string | null;
  usuario?: string | null;
  almacen?: string | null;
  sesion_caja_id?: number | null;
  subtotal: string;
  descuento: string;
  impuestos: string;
  costo_envio: string;
  total: string;
  notas?: string | null;
  creado_en: string;
  detalle?: PedidoLinea[];
  pagos?: PagoLinea[];
}

/** Ítem del carrito POS (estado local en el navegador). */
export interface ItemCarrito {
  variante_id: number;
  sku: string;
  producto: string;
  presentacion?: string | null;
  precio: number;
  /** Unidad de peso en que se vende (kg por omisión). La cantidad es decimal. */
  unidad?: string;
  cantidad: number;
}
