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

/** Lo que se manda al crear o editar. */
export type ClienteInput = Partial<Omit<Cliente, 'id' | 'saldo' | 'cargos' | 'abonos'>> & {
  nombre: string;
};

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
}

/** El expediente completo: datos, compras, colores y crédito. */
export interface Expediente extends Cliente {
  estadisticas: EstadisticasCliente;
  colores_mas_comprados: ColorComprado[];
  pedidos: PedidoDeCliente[];
  total_pedidos: number;
  credito_movimientos: MovimientoCredito[];
  total_movimientos: number;
  /** Su costumbre: ritmo, día, hora, visitas y gasto por mes (vista Resumen). */
  habitos?: HabitosCliente;
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
  tipo_cliente_id?: number | null;
  tipo_cliente?: string | null;
  limite_credito: Cifra;
  saldo: Cifra;
  /** Cuánto más se le puede fiar. El cajero lo necesita AL elegirlo. */
  credito_disponible: Cifra;
}

/** Un abono del cliente. */
export interface AbonoInput {
  monto: number;
  metodo_pago_id?: number;
  /** Obligatoria si el abono es en efectivo: el dinero entra al turno. */
  sesion_caja_id?: number;
  referencia?: string;
  notas?: string;
}
