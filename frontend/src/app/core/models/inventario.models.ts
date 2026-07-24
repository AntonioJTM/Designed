// Modelos de inventario (existencias, movimientos, almacenes).

export interface Almacen {
  id: number;
  nombre: string;
  direccion?: string | null;
  es_punto_venta: boolean | number;
  activo: boolean | number;
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
