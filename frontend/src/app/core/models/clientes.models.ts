import { HabitosCliente } from './rediseno.models';
// El expediente del cliente y su crédito. Refleja `GET /api/v1/clientes/*`.
//
// Los DECIMAL de MySQL llegan como STRING. Se declaran como `string | number`
// donde pasa y la pantalla los normaliza con Number(): declararlos solo number
// haría que `.toFixed()` truene, y compararlos como texto da resultados falsos
// ('−250.00' < 0 es false en JavaScript).

type Cifra = string | number;

/** Un cliente, como lo ve el personal. */
export interface Cliente {
  id: number;
  /** El número de cliente: lo da el sistema al darlo de alta (C-0001) y no se modifica. */
  codigo?: string | null;
  nombre: string;
  /** Como le dicen de verdad. Es con lo que la tienda lo busca. */
  nombre_comercial?: string | null;
  rfc?: string | null;
  tipo_cliente_id?: number | null;
  tipo_cliente?: string | null;
  correo?: string | null;
  telefono?: string | null;
  telefono_alt?: string | null;
  direccion?: string | null;
  ciudad?: string | null;
  estado?: string | null;
  /** A dónde se le entrega (2026-10-14): uno de la lista de lugares. */
  lugar_entrega_id?: number | null;
  lugar_entrega?: string | null;
  lugar_entrega_estado?: string | null;
  como_llego?: string | null;
  fecha_nacimiento?: string | null;
  /** Desde cuándo compra DE VERDAD, no desde cuándo se capturó. */
  cliente_desde?: string | null;
  limite_credito: Cifra;
  notas?: string | null;
  activo: boolean | number;
  /** Si tiene cuenta de la tienda en línea. Los de mostrador no. */
  tiene_cuenta?: number | boolean;
  creado_en?: string;
  actualizado_en?: string;
  // --- Del listado y del expediente ---
  saldo?: Cifra;
  cargos?: Cifra;
  abonos?: Cifra;
  credito_disponible?: Cifra;
  ultimo_abono?: string | null;
  num_pedidos?: Cifra;
  total_comprado?: Cifra;
  ultima_compra?: string | null;
}

/** Lo que se manda al crear o editar. Sin `codigo`: el número lo da el sistema. */
export type ClienteInput = Partial<Omit<Cliente, 'id' | 'codigo' | 'saldo' | 'cargos' | 'abonos'>> & {
  nombre: string;
};

/**
 * Un LUGAR DE ENTREGA (2026-10-14): el municipio (o como lo conoce la tienda) y
 * su estado. Sirve para contar a cuántos clientes se les entrega en cada lugar.
 */
export interface LugarEntrega {
  id: number;
  nombre: string;
  estado: string;
  /** Clientes activos con ese lugar. */
  num_clientes?: number;
}

/** La lista de lugares con sus cuentas (Clientes → Dónde entrego). */
export interface LugaresEntrega {
  lugares: LugarEntrega[];
  clientes_activos: number;
  /** Clientes activos sin lugar de entrega. */
  sin_lugar: number;
}

/** Resumen de compras del cliente. */
export interface EstadisticasCliente {
  num_pedidos: Cifra;
  total_comprado: Cifra;
  ticket_promedio: Cifra;
  primera_compra?: string | null;
  ultima_compra?: string | null;
  pedidos_mostrador: Cifra;
  pedidos_linea: Cifra;
  kilos: Cifra;
  num_devueltos: Cifra;
  total_devuelto: Cifra;
}

/** Un color que el cliente compra, con cuánto y cuántas veces. */
export interface ColorComprado {
  producto_id: number;
  color: string;
  calibre?: string | null;
  material?: string | null;
  linea?: string | null;
  kilos: Cifra;
  importe: Cifra;
  veces: Cifra;
  ultima_vez?: string | null;
}

/** Un pedido en el historial del cliente. */
export interface PedidoDeCliente {
  id: number;
  numero_pedido: string;
  canal: string;
  metodo_entrega?: string;
  estado: string;
  subtotal: Cifra;
  descuento: Cifra;
  impuestos: Cifra;
  costo_envio: Cifra;
  total: Cifra;
  creado_en: string;
  atendio?: string | null;
  num_lineas: Cifra;
  /** Kilos de todo el pedido. */
  kilos?: Cifra;
  /** Qué se llevó, por HILO (color + calibre), del que más kilos al que menos. */
  hilos?: { producto_id: number; hilo: string; kg: Cifra }[];
  /** Con qué pagó (los reembolsados también: dicen cómo pagó lo que canceló). */
  pagado_con?: { metodo: string; monto: Cifra }[];
  /** Lo que se llevó a deber (el cargo original). */
  a_credito?: Cifra;
}

/** Un movimiento de crédito: un cargo, un abono o un ajuste. */
export interface MovimientoCredito {
  id: number;
  tipo: 'cargo' | 'abono' | 'ajuste';
  monto: Cifra;
  referencia?: string | null;
  notas?: string | null;
  creado_en: string;
  pedido_id?: number | null;
  numero_pedido?: string | null;
  metodo_pago_id?: number | null;
  metodo_pago?: string | null;
  sesion_caja_id?: number | null;
  /** Quién lo registró. */
  registro?: string | null;
  /** Se hizo en OTRA tienda (2026-10-15): se ve el monto, no el folio ni quién. */
  otra_tienda?: boolean;
}

