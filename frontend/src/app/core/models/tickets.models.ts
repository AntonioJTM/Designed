/**
 * Los datos de los tickets de la cuenta del cliente (2026-10-15: "tickets de
 * anticipos y tickets de abono"). Los arma el servidor —con el libro hasta ese
 * movimiento—, así salen igual al registrarlos que al reimprimirlos.
 */

/** Quién es el cliente, como lo dice el ticket. */
export interface ClienteTicket {
  /** Para guardarle el teléfono desde la ventana de WhatsApp (2026-10-16). */
  id?: number;
  nombre: string;
  nombre_comercial?: string | null;
  codigo?: string | null;
  /** Sus teléfonos, para mandarle el ticket por WhatsApp (2026-10-16). */
  telefono?: string | null;
  telefono_alt?: string | null;
}

/** Un abono a su CUENTA de crédito (`GET /clientes/:id/abonos/:mov/ticket`). */
export interface TicketAbonoCuenta {
  id: number;
  cliente: ClienteTicket;
  fecha: string;
  monto: number;
  metodo?: string | null;
  referencia?: string | null;
  notas?: string | null;
  usuario?: string | null;
  caja?: string | null;
  debia: number;
  quedo_debiendo: number;
  debe_hoy: number;
  /** Las ventas fiadas que este abono terminó de pagar. */
  liquidadas: string[];
}

/** Un ANTICIPO: dinero a cuenta, sin nota (`GET /clientes/:id/anticipos/:mov/ticket`). */
export interface TicketAnticipo {
  id: number;
  cliente: ClienteTicket;
  fecha: string;
  /** Efectivo y/o transferencia (con su folio). */
  partes: { metodo?: string | null; monto: number; referencia?: string | null }[];
  total: number;
  notas?: string | null;
  usuario?: string | null;
  caja?: string | null;
  tenia_a_favor: number;
  quedo_a_favor: number;
  a_favor_hoy: number;
}

/** Un abono a una NOTA: pendiente de pago, en espera o apartado (`GET /pedidos/:id/pagos/:pago/ticket`). */
export interface TicketPagoNota {
  id: number;
  pedido: { id: number; numero_pedido: string; creado_en: string; total: number; de: string; almacen?: string | null };
  cliente: ClienteTicket | null;
  fecha: string;
  monto: number;
  metodo?: string | null;
  referencia?: string | null;
  llevaba_pagado: number;
  pagado: number;
  falta: number;
  falta_hoy: number;
}
