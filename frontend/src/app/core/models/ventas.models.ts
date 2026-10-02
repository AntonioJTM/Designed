import { Direccion, MetodoEntrega } from './tienda.models';

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
  /**
   * Lo que se vendió, CONGELADO al momento de la venta. Dice el color y la
   * presentación ("BLANCO · Paquete") pero no qué hilo es: para eso están los
   * campos de abajo, que se leen vivos del catálogo.
   */
  descripcion: string;
  /** Qué hilo es. Vivos del catálogo, no congelados: sirven para atender dudas. */
  producto?: string;
  calibre?: string | null;
  material?: string | null;
  linea?: string | null;
  tipo_presentacion?: 'paquete' | 'cono' | 'simple';
  presentacion?: string | null;
  /** Lo que pesa un paquete de esta presentación, como referencia. */
  peso_kg?: string | null;
  /** El código principal de la presentación (no el de un bulto). */
  codigo_barras?: string | null;
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
  /** Si tiene captura del comprobante subida. El archivo se pide aparte. */
  tiene_comprobante?: boolean | number;
  /** Cómo se llamaba el archivo cuando lo mandó el cliente. */
  comprobante_nombre?: string | null;
  /** image/jpeg, image/png, image/webp o application/pdf. */
  comprobante_tipo?: string | null;
  comprobante_subido_en?: string | null;
  /** Nombre de quien la subió. */
  comprobante_subido_por?: string | null;
}

export type CanalVenta = 'tienda_linea' | 'punto_venta';
export type EstadoPedido =
  // 'apartado' = anticipo dejado, mercancía reservada y sin entregar.
  | 'apartado'
  | 'pendiente' | 'pagado' | 'en_preparacion' | 'enviado' | 'entregado' | 'cancelado' | 'devuelto';

/**
 * Un apartado vigente: la mercancía está guardada y el cliente va abonando.
 * Viene de la vista `v_apartados`.
 */
export interface Apartado {
  pedido_id: number;
  numero_pedido: string;
  cliente_id?: number | null;
  cliente?: string | null;
  nombre_comercial?: string | null;
  telefono?: string | null;
  almacen_id?: number | null;
  almacen?: string | null;
  total: string | number;
  abonado: string | number;
  pendiente: string | number;
  /** Qué tanto lleva pagado. Sirve para ordenar por "los que ya casi liquidan". */
  pct_pagado: string | number;
  creado_en: string;
  dias_apartado: number;
  ultimo_abono?: string | null;
  aparto_con?: string | null;
}

/** El resumen de los apartados vigentes. */
export interface Apartados {
  items: Apartado[];
  num_apartados: number;
  /** Cuánto dinero de la tienda está comprometido en mercancía guardada. */
  total_apartado: number;
  total_abonado: number;
}

/** Lo que devuelve un abono a un apartado. */
export interface ResultadoAbono {
  pedido_id: number;
  numero_pedido: string;
  total: number;
  abonado: number;
  pendiente: number;
  /** Ya lo pagó todo: se puede entregar. */
  liquidado: boolean;
}

export interface Pedido {
  id: number;
  numero_pedido: string;
  canal: CanalVenta;
  /** Cómo llega la mercancía: recogen en tienda o se envía a domicilio. */
  metodo_entrega: MetodoEntrega;
  estado: EstadoPedido;
  /** Si ya salió del inventario. Un apartado vigente está en 0. */
  inventario_descontado?: number | boolean;
  entregado_en?: string | null;
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
  direccion_envio_id?: number | null;
  /** La dirección completa, para que quien surte no tenga que buscarla. */
  direccion_envio?: Direccion | null;
  /**
   * Solo al crear: lo que se le regresó al cliente en efectivo. No se guarda
   * —no es dinero de la tienda— pero el ticket lo muestra.
   */
  cambio?: number;
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
