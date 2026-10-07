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
  /** El turno abierto de la caja, si tiene (lo trae el listado). */
  turno_id?: number | null;
  turno_desde?: string | null;
  turno_usuario?: string | null;
  /** Su último corte y cuánto se descuadró (positivo sobró, negativo faltó). */
  ultimo_corte?: string | null;
  ultimo_corte_diferencia?: string | null;
}

export interface MovimientoCaja {
  id: number;
  tipo: 'venta' | 'ingreso' | 'retiro' | 'devolucion';
  monto: string;
  referencia_id?: number | null;
  motivo?: string | null;
  creado_en: string;
  /** Venta y devolución: el folio y el cliente del pedido. */
  numero_pedido?: string | null;
  cliente?: string | null;
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
  /** Cuántos conos eran, si se contaron al pesarlos (solo informativo: se cobran kilos). */
  piezas?: number | null;
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
  // 'listo' = un PEDIDO (encargo) preparado, esperando que pasen por él o que
  // salga el chofer.
  | 'pendiente' | 'pagado' | 'en_preparacion' | 'listo' | 'enviado' | 'entregado' | 'cancelado' | 'devuelto';

/** Lo que lleva un pedido, para leerlo de un vistazo. */
export interface EncargoHilo {
  hilo: string;
  tipo_presentacion: string | null;
  kg: number;
  /** Conos, si se contaron al pesarlos. */
  piezas: number | null;
  /** Cuántos paquetes van: los escaneados al prepararlo, o un aproximado. */
  paquetes: number | null;
  /** Paquetes ya escaneados (ligados al pedido); 0 = el número es aproximado. */
  escaneados?: number;
}

/**
 * Un PEDIDO de cliente (encargo) sin entregar: una venta que se tomó en el
 * mostrador, con la mercancía apartada, que se entrega después (pasa por él o
 * lo lleva el chofer) cobrando lo que falte.
 */
export interface Encargo {
  id: number;
  numero_pedido: string;
  estado: 'en_preparacion' | 'listo' | 'enviado';
  metodo_entrega: MetodoEntrega;
  /** A dónde lo lleva el chofer. */
  entrega_direccion: string | null;
  /** Para cuándo lo quiere ('YYYY-MM-DD'). */
  entrega_para: string | null;
  total: number;
  costo_envio: string;
  notas: string | null;
  creado_en: string;
  almacen_id: number;
  almacen: string | null;
  cliente_id: number;
  cliente: string | null;
  nombre_comercial: string | null;
  telefono: string | null;
  vendedor: string | null;
  pagado: number;
  falta: number;
  /** Pesó menos de lo que dejó pagado: se le devuelve al entregarlo. */
  a_favor?: number;
  hilos: EncargoHilo[];
  kg: number;
}

export interface Encargos {
  items: Encargo[];
  conteo: { en_preparacion: number; listo: number; enviado: number };
  por_cobrar: number;
}

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
  /** Qué se guardó, con el calibre (rediseño 2026-10). */
  hilos?: HiloApartado[];
  /** Cuántos kilos están apartados en este pedido. */
  kg?: number;
}

/** Un hilo dentro de un apartado. `paquetes` es aproximado: cada bulto pesa distinto. */
export interface HiloApartado {
  hilo: string;
  tipo_presentacion?: 'paquete' | 'cono' | 'simple';
  kg: number;
  paquetes: number | null;
}

/** El resumen de los apartados vigentes. */
export interface Apartados {
  items: Apartado[];
  num_apartados: number;
  /** Cuánto dinero de la tienda está comprometido en mercancía guardada. */
  total_apartado: number;
  total_abonado: number;
  /** Kilos de la bodega que ya tienen dueño. */
  kg_apartado?: number;
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
  /** 1 = PEDIDO de cliente (encargo): se entrega después, cobrando lo que falte. */
  encargo?: number | boolean;
  /** A dónde lo lleva el chofer (pedido con entrega 'envio'). */
  entrega_direccion?: string | null;
  /** Para cuándo lo quiere el cliente ('YYYY-MM-DD'). */
  entrega_para?: string | null;
  estado: EstadoPedido;
  /** Si ya salió del inventario. Un apartado vigente está en 0. */
  inventario_descontado?: number | boolean;
  entregado_en?: string | null;
  cliente_id?: number | null;
  cliente?: string | null;
  /** Como le dicen al cliente ("Doña Chela"): con eso lo reconoce el mostrador. */
  cliente_nombre_comercial?: string | null;
  usuario?: string | null;
  almacen?: string | null;
  sesion_caja_id?: number | null;
  /** La caja donde se vendió (por el turno). */
  caja?: string | null;
  /** Listado: lo cobrado (pagos completados) y lo que falta de esta venta. */
  pagado?: string | number;
  falta?: number;
  /** Listado: qué se llevó, con su calibre ("ROJO 2/30 · cono"). */
  hilos?: string[];
  /** Detalle: lo que se fió con esta venta (cargo y, si se canceló, su ajuste). */
  credito?: MovimientoCreditoPedido[];
  /** Detalle: abonos a la cuenta del cliente después de la venta (no son de este pedido). */
  abonos_cuenta?: { monto: string; creado_en: string }[];
  /**
   * Detalle de una venta fiada: cuánto de lo fiado ya se pagó con abonos a la
   * cuenta y cuánto falta (los abonos se aplican a lo más antiguo primero).
   * null si no se fió.
   */
  credito_pagado?: number | null;
  credito_por_pagar?: number | null;
  actualizado_en?: string;
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
  /** Al entregar un pedido que pesó menos de lo que dejó: lo que se le devolvió. */
  devuelto?: number;
  /** Al prepararlo: el total de antes, lo que lleva pagado, lo que falta o lo que tiene a favor. */
  total_antes?: number;
  a_favor?: number;
}

/** Una línea al PREPARAR un pedido: los paquetes que van, o lo que pesó. */
export interface LineaPreparada {
  detalle_id: number;
  codigos?: string[];
  cantidad?: number;
  piezas?: number | null;
}

/** Un movimiento del libro de crédito ligado a un pedido. */
export interface MovimientoCreditoPedido {
  tipo: 'cargo' | 'abono' | 'ajuste';
  monto: string;
  notas?: string | null;
  creado_en: string;
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
  /** Paquete, cono o simple: dice cómo se nombra la línea ("6 conos", "por kilo"). */
  tipo?: string | null;
  /**
   * Cuántos conos se pesaron ("vengo por 6 conos"). Solo informativo: se cobra
   * y se descuenta `cantidad`, que son los kilos que marcó la báscula.
   */
  piezas?: number;
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
