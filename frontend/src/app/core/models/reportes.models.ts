// Modelos de reportes.

export interface RangoFechas {
  desde: string;
  hasta: string;
}

export interface ResumenVentas {
  num_pedidos: number | string;
  subtotal: string;
  descuento: string;
  impuestos: string;
  total: string;
  /** Kilos vendidos en el periodo (suma de `porDia`). */
  kilos?: number | string;
  /** De esos kilos, cuántos salieron en paquete cerrado. */
  kilos_paquete?: number | string;
}

export interface CanalVentas {
  canal: 'punto_venta' | 'tienda_linea';
  num_pedidos: number | string;
  total: string;
}

export interface DiaVentas {
  dia: string;
  num_pedidos: number | string;
  total: string;
  kilos?: string;
  kilos_paquete?: string;
}

export interface ReporteVentas {
  rango: RangoFechas;
  resumen: ResumenVentas;
  porCanal: CanalVentas[];
  porDia: DiaVentas[];
}

export interface MasVendido {
  variante_id: number;
  sku: string;
  producto: string;
  calibre?: string | null;
  tipo_presentacion?: string | null;
  /** Kilos: todo se vende por peso. El nombre viene de la vista. */
  unidades_vendidas: string;
  ingresos: string;
}

export interface PorReabastecer {
  variante_id: number;
  sku: string;
  producto: string;
  calibre?: string | null;
  tipo_presentacion?: string | null;
  almacen: string;
  cantidad: string;
  cantidad_reservada: string;
  disponible: string;
  stock_minimo: string;
}

export interface CorteCaja {
  id: number;
  caja: string;
  usuario: string;
  estado: 'abierta' | 'cerrada';
  monto_inicial: string;
  monto_esperado?: string | null;
  monto_final?: string | null;
  diferencia?: string | null;
  fecha_apertura: string;
  fecha_cierre?: string | null;
  ventas_efectivo: string;
}

export interface ReporteCortes {
  rango: RangoFechas;
  cortes: CorteCaja[];
}
