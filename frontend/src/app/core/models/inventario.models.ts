// Modelos de inventario (existencias, movimientos, almacenes).

export interface Almacen {
  id: number;
  nombre: string;
  direccion?: string | null;
  es_punto_venta: boolean | number;
  /** Solo uno puede tenerlo: es el almacén del que descuenta la tienda web. */
  es_tienda_linea: boolean | number;
  /** Solo uno puede tenerlo: es el que surte a las demás sucursales. */
  es_matriz: boolean | number;
  activo: boolean | number;
}

export interface AlmacenInput {
  nombre?: string;
  direccion?: string | null;
  es_punto_venta?: boolean;
  es_tienda_linea?: boolean;
  es_matriz?: boolean;
  activo?: boolean;
}

/** Fila de existencias por variante + almacén. Decimales llegan como string. */
export interface StockItem {
  id: number;
  variante_id: number;
  sku: string;
  producto: string;
  color?: string | null;
  almacen_id: number;
  almacen: string;
  cantidad: string;
  cantidad_reservada: string;
  disponible: string;
  stock_minimo: string;
  stock_maximo?: string | null;
  ubicacion_fisica?: string | null;
  actualizado_en: string;
}

export type TipoMovimiento = 'entrada' | 'salida' | 'ajuste' | 'devolucion' | 'merma' | 'transferencia';

export interface Movimiento {
  id: number;
  variante_id: number;
  sku: string;
  almacen_id: number;
  almacen: string;
  tipo: TipoMovimiento;
  cantidad: string;
  costo_unitario?: string | null;
  referencia_tipo?: string | null;
  referencia_id?: number | null;
  usuario_id?: number | null;
  usuario?: string | null;
  motivo?: string | null;
  creado_en: string;
  producto?: string;
  /** Unidad de la cantidad: kg para peso, pz para conos. Nunca es dinero. */
  unidad?: string;
  tipo_presentacion?: string;
  peso_kg?: string | null;
  // Descripción en lenguaje de tienda, calculada por el backend.
  concepto?: string;
  /** Folio del documento que lo originó (venta o traspaso). */
  folio?: string | null;
  /** Documento que se puede abrir desde el kardex. */
  detalle_tipo?: 'pedido' | 'traspaso' | 'conversion' | null;
  detalle_id?: number | null;
}

/** Traspaso con sus líneas, para ver qué se mandó. */
export interface TraspasoDetalle {
  id: number;
  folio: string;
  almacen_origen: string;
  almacen_destino: string;
  usuario?: string | null;
  notas?: string | null;
  creado_en: string;
  lineas: {
    variante_id: number;
    sku: string;
    producto: string;
    tipo_presentacion?: string;
    peso_kg?: string | null;
    paquetes: string | null;
    cantidad: string;
  }[];
}

export interface ResultadoMovimiento {
  movimiento_id: number;
  variante_id: number;
  almacen_id: number;
  tipo: TipoMovimiento;
  delta: number;
  saldo_anterior: number;
  saldo_nuevo: number;
}
