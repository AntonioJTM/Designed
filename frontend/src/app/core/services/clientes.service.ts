import { Injectable, inject } from '@angular/core';
import { conClave } from '../clave-unica';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/auth.models';
import { Paginado } from '../models/catalogo.models';
import {
  AbonoInput,
  NotasCredito,
  AnticipoInput,
  AplicacionSaldoFavor,
  AjusteSaldoFavor,
  Cliente,
  ClienteInput,
  ClienteParaVenta,
  ColorComprado,
  EstadoDeCuenta,
  Expediente,
  LugarEntrega,
  LugaresEntrega,
} from '../models/clientes.models';
import { TicketAbonoCuenta, TicketAnticipo } from '../models/tickets.models';

/** Lo que devuelve un anticipo: `movimiento_id` es con lo que se pide su ticket. */
export interface ResultadoAnticipo {
  movimiento_id: number;
  total: number;
  saldo_favor: number;
  efectivo: number;
  transferencia: number;
}

function data<T>(r: ApiResponse<T>): T {
  if (r.error || r.data === null) throw r.error ?? { code: 'DESCONOCIDO', message: 'Respuesta vacía' };
  return r.data;
}

/** Cómo se ordena el listado de clientes. */
export type OrdenClientes = 'nombre' | 'saldo' | 'compras' | 'reciente' | 'nuevo' | 'numero';

export interface FiltrosClientes {
  q?: string;
  /** Solo los que deben. */
  con_saldo?: boolean;
  activo?: boolean;
  /** Los de un lugar de entrega. */
  lugar_entrega_id?: number;
  /** Los que no tienen lugar de entrega. */
  sin_lugar?: boolean;
  orden?: OrdenClientes;
  page?: number;
  limit?: number;
}