/** El expediente completo: datos, compras, colores y crédito. */
export interface Expediente extends Cliente {
  /** Si debe: cuántos días lleva sin abonar y si ya pasó el plazo (2026-10-16). */
  dias_sin_abonar?: number | null;
  atrasado?: boolean;
  estadisticas: EstadisticasCliente;
  colores_mas_comprados: ColorComprado[];
  pedidos: PedidoDeCliente[];
  total_pedidos: number;
  credito_movimientos: MovimientoCredito[];
  total_movimientos: number;
  /** Su costumbre: ritmo, día, hora, visitas y gasto por mes (vista Resumen). */
  habitos?: HabitosCliente;
  /** Lo que le quedó a favor por devoluciones (2026-10-13). */
  saldo_favor?: number;
  saldo_favor_movimientos?: MovimientoSaldoFavor[];
  /** Cuánto debe en total: su cuenta de crédito y sus notas pendientes de pago. */
  deuda_total?: DeudaTotal;
}

/** Cuánto debe un cliente: su cuenta de crédito más sus notas pendientes de pago. */
export interface DeudaTotal {
  credito: number;
  notas: number;
  total: number;
}

/**
 * Un movimiento de su SALDO A FAVOR: lo que regresó (devolucion), lo que dejó
 * a cuenta sin nota (anticipo), lo que usó
 * para pagar (uso), lo que se descontó de lo que debía (aplicado) y lo que le
 * regresó al cancelarse una venta donde lo usó (reintegro).
 */
export interface MovimientoSaldoFavor {
  id: number;
  tipo: 'devolucion' | 'anticipo' | 'uso' | 'aplicado' | 'reintegro' | 'ajuste';
  monto: Cifra;
  notas?: string | null;
  /** Con qué dejó el dinero (un anticipo). */
  metodo?: string | null;
  referencia?: string | null;
  creado_en: string;
  pedido_id?: number | null;
  numero_pedido?: string | null;
  devolucion_id?: number | null;
  devolucion_folio?: string | null;
  registro?: string | null;
  /** Se hizo en OTRA tienda (2026-10-15): se ve el monto, no el folio ni quién. */
  otra_tienda?: boolean;
}

/** Un anticipo: dinero a cuenta, sin nota (2026-10-14). */
export interface AnticipoInput {
  efectivo?: number;
  transferencia?: number;
  /** El turno al que entra el efectivo. */
  sesion_caja_id?: number;
  referencia?: string;
  notas?: string;
}

/** Lo que pasó al descontar su saldo a favor de lo que debe. */
export interface AplicacionSaldoFavor {
  aplicado: number;
  detalle: { a: 'nota' | 'credito'; monto: number; pedido_id?: number; numero_pedido?: string; pagada?: boolean }[];
  saldo_favor: number;
  deuda_total: DeudaTotal;
}

/** Lo que contesta el ajuste a mano de su saldo a favor (2026-10-16). */
export interface AjusteSaldoFavor {
  movimiento_id: number;
  /** Lo que tenía a favor antes del ajuste. */
  tenia: number;
  /** Lo que le quedó a favor. */
  saldo_favor: number;
}

/** Estado de cuenta, para la pantalla de crédito. */
export interface EstadoDeCuenta {
  cliente: {
    id: number;
    codigo?: string | null;
    nombre: string;
    nombre_comercial?: string | null;
    telefono?: string | null;
  };
  saldo: number;
  cargos: number;
  abonos: number;
  limite_credito: number;
  credito_disponible: number;
  movimientos: MovimientoCredito[];
  total_movimientos: number;
}

/** Lo que devuelve la búsqueda rápida del mostrador. */
export interface ClienteParaVenta {
  id: number;
  codigo?: string | null;
  nombre: string;
  nombre_comercial?: string | null;
  telefono?: string | null;
  /** Su dirección: se propone cuando un pedido lo lleva el chofer. */
  direccion?: string | null;
  tipo_cliente_id?: number | null;
  tipo_cliente?: string | null;
  limite_credito: Cifra;
  saldo: Cifra;
  /** Cuánto más se le puede fiar. El cajero lo necesita AL elegirlo. */
  credito_disponible: Cifra;
  /** Lo que le quedó a favor por devoluciones: se puede usar al cobrarle. */
  saldo_favor?: Cifra;
  /** Si debe: cuántos días lleva sin abonar (2026-10-16). null si no debe. */
  dias_sin_abonar?: number | null;
  /** Debe y pasó el plazo sin abonar: la caja lo avisa y pregunta antes de fiarle. */
  atrasado?: boolean;
}

/**
 * Una nota a crédito que todavía debe y que esta persona puede pagar
 * (`GET /clientes/:id/notas-credito`). `otra_tienda`: es de una tienda que no es
 * suya (se ven si el cliente también le compra a la suya).
 */
export interface NotaCredito {
  pedido_id: number;
  numero_pedido: string;
  creado_en: string;
  almacen_id: number | null;
  almacen: string | null;
  otra_tienda: boolean;
  fiado: number;
  pagado: number;
  por_pagar: number;
}

/** Lo que debe en total y sus notas a crédito; `ocultas`, las de otras tiendas que no puede ver. */
export interface NotasCredito {
  saldo: number;
  notas: NotaCredito[];
  ocultas: number;
}

/** Un abono del cliente: a la cuenta (`monto`) o A NOTAS (`a_notas`, 2026-10-19). */
export interface AbonoInput {
  monto?: number;
  a_notas?: { pedido_id: number; monto: number }[];
  metodo_pago_id?: number;
  /** Obligatoria si el abono es en efectivo: el dinero entra al turno. */
  sesion_caja_id?: number;
  referencia?: string;
  notas?: string;
}
