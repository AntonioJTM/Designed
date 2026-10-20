/** Quien puede autorizar una operación aquí. */
export interface Autorizador {
  id: number;
  nombre: string;
  /** Ya puso su clave de autorización: solo así autoriza en el momento. */
  con_clave: boolean;
}

/**
 * Los permisos que AUTORIZAN algo (los `hacer:*` de las operaciones que se
 * piden). Quien tiene alguno ve "Mi clave para autorizar".
 */
export const PERMISOS_QUE_AUTORIZAN = [
  'hacer:mover_efectivo', 'hacer:cancelar_venta', 'hacer:corregir_deuda', 'hacer:cambiar_precios',
  'hacer:ajuste_merma', 'hacer:fiar_atrasado', 'hacer:dar_credito',
  // Fase 2 (2026-10-19).
  'hacer:cargar_inventario', 'hacer:surtir_sucursal', 'hacer:autorizar_vacaciones',
  // Fase 3 (2026-10-19).
  'hacer:pagar_nomina',
];

/** Un renglón que quien autoriza puede dar por MENOS (un pedido a otra tienda). */
export interface LineaAjuste {
  variante_id: number;
  hilo: string;
  unidad: 'paquetes' | 'kg';
  pedido: number;
  /** Cuántos hay libres en el origen (null si quien mira no ve ese almacén). */
  en_origen: number | null;
}

export interface DetalleAjuste {
  /** El almacén que surte. */
  origen?: string;
  lineas?: LineaAjuste[];
  /** Pagar una nómina (fase 3): cada recibo con su total, solo para mirar. */
  /** `dias` en null: sin horario, se paga la semana completa. */
  recibos?: { nombre: string; dias: number | null; total: number }[];
  total?: number;
}

/** Lo que dice el servidor cuando una operación necesita autorización (428). */
export interface NecesitaAutorizacion {
  operacion: string;
  nombre: string;
  /** Lo que se pide, en palabras: "Sacar $500.00 de Caja Moroleón · «luz»". */
  resumen: string;
  /** No se deja pedir para después: solo con la clave de quien autoriza, ahí mismo. */
  solo_en_el_momento: boolean;
  autorizadores: Autorizador[];
}

export type EstadoAutorizacion = 'pendiente' | 'aprobando' | 'aprobada' | 'rechazada' | 'cancelada' | 'vencida' | 'cerrada';

/** Una solicitud de autorización (2026-10-19). */
export interface Autorizacion {
  id: number;
  operacion: string;
  operacion_nombre: string;
  estado: EstadoAutorizacion;
  resumen: string;
  almacenes: number[] | null;
  solicitante_id: number;
  solicitante: string;
  solicitado_en: string;
  autorizador_id: number | null;
  autorizador: string | null;
  /** Se autorizó con la clave de quien autoriza, en la pantalla de quien pidió. */
  en_el_momento: boolean;
  resuelto_en: string | null;
  /** Por qué se rechazó. */
  motivo: string | null;
  /** Por qué no se pudo hacer la última vez que se aceptó. */
  ultimo_error: string | null;
  /** Se estaba haciendo cuando se interrumpió: hay que revisar si se hizo (solo se cierra). */
  interrumpida: boolean;
  /** De qué tiendas es. */
  tiendas: string[];
  /** Se puede autorizar MENOS de lo pedido (fase 2). */
  ajustable: boolean;
  /** Sus renglones, para ajustarlos (solo en "Por autorizar"). */
  detalle?: DetalleAjuste | null;
  /** Lo que se autorizó si fue menos de lo pedido. */
  nota_aprobacion: string | null;
  /** Lo que se le avisó a quien la pidió (el WhatsApp de sus vacaciones). */
  aviso: string | null;
}

export type VistaAutorizaciones = 'por_autorizar' | 'mias' | 'historial';

export interface ListaAutorizaciones {
  vista: VistaAutorizaciones;
  /** Cuántas esperan la autorización de esta persona. */
  por_autorizar: number;
  filas: Autorizacion[];
}
