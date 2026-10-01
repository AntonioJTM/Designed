// Modelos del tablero del negocio: cobranza, clientes que no vuelven, hilo
// parado y margen. Reflejan lo que devuelve `GET /api/v1/analisis/*`.
//
// Los números llegan como string cuando MySQL los da de un DECIMAL y como
// number cuando el backend los calculó en JS. Se declaran como `string | number`
// donde pasa, y la pantalla los normaliza con Number(): fingir que son solo
// number haría que `.toFixed()` truene en tiempo de ejecución.

type Cifra = string | number;

/** Un cliente que debe, con su antigüedad. */
export interface ClienteConSaldo {
  cliente_id: number;
  codigo?: string | null;
  nombre: string;
  nombre_comercial?: string | null;
  telefono?: string | null;
  limite_credito?: Cifra;
  saldo: Cifra;
  /** Desde cuándo no mueve su cuenta. Es el dato para decidir a quién llamar. */
  dias_sin_abonar: number;
  ultimo_movimiento?: string | null;
  ultimo_abono?: string | null;
  ultima_compra?: string | null;
  /** Qué tramo de antigüedad le tocó. */
  tramo?: 'al_dia' | 'un_mes' | 'dos_meses' | 'vencido';
}

export interface TramoCartera {
  clave: string;
  etiqueta: string;
  monto: number;
  clientes: number;
}

export interface Cobranza {
  total_por_cobrar: number;
  num_clientes: number;
  vencido: number;
  num_vencidos: number;
  dias_aviso: number;
  por_antiguedad: TramoCartera[];
  clientes: ClienteConSaldo[];
}

/** Un cliente que compraba y dejó de venir. */
export interface ClienteEnfriado {
  cliente_id: number;
  codigo?: string | null;
  nombre: string;
  nombre_comercial?: string | null;
  telefono?: string | null;
  cliente_desde?: string | null;
  num_compras: Cifra;
  total_comprado: Cifra;
  primera_compra: string;
  ultima_compra: string;
  dias_sin_venir: number;
  /** Cada cuántos días compraba. `null` si solo tiene una compra. */
  cada_cuantos_dias?: number | null;
  /** Cuántas veces su propio ritmo lleva sin venir: 3 = tres veces su costumbre. */
  veces_su_ritmo?: number | null;
  saldo: Cifra;
}

export interface ClientesEnfriados {
  dias: number;
  min_compras: number;
  num_clientes: number;
  /** Lo que compraban los que se fueron: el tamaño del hueco. */
  venta_en_riesgo: number;
  clientes: ClienteEnfriado[];
}

/** Una presentación con existencias que no se mueven. */
export interface HiloParado {
  producto_id: number;
  color: string;
  calibre?: string | null;
  material?: string | null;
  linea?: string | null;
  variante_id: number;
  sku: string;
  presentacion?: string | null;
  tipo_presentacion?: string;
  precio: Cifra;
  costo?: Cifra | null;
  kilos: Cifra;
  ultima_salida?: string | null;
  ultima_entrada?: string | null;
  kg_vendidos_historico?: Cifra;
  dias_parado: number;
  /** MySQL devuelve los booleanos como 0/1. */
  nunca_vendido: number | boolean;
  dinero_parado: Cifra;
  /** Con qué se valoró. Si es `precio_venta`, la cifra NO es el dinero inmovilizado real. */
  valorado_a: 'costo' | 'precio_venta';
}

export interface HiloMuerto {
  dias: number;
  dinero_parado: number;
  kilos_parados: number;
  num_hilos: number;
  nunca_vendidos: number;
  /** Si hay renglones sin costo, el total está inflado y hay que decirlo. */
  hay_sin_costo: boolean;
  hilos: HiloParado[];
}

/** El margen de un hilo en el periodo. */
export interface MargenHilo {
  producto_id: number;
  color: string;
  calibre?: string | null;
  material?: string | null;
  linea?: string | null;
  kilos: Cifra;
  venta: Cifra;
  costo: Cifra;
  ganancia: Cifra;
  /** Margen sobre la venta, en porcentaje. */
  margen_pct: Cifra | null;
  num_ventas: Cifra;
}

export interface Margen {
  desde: string | null;
  hasta: string | null;
  venta_analizada: number;
  ganancia: number;
  margen_pct: number | null;
  /** Cuánta venta quedó fuera por no tener costo capturado. */
  sin_costo_lineas: number;
  sin_costo_venta: number;
  hilos: MargenHilo[];
}

/** Todo el tablero, de un solo viaje. */
export interface Tablero {
  cobranza: Cobranza;
  clientes_enfriados: ClientesEnfriados;
  hilo_muerto: HiloMuerto;
  margen: Margen;
}
