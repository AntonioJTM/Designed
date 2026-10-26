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
  /** 'gasto' (2026-10-20): un gasto de la caja (limpieza, papelería…); sale como un retiro. */
  tipo: 'venta' | 'ingreso' | 'retiro' | 'devolucion' | 'gasto';
  monto: string;
  referencia_id?: number | null;
  motivo?: string | null;
  creado_en: string;
  /** Venta y devolución: el folio y el cliente del pedido. */
  numero_pedido?: string | null;
  cliente?: string | null;
}

/** Un tipo de gasto (Viajes, Limpieza…) con su TOPE POR GASTO; null = sin tope (2026-10-20). */
export interface TipoGasto {
  id: number;
  nombre: string;
  limite: number | null;
  activo: boolean;
}

/** Un gasto pagado con el cajón (2026-10-20). */
export interface Gasto {
  id: number;
  sesion_caja_id: number;
  tipo_gasto_id: number;
  tipo: string;
  monto: number;
  descripcion: string;
  /** El tope que tenía su tipo al registrarlo (congelado). */
  limite: number | null;
  /** Pasó su tope: se registró con autorización (o lo hizo quien autoriza). */
  paso_limite: boolean;
  /** Necesitaba autorización: pasó su tope o su tipo no tenía. Sin `autorizo`: lo hizo directo quien autoriza. */
  se_autorizaba: boolean;
  usuario_id: number;
  autorizacion_id: number | null;
  autorizo: string | null;
  con_comprobante: boolean;
  comprobante_nombre: string | null;
  comprobante_tipo: string | null;
  estado: 'registrado' | 'cancelado';
  motivo_cancelacion: string | null;
  creado_en: string;
  cancelado_en: string | null;
  cancelado_por: string | null;
  usuario: string;
  caja: string;
  almacen_id: number;
  almacen: string;
  /** El turno de donde salió: con 'abierta' todavía se puede cancelar. */
  turno_estado: string;
}

export interface ListaGastos {
  /** Los primeros 500; las cifras de abajo son de TODOS. */
  items: Gasto[];
  hay_mas: boolean;
  /** Solo los registrados (sin los cancelados). */
  total: number;
  num: number;
  pasaron_limite: number;
  por_tipo: { tipo_gasto_id: number; tipo: string; num: number; total: number }[];
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
  /** En efectivo: el billete que entregó (2026-10-16). Cambio = recibido − monto. */
  recibido?: string | null;
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
  /** Cuántos paquetes van: los escaneados, o un aproximado. */
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
  /** Su SALDO A FAVOR (anticipos, lo que regresó): se puede usar al entregarla (2026-10-20). */
  saldo_favor?: number;
  hilos: EncargoHilo[];
  kg: number;
}

export interface Encargos {
  items: Encargo[];
  conteo: { en_preparacion: number; listo: number; enviado: number };
  por_cobrar: number;
}

/** Lo que se llevó en una nota pendiente de pago, por hilo. */
export interface NotaPendienteHilo {
  hilo: string;
  tipo_presentacion: string | null;
  kg: number;
  /** Conos pesados en la báscula ("6 conos"). */
  piezas: number | null;
  /** Paquetes escaneados. */
  paquetes: number | null;
}

/**
 * Una NOTA PENDIENTE DE PAGO por cobrar (2026-10-13): se llevó la mercancía y
 * salió su ticket; el pago se registra después (abonos) o se pasa a crédito.
 */
export interface NotaPendiente {
  id: number;
  numero_pedido: string;
  total: number;
  creado_en: string;
  almacen_id: number;
  almacen: string | null;
  cliente_id: number;
  cliente: string | null;
  nombre_comercial: string | null;
  telefono: string | null;
  limite_credito: string | number | null;
  vendedor: string | null;
  /** Días desde que se la llevó. */
  dias: number;
  pagado: number;
  falta: number;
  /** Su SALDO A FAVOR: se puede usar para pagarla (2026-10-20). */
  saldo_favor?: number;
  hilos: NotaPendienteHilo[];
}

export interface NotasPendientes {
  items: NotaPendiente[];
  por_cobrar: number;
  num_notas: number;
  num_clientes: number;
  mas_antigua_dias: number;
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
  /** El pago que se acaba de registrar: con él se pide su ticket (2026-10-15). */
  pago_id?: number;
  numero_pedido: string;
  total: number;
  abonado: number;
  pendiente: number;
  /** Ya lo pagó todo: se puede entregar. */
  liquidado: boolean;
  /** Con dos formas (2026-10-26): todos los pagos de esa vez, y lo que pasó a su crédito. */
  pago_ids?: number[];
  a_credito?: number;
}