/** El expediente del cliente y su crédito. */
@Injectable({ providedIn: 'root' })
export class ClientesService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/clientes`;

  listar(f: FiltrosClientes = {}): Observable<Paginado<Cliente>> {
    let p = new HttpParams();
    if (f.q) p = p.set('q', f.q);
    if (f.con_saldo) p = p.set('con_saldo', 'true');
    if (f.activo !== undefined) p = p.set('activo', String(f.activo));
    if (f.lugar_entrega_id) p = p.set('lugar_entrega_id', f.lugar_entrega_id);
    if (f.sin_lugar) p = p.set('sin_lugar', 'true');
    if (f.orden) p = p.set('orden', f.orden);
    p = p.set('page', f.page ?? 1).set('limit', f.limit ?? 50);
    return this.http.get<ApiResponse<Paginado<Cliente>>>(this.base, { params: p }).pipe(map(data));
  }

  /**
   * El expediente completo: datos, compras, colores, pedidos y crédito. Trae
   * las 20 compras más recientes; con `todasLasCompras`, todas.
   */
  expediente(id: number, todasLasCompras = false): Observable<Expediente> {
    const params = todasLasCompras ? new HttpParams().set('pedidos', 'todos') : undefined;
    return this.http.get<ApiResponse<Expediente>>(`${this.base}/${id}`, { params }).pipe(map(data));
  }

  /**
   * Búsqueda rápida para el mostrador. Devuelve pocos campos y pocos
   * resultados, con el crédito disponible: el cajero necesita saber AL elegirlo
   * si a esta persona se le puede fiar.
   */
  /** Sus 5 hilos más comprados en esta tienda: "lo que siempre lleva" (la caja). */
  loQueLleva(id: number): Observable<ColorComprado[]> {
    return this.http.get<ApiResponse<ColorComprado[]>>(`${this.base}/${id}/lo-que-lleva`).pipe(map(data));
  }

  buscar(q: string): Observable<ClienteParaVenta[]> {
    const p = new HttpParams().set('q', q);
    return this.http
      .get<ApiResponse<ClienteParaVenta[]>>(`${this.base}/buscar`, { params: p })
      .pipe(map(data));
  }

  crear(body: ClienteInput): Observable<Cliente> {
    return this.http.post<ApiResponse<Cliente>>(this.base, body).pipe(map(data));
  }

  actualizar(id: number, body: Partial<ClienteInput>): Observable<Cliente> {
    return this.http.put<ApiResponse<Cliente>>(`${this.base}/${id}`, body).pipe(map(data));
  }

  // ---- Lugares de entrega (2026-10-14) ----

  /** La lista de lugares, con cuántos clientes tiene cada uno y cuántos no tienen. */
  lugaresEntrega(): Observable<LugaresEntrega> {
    return this.http.get<ApiResponse<LugaresEntrega>>(`${this.base}/lugares-entrega`).pipe(map(data));
  }

  /** Alta de un lugar (municipio y estado). 409 LUGAR_REPETIDO si ya está. */
  crearLugar(body: { nombre: string; estado: string }): Observable<LugarEntrega> {
    return this.http.post<ApiResponse<LugarEntrega>>(`${this.base}/lugares-entrega`, body).pipe(map(data));
  }

  /** Corregir cómo se escribió un lugar; sus clientes lo siguen. */
  corregirLugar(id: number, body: { nombre: string; estado: string }): Observable<LugarEntrega> {
    return this.http.put<ApiResponse<LugarEntrega>>(`${this.base}/lugares-entrega/${id}`, body).pipe(map(data));
  }

  // ---- Crédito ----

  /**
   * Registra un abono. Si es en efectivo hace falta `sesion_caja_id`: el dinero
   * tiene que entrar al turno o el corte no cuadra.
   */
  /** Lo que debe y las notas a crédito que se pueden pagar una por una (2026-10-19). */
  notasCredito(id: number): Observable<NotasCredito> {
    return this.http.get<ApiResponse<NotasCredito>>(`${this.base}/${id}/notas-credito`).pipe(map(data));
  }

  /** `clave`: la llave de un solo uso (2026-10-20): un doble clic no abona dos veces. */
  abonar(id: number, body: AbonoInput, clave?: string): Observable<{ movimiento_id: number; saldo_nuevo: number }> {
    return this.http
      .post<ApiResponse<{ movimiento_id: number; saldo_nuevo: number }>>(
        `${this.base}/${id}/abonos`,
        body,
        conClave(clave)
      )
      .pipe(map(data));
  }

  /**
   * Descuenta su SALDO A FAVOR de lo que debe: primero sus notas pendientes de
   * pago (de la más vieja) y luego su cuenta de crédito. Sin `monto`, todo lo
   * que alcance.
   */
  /** Ajustar a mano su saldo a favor: positivo le agrega, negativo le quita (con motivo). */
  ajustarSaldoFavor(id: number, monto: number, notas: string, clave?: string): Observable<AjusteSaldoFavor> {
    return this.http
      .post<ApiResponse<AjusteSaldoFavor>>(`${this.base}/${id}/saldo-favor/ajuste`, { monto, notas }, conClave(clave))
      .pipe(map(data));
  }

  aplicarSaldoFavor(id: number, monto?: number, clave?: string): Observable<AplicacionSaldoFavor> {
    return this.http
      .post<ApiResponse<AplicacionSaldoFavor>>(`${this.base}/${id}/saldo-favor/aplicar`, monto ? { monto } : {}, conClave(clave))
      .pipe(map(data));
  }

  /**
   * Un ANTICIPO: el cliente deja dinero a cuenta, sin nota (efectivo, transferencia
   * o las dos) y le queda a favor. El efectivo necesita `sesion_caja_id`.
   */
  recibirAnticipo(id: number, body: AnticipoInput, clave?: string): Observable<ResultadoAnticipo> {
    return this.http
      .post<ApiResponse<ResultadoAnticipo>>(`${this.base}/${id}/anticipos`, body, conClave(clave))
      .pipe(map(data));
  }

  /** Los datos del ticket de un abono a su cuenta (2026-10-15). */
  ticketAbono(id: number, movimientoId: number): Observable<TicketAbonoCuenta> {
    return this.http
      .get<ApiResponse<TicketAbonoCuenta>>(`${this.base}/${id}/abonos/${movimientoId}/ticket`)
      .pipe(map(data));
  }

  /** Los datos del ticket de un anticipo (2026-10-15). */
  ticketAnticipo(id: number, movimientoId: number): Observable<TicketAnticipo> {
    return this.http
      .get<ApiResponse<TicketAnticipo>>(`${this.base}/${id}/anticipos/${movimientoId}/ticket`)
      .pipe(map(data));
  }

  /** Corrección manual del saldo. Positivo lo sube, negativo lo baja. Solo jefes. */
  ajustar(id: number, monto: number, notas: string, clave?: string): Observable<EstadoDeCuenta> {
    return this.http
      .post<ApiResponse<EstadoDeCuenta>>(`${this.base}/${id}/ajustes`, { monto, notas }, conClave(clave))
      .pipe(map(data));
  }
}
