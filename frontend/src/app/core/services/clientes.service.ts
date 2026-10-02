import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/auth.models';
import { Paginado } from '../models/catalogo.models';
import {
  AbonoInput,
  Cliente,
  ClienteInput,
  ClienteParaVenta,
  EstadoDeCuenta,
  Expediente,
} from '../models/clientes.models';

function data<T>(r: ApiResponse<T>): T {
  if (r.error || r.data === null) throw r.error ?? { code: 'DESCONOCIDO', message: 'Respuesta vacía' };
  return r.data;
}

/** Cómo se ordena el listado de clientes. */
export type OrdenClientes = 'nombre' | 'saldo' | 'compras' | 'reciente' | 'nuevo';

export interface FiltrosClientes {
  q?: string;
  /** Solo los que deben. */
  con_saldo?: boolean;
  activo?: boolean;
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
    if (f.orden) p = p.set('orden', f.orden);
    p = p.set('page', f.page ?? 1).set('limit', f.limit ?? 50);
    return this.http.get<ApiResponse<Paginado<Cliente>>>(this.base, { params: p }).pipe(map(data));
  }

  /** El expediente completo: datos, compras, colores, pedidos y crédito. */
  expediente(id: number): Observable<Expediente> {
    return this.http.get<ApiResponse<Expediente>>(`${this.base}/${id}`).pipe(map(data));
  }

  /**
   * Búsqueda rápida para el mostrador. Devuelve pocos campos y pocos
   * resultados, con el crédito disponible: el cajero necesita saber AL elegirlo
   * si a esta persona se le puede fiar.
   */
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

  // ---- Crédito ----

  /**
   * Registra un abono. Si es en efectivo hace falta `sesion_caja_id`: el dinero
   * tiene que entrar al turno o el corte no cuadra.
   */
  abonar(id: number, body: AbonoInput): Observable<{ movimiento_id: number; saldo_nuevo: number }> {
    return this.http
      .post<ApiResponse<{ movimiento_id: number; saldo_nuevo: number }>>(
        `${this.base}/${id}/abonos`,
        body
      )
      .pipe(map(data));
  }

  /** Corrección manual del saldo. Positivo lo sube, negativo lo baja. Solo jefes. */
  ajustar(id: number, monto: number, notas: string): Observable<EstadoDeCuenta> {
    return this.http
      .post<ApiResponse<EstadoDeCuenta>>(`${this.base}/${id}/ajustes`, { monto, notas })
      .pipe(map(data));
  }
}
