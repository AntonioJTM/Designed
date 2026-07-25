// Modelos de nómina semanal del personal.
// Los montos DECIMAL llegan del backend como string (ver config/db.js).

export type EstadoPeriodoNomina = 'borrador' | 'pagado' | 'cancelado';
export type TipoConcepto = 'percepcion' | 'deduccion';
export type ClaveConcepto = 'horas_extra' | 'falta' | 'descuento' | 'otro';

/** Staff con su configuración de nómina. `en_nomina` = 0 si nunca se configuró. */
export interface EmpleadoNomina {
  usuario_id: number;
  nombre: string;
  correo: string;
  rol: string;
  usuario_activo: boolean | number;
  en_nomina: number;
  sueldo_base_semanal: string;
  paga_comision: number;
  porcentaje_comision: string;
  valor_hora_extra: string;
  activo: number;
}

export interface ConfigEmpleadoInput {
  sueldo_base_semanal?: number;
  paga_comision?: boolean;
  porcentaje_comision?: number;
  valor_hora_extra?: number;
  activo?: boolean;
}

export interface ConceptoNomina {
  id: number;
  recibo_id: number;
  tipo: TipoConcepto;
  clave: ClaveConcepto;
  descripcion?: string | null;
  cantidad?: string | null;
  importe: string;
  creado_en: string;
}

export interface ReciboNomina {
  id: number;
  periodo_id: number;
  usuario_id: number;
  usuario: string;
  rol: string;
  sueldo_base: string;
  num_pedidos: number | string;
  ventas_netas: string;
  porcentaje_comision: string;
  comision: string;
  otras_percepciones: string;
  deducciones: string;
  total_pagar: string;
  notas?: string | null;
  conceptos: ConceptoNomina[];
}

export interface PeriodoNomina {
  id: number;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_pago: string;
  estado: EstadoPeriodoNomina;
  notas?: string | null;
  creado_por?: number | null;
  creado_por_nombre?: string | null;
  creado_en: string;
  actualizado_en: string;
  recibos: ReciboNomina[];
  total_nomina: number;
}

/** Fila del listado histórico de periodos. */
export interface PeriodoResumen {
  id: number;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_pago: string;
  estado: EstadoPeriodoNomina;
  num_recibos: number | string;
  total_nomina: string;
}

/** Semana de nómina calculada por el backend (domingo → sábado). */
export interface SemanaNomina {
  fecha_inicio: string;
  fecha_fin: string;
  fecha_pago: string;
}

/** Respuesta de /nomina/periodos/actual: el periodo puede no existir aún. */
export interface SemanaActual {
  semana: SemanaNomina;
  periodo: PeriodoNomina | null;
}

/** Pedido que forma parte de la base comisionable de un empleado. */
export interface VentaComisionable {
  id: number;
  numero_pedido: string;
  canal: 'tienda_linea' | 'punto_venta';
  estado: string;
  creado_en: string;
  subtotal: string;
  descuento: string;
  impuestos: string;
  costo_envio: string;
  total: string;
  venta_neta: string;
}

export interface DesgloseVentas {
  pedidos: VentaComisionable[];
  venta_neta: number;
  num_pedidos: number;
}

export interface NuevoConcepto {
  clave: ClaveConcepto;
  tipo?: TipoConcepto;
  descripcion?: string;
  cantidad?: number;
  importe?: number;
}