/** Alguien del personal que puede quedar como vendedor de una venta de esa tienda. */
export interface Vendedor {
  id: number;
  nombre: string;
  puesto: string;
}

export interface Pedido {
  id: number;
  numero_pedido: string;
  canal: CanalVenta;
  /** Cómo llega la mercancía: recogen en tienda o se envía a domicilio. */
  metodo_entrega: MetodoEntrega;
  /** 1 = NOTA EN ESPERA (antes "pedido", encargo): se entrega después, cobrando lo que falte. */
  encargo?: number | boolean;
  /**
   * 1 = salió como NOTA PENDIENTE DE PAGO (2026-10-13): se llevó la mercancía y
   * el pago se registra después, en abonos, o se pasa a crédito.
   */
  nota_pendiente?: number | boolean;
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
  /** Sus teléfonos, para mandarle el ticket por WhatsApp (2026-10-16; solo en el detalle). */
  cliente_telefono?: string | null;
  cliente_telefono_alt?: string | null;
  /** Quien la registró («Elaboró»). */
  usuario_id?: number | null;
  usuario?: string | null;
  /** Quien la vendió (2026-10-23): a esa persona va la comisión. Sin elegir, quien la registró. */
  vendedor_id?: number | null;
  vendedor?: string | null;
  almacen?: string | null;
  sesion_caja_id?: number | null;
  /** La caja donde se vendió (por el turno). */
  caja?: string | null;
  /** Listado: lo cobrado (pagos completados) y lo que falta de esta venta. */
  pagado?: string | number;
  falta?: number;
  /** Listado: qué se llevó, con su calibre ("ROJO 2/30 · cono"). */
  hilos?: string[];
  /** Listado (2026-10-16): el número del cliente (C-0001). */
  cliente_codigo?: string | null;
  /** Listado: se pagó ese mismo día (no a crédito, pendiente de pago, en espera ni apartado). */
  contado?: boolean;
  /** Listado: si parte se fue a la cuenta del cliente (a crédito). */
  fiada?: boolean;
  /** Listado: emitida, cancelada, devolución (regresó todo) o devolución parcial. */
  situacion?: 'emitida' | 'cancelada' | 'devolucion' | 'devolucion_parcial';
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
  /** A cuántos días se fió (2026-10-20); las de antes cuentan 15. */
  dias_credito?: number | null;
  /** Detalle: cuándo vence lo fiado (el día en que se fió más sus días). */
  credito_vence_el?: string | null;
  /** Listado: hace cuántos días venció lo que todavía se debe; null si no ha vencido. */
  credito_dias_vencida?: number | null;
  /** Detalle: lo que el cliente REGRESÓ de esta nota y le quedó a favor (2026-10-13). */
  devoluciones?: DevolucionHecha[];
  /** Cuánto suman esas devoluciones. */
  devuelto_total?: number;
  /**
   * Si se pagó con su SALDO A FAVOR (2026-10-15): cuánto se usó, cuánto le quedó
   * a favor justo después y cuánto tiene hoy. null si no se usó.
   */
  saldo_favor_usado?: { usado: number; quedo: number; hoy: number } | null;
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
  /**
   * Al cancelar (o devolver la diferencia) cuando en el cajón no había todo el
   * efectivo: lo que le quedó A FAVOR al cliente (2026-10-20).
   */
  a_favor_sin_efectivo?: number;
  /** Al cancelar una venta a crédito ya abonada: lo abonado que pasó a su saldo a favor (2026-10-20). */
  abonado_a_favor?: number;
  /** Al cancelar (2026-10-26): lo que se eligió dejarle a su saldo a favor. */
  efectivo_a_favor?: number;
  transferencia_a_favor?: number;
  /** Una venta a crédito ya abonada: lo abonado que se le regresó (2026-10-26). */
  abonado_regresado?: number;
  /** Al modificarlo: el total de antes, lo que falta o lo que tiene a favor, y qué cambió. */
  total_antes?: number;
  a_favor?: number;
  cambios?: string[];
}

/**
 * Una línea al MODIFICAR un pedido: con `detalle_id`, una que ya llevaba; sin él
 * (con `variante_id`), un hilo nuevo. Las que no se manden se quitan.
 */
