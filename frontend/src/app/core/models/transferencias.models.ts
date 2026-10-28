/**
 * TRANSFERENCIAS (2026-10-20): todo lo que entró por transferencia —ventas,
 * pagos de notas, abonos y anticipos— con a qué cuenta llegó, si ya se vio en
 * el banco y si se facturó.
 */

/** Una cuenta de banco a la que se le puede transferir (para elegirla al cobrar). */
export interface CuentaDeposito {
  id: number;
  banco: string;
  titular: string | null;
  /** Los últimos 4 números de la cuenta o la CLABE, para distinguir dos del mismo banco. */
  ultimos: string | null;
}

/** 'regreso' (2026-10-26): lo abonado que se le regresó por el banco al cancelar una venta a crédito. */
export type FuenteTransferencia = 'pago' | 'abono' | 'anticipo' | 'regreso';
export type EstadoTransferencia = 'por_revisar' | 'procesada';
/** De qué es: venta, nota pendiente, nota en espera, abono, anticipo o lo que se le regresó. */
export type DeTransferencia = 'venta' | 'nota' | 'espera' | 'abono' | 'anticipo' | 'regreso';

export interface Transferencia {
  /** "pago-12", "abono-5", "anticipo-3". */
  clave: string;
  fuente: FuenteTransferencia;
  fuente_id: number;
  fecha: string;
  importe: number;
  /** El número de operación (folio del banco). */
  referencia: string | null;
  cliente_id: number | null;
  cliente: string | null;
  cliente_codigo: string | null;
  de: DeTransferencia;
  /** La venta se canceló o se devolvió y el dinero se le regresó: no suma. */
  cancelada: boolean;
  /** La venta se canceló y el dinero quedó a su saldo a favor: sigue en el banco y suma (2026-10-26). */
  a_favor?: boolean;
  /** De una nota en espera que pesó menos: lo que se le regresó al entregarla; el importe es lo que llegó al banco (2026-10-26). */
  regresado?: number | null;
  /** Las ventas que pagó (un abono a varias notas trae varias). */
  ventas: { id: number; folio: string; estado: string }[];
  /** El material de lo que se llevó ("ACRILAN, VISCOSA"). */
  materiales: string | null;
  cuenta_bancaria_id: number | null;
  cuenta: string | null;
  cuenta_ultimos: string | null;
  estado: EstadoTransferencia;
  facturada: boolean;
  revisada_por: string | null;
  revisada_en: string | null;
  facturada_por: string | null;
  facturada_en: string | null;
}

export interface CifrasTransferencias {
  cuantas: number;
  importe: number;
  por_revisar: number;
  importe_por_revisar: number;
  importe_procesado: number;
  sin_facturar: number;
  importe_sin_facturar: number;
  sin_cuenta: number;
  /** Las de ventas canceladas: NO suman en las demás cifras (2026-10-26). */
  canceladas: number;
  importe_cancelado: number;
  /** Lo que se le regresó por el banco al cancelar: ya va restado del importe (2026-10-26). */
  regresos?: number;
  importe_regresado?: number;
  /** De ventas canceladas que YA se habían facturado: hay que cancelar su factura. */
  facturadas_canceladas?: number;
  importe_facturadas_canceladas?: number;
}

export interface ListaTransferencias {
  items: Transferencia[];
  total: number;
  cifras: CifrasTransferencias;
  /** Lo que llegó a cada cuenta (id null = sin cuenta). */
  /** `regresado`: lo que se le regresó por el banco desde esa cuenta (ya restado del importe, 2026-10-26). */
  por_cuenta: { id: number | null; banco: string | null; ultimos: string | null; cuantas: number; importe: number; regresado?: number }[];
  limit: number;
  offset: number;
  hay_mas: boolean;
}

export interface FiltrosTransferencias {
  desde?: string;
  hasta?: string;
  q?: string;
  /** Una cuenta, o 'sin' = las que no dicen a qué cuenta llegaron. */
  cuenta?: number | 'sin';
  estado?: EstadoTransferencia;
  facturada?: boolean;
  de?: DeTransferencia;
  offset?: number;
}

export interface CambiosTransferencia {
  cuenta_bancaria_id?: number | null;
  referencia?: string | null;
  estado?: EstadoTransferencia;
  facturada?: boolean;
}
