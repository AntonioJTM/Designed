// Modelos de nómina semanal del personal.
// Los montos DECIMAL llegan del backend como string (ver config/db.js).

export type EstadoPeriodoNomina = 'borrador' | 'pagado' | 'cancelado';
export type TipoConcepto = 'percepcion' | 'deduccion';
export type ClaveConcepto = 'horas_extra' | 'falta' | 'descuento' | 'otro';

/** Un día de su horario: 0 = domingo … 6 = sábado, horas 'HH:MM'. Un día que no viene es descanso. */
export interface DiaHorario {
  dia_semana: number;
  hora_entrada: string;
  hora_salida: string;
}

/** Saldo de vacaciones de su año vigente (desde su último aniversario). */
export interface SaldoVacaciones {
  anios: number;
  desde: string;
  hasta: string;
  corresponden: number;
  tomados: number;
  restan: number;
  proximo_aniversario: string;
  dias_proximo_anio: number;
}

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
  fecha_ingreso: string | null;
  comida_min: number;
  horario: DiaHorario[];
  activo: number;
  // Calculado por el backend a partir del horario (null sin horario).
  dias_laborales: number;
  horas_semana: number;
  salario_diario: number | null;
  valor_hora: number | null;
  valor_hora_extra_calculado: number | null;
  vacaciones: SaldoVacaciones | null;
}

export interface ConfigEmpleadoInput {
  sueldo_base_semanal?: number;
  paga_comision?: boolean;
  porcentaje_comision?: number;
  valor_hora_extra?: number;
  fecha_ingreso?: string | null;
  comida_min?: number;
  horario?: DiaHorario[];
  activo?: boolean;
}

/** Unas vacaciones registradas: `dias` son los días de trabajo del rango. */
export interface VacacionesRegistro {
  id: number;
  usuario_id: number;
  fecha_inicio: string;
  fecha_fin: string;
  dias: string;
  notas: string | null;
  creado_en: string;
  creado_por: string | null;
}

export interface VacacionesEmpleado {
  usuario_id: number;
  nombre: string;
  fecha_ingreso: string | null;
  horario: DiaHorario[];
  saldo: SaldoVacaciones | null;
  registros: VacacionesRegistro[];
}

export interface ConceptoNomina {
  id: number;
  recibo_id: number;
  tipo: TipoConcepto;
  clave: ClaveConcepto;
  descripcion?: string | null;
  cantidad?: string | null;
  fecha?: string | null;
  hora_entrada?: string | null;
  hora_salida?: string | null;
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
  // Con horario: el recibo paga por días. En null = se calculó sin horario (sueldo completo).
  dias_laborales: string | null;
  dias_trabajados: string | null;
  dias_vacaciones: string;
  salario_diario: string | null;
  valor_hora: string | null;
  pago_vacaciones: string;
  num_pedidos: number | string;
  ventas_netas: string;
  porcentaje_comision: string;
  comision: string;
  otras_percepciones: string;
  deducciones: string;
  total_pagar: string;
  notas?: string | null;
  conceptos: ConceptoNomina[];
  /** Su horario vigente: contra él se cuentan las horas extra. */
  horario: DiaHorario[];
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

/**
 * La comisión de una venta se paga UNA vez, completa, en la nómina de la semana
 * en que la venta quedó PAGADA (2026-10-07): la de contado el día que se vende;
 * la fiada, el apartado y el pedido cuando se terminan de pagar.
 */
export type TipoVentaComision = 'contado' | 'credito' | 'apartado' | 'pedido' | 'nota' | 'devolucion';

/** Una venta cuya comisión paga esta nómina (congelada en el recibo). */
export interface VentaComision {
  pedido_id: number | null;
  numero_pedido: string;
  cliente: string | null;
  tipo: TipoVentaComision;
  vendida_en: string;
  /** Cuándo quedó pagada; null = se pagó con la regla anterior (al venderla). */
  liquidada_en: string | null;
  total: number;
  /**
   * Sin IVA ni envío y sin lo que regresó: sobre esto es la comisión. En un
   * renglón 'devolucion' va en negativo (se descuenta).
   */
  venta_neta: number;
  /** Lo que regresó de la venta (sin IVA) y ya no paga comisión (2026-10-14). */
  devuelto?: number;
  comision: number;
}

/** Una venta que todavía no paga comisión (al día de hoy). */
export interface VentaPorLiquidar extends VentaComision {
  usuario_id: number;
  pagado: number;
  falta: number;
}

export interface ComisionesVendedor {
  recibo_id: number;
  usuario_id: number;
  usuario: string;
  rol: string;
  porcentaje: number;
  ventas_netas: number;
  comision: number;
  ventas: VentaComision[];
  /** Lo que se debe (fiado, apartado, pedido): su comisión se paga al liquidarse. */
  por_liquidar: VentaPorLiquidar[];
  por_liquidar_comision: number;
  por_liquidar_debe: number;
  /** Ya pagadas, pero entran en la próxima nómina que se calcule. */
  proxima_nomina: { ventas: number; devoluciones?: number; venta_neta: number; comision: number };
}

/** El reporte de comisiones de una semana. */
export interface ComisionesSemana {
  /** 'anterior': semana pagada con la regla vieja (por la fecha de venta). */
  regla: 'anterior' | 'al_liquidar';
  desde: string;
  vendedores: ComisionesVendedor[];
}

/** Horas extra de un día: a qué hora entró o salió de verdad. */
export interface NuevasHorasExtra {
  fecha: string;
  hora_entrada?: string;
  hora_salida?: string;
  descripcion?: string;
}

export interface NuevoConcepto {
  clave: ClaveConcepto;
  tipo?: TipoConcepto;
  descripcion?: string;
  cantidad?: number;
  importe?: number;
}