export interface LineaPedidoEdit {
  detalle_id?: number;
  variante_id?: number;
  codigos?: string[];
  cantidad?: number;
  piezas?: number | null;
}

/** Lo que se manda al modificar un pedido: lo que lleva y la entrega, como notas. */
export interface ModificarPedidoInput {
  lineas: LineaPedidoEdit[];
  metodo_entrega?: 'recoger' | 'envio';
  entrega_direccion?: string | null;
  costo_envio?: number;
  entrega_para?: string | null;
  notas?: string | null;
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

// ---- Devoluciones con SALDO A FAVOR (2026-10-13) ----

/** Un paquete de la nota: si todavía puede regresar cerrado. */
export interface BultoDevolvible {
  codigo: string;
  peso_kg: number;
  lote?: string | null;
  /** Sigue vendido y no se ha devuelto: puede regresar cerrado. */
  devolvible: boolean;
  /** Ya regresó en otra devolución. */
  devuelto: boolean;
  /** Se bajó a conos: ya no regresa cerrado. */
  abierto: boolean;
}

/** Una línea de la nota y lo que todavía puede regresar de ella. */
export interface LineaDevolvible {
  detalle_id: number;
  /** "ROJO 2/30". */
  hilo: string;
  descripcion: string;
  tipo_presentacion: 'paquete' | 'cono' | 'simple';
  /** Lo que se llevó, en kg. */
  cantidad: number;
  piezas?: number | null;
  /** Lo que ya regresó en devoluciones anteriores. */
  devuelto: number;
  /** Lo que todavía puede regresar. */
  disponible: number;
  /** A cómo queda el kilo a favor: lo que de verdad se cobró por kilo. */
  precio_kg: number;
  /** Lo suelto entra como conos (paquete o cono) o como kilos (hilo por kilo). */
  sueltos_como: 'conos' | 'kilos';
  bultos: BultoDevolvible[];
}

/** Lo que se puede devolver de una nota (GET /pedidos/:id/devolucion). */
export interface PreviaDevolucion {
  pedido_id: number;
  numero_pedido: string;
  estado: EstadoPedido;
  almacen_id: number;
  almacen?: string | null;
  cliente_id?: number | null;
  cliente?: string | null;
  /** Entregada y viva: se puede devolver. */
  se_puede: boolean;
  lineas: LineaDevolvible[];
  saldo_favor: number;
  deuda: { credito: number; notas: number; total: number };
  /**
   * Lo que todavía debe ESTA venta (fiada o nota pendiente de pago). Lo que
   * regrese se descuenta de ella primero, sin preguntar (2026-10-14).
   */
  debe_esta?: number;
  debe_esta_tipo?: 'credito' | 'nota' | null;
}

/** Lo que se manda al registrar la devolución. */
export interface DevolverInput {
  /** Solo si la venta no tenía cliente: a quién se le pone el saldo a favor. */
  cliente_id?: number;
  /** 'favor': se queda para sus compras; 'deuda': se descuenta de lo que debe. */
  destino: 'favor' | 'deuda';
  notas?: string;
  lineas: { detalle_id: number; codigos?: string[]; kg_sueltos?: number; conos?: number }[];
}

/** La devolución ya registrada. */
export interface ResultadoDevolucion {
  devolucion_id: number;
  folio: string;
  pedido_id: number;
  numero_pedido: string;
  cliente_id: number;
  cliente: string;
  total: number;
  kg: number;
  aplicado_a_deuda: number;
  /** De eso, lo que se descontó de ESTA venta (la que todavía se debía). */
  descontado_de_esta?: number;
  aplicaciones: { a: 'nota' | 'credito'; monto: number; numero_pedido?: string; pagada?: boolean; de_esta?: boolean }[];
  saldo_favor: number;
}

/** Una devolución de la nota, como la trae su detalle. */
export interface DevolucionHecha {
  id: number;
  folio: string;
  total: number;
  aplicado_a_deuda: number;
  notas?: string | null;
  creado_en: string;
  cliente_id: number;
  cliente?: string | null;
  nombre_comercial?: string | null;
  usuario?: string | null;
  lineas: { detalle_id: number; hilo: string; como: string; kg: number; piezas?: number | null; importe: number; codigos: string[] }[];
  /** El saldo a favor que tiene HOY quien recibió la devolución (para su ticket). */
  saldo_favor_hoy?: number | null;
}
