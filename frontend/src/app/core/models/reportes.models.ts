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

/**
 * Un hilo (color + calibre) en "Venta por color": todas sus presentaciones
 * sumadas, en kilos. Los porcentajes van de 0 a 100 con dos decimales, o en
 * null cuando no hay contra qué medir.
 */
export interface HiloVentaColor {
  producto_id: number;
  color: string;
  calibre: string | null;
  material: string | null;
  linea: string | null;
  /** Kilos que salieron en el rango. */
  kg_vendidos: number;
  /** Lo que se cobró por esos kilos, sin IVA. */
  importe: number;
  /** Sus kilos contra TODO lo vendido en el rango (todos los hilos). */
  pct_del_periodo: number | null;
  /** Kilos vendidos desde siempre. */
  vendido_total: number;
  /** Lo que queda hoy, en todos los almacenes. */
  existencia: number;
  /** Lo vendido desde siempre contra eso más lo que queda. */
  pct_vendido: number | null;
  /** 'YYYY-MM-DD' de su última venta, o null si nunca se ha vendido. */
  ultima_venta: string | null;
}

export interface ReporteVentaColor {
  rango: RangoFechas;
  q: string | null;
  /** Lo vendido en el rango por TODOS los hilos: contra esto se mide el %. */
  periodo: { kg_vendidos: number; importe: number };
  /** Los hilos de la lista (con la búsqueda, si la hay). */
  totales: {
    kg_vendidos: number;
    importe: number;
    pct_del_periodo: number | null;
    vendido_total: number;
    existencia: number;
    pct_vendido: number | null;
    num_hilos: number;
    num_con_venta: number;
  };
  hilos: HiloVentaColor[];
}
