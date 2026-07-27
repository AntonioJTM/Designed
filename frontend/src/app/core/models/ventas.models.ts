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
  /**
   * Bultos que se entregaron en esta línea, con el código, el peso y el lote
   * congelados al momento de la venta. Vacío en las ventas sin escaneo.
   */
  bultos?: BultoVendido[];
  /**
   * Otras presentaciones en que esta línea puede regresar, con la cantidad
   * equivalente ya calculada por el backend. El caso típico: se entregó el
   * paquete y el cliente devuelve los conos.
   */
  alternativas_devolucion?: AlternativaDevolucion[];
}

/** Una presentación en que puede regresar la mercancía, y cuánto. */
export interface AlternativaDevolucion {
  variante_id: number;
  sku: string;
  presentacion?: string | null;
  unidad: string;
  cantidad_equivalente: number;
}

/** En qué presentación y cuánto regresa una línea al cancelar o devolver. */
export interface DevolucionLinea {
  detalle_id: number;
  variante_id: number;
  cantidad?: number;
}

/** Un bulto entregado, tal como quedó registrado en el pedido. */
export interface BultoVendido {
  codigo: string;
  peso_kg: string;
  lote?: string | null;
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
  /**
   * Bultos escaneados que forman esta cantidad. Cada bulto pesa distinto, así
   * que la cantidad es la SUMA de sus pesos reales, no un múltiplo del nominal.
   * Sirve además para no cobrar dos veces el mismo bulto físico.
   */
  bultos?: BultoEnCarrito[];
}

/** Un bulto físico dentro del carrito: su código y lo que pesó. */
export interface BultoEnCarrito {
  codigo: string;
  peso_kg: number;
  lote?: string | null;
}
