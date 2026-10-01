import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/auth.models';
import {
  ClientesEnfriados,
  Cobranza,
  HiloMuerto,
  Margen,
  Tablero,
} from '../models/analisis.models';

function data<T>(r: ApiResponse<T>): T {
  if (r.error || r.data === null) throw r.error ?? { code: 'DESCONOCIDO', message: 'Respuesta vacía' };
  return r.data;
}

/** Filtros del tablero. Los que no se pasan usan el valor por omisión del backend. */
export interface FiltrosTablero {
  /** Cobranza: días sin abonar para considerarlo atrasado. */
  dias_aviso?: number;
  /** Clientes enfriados: días sin venir. */
  dias?: number;
  min_compras?: number;
  limite?: number;
  /** Margen: rango de fechas. */
  desde?: string;
  hasta?: string;
}

function aParams(f: FiltrosTablero = {}): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
  }
  return p;
}

/**
 * El tablero del negocio. Todo se calcula en el servidor al momento; aquí no se
 * hace aritmética sobre los datos más que para pintarlos.
 */
@Injectable({ providedIn: 'root' })
export class AnalisisService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/analisis`;

  /** Los cuatro análisis de un solo viaje. Solo administradores y gerentes. */
  tablero(f: FiltrosTablero = {}): Observable<Tablero> {
    return this.http
      .get<ApiResponse<Tablero>>(`${this.base}/tablero`, { params: aParams(f) })
      .pipe(map(data));
  }

  cobranza(f: FiltrosTablero = {}): Observable<Cobranza> {
    return this.http
      .get<ApiResponse<Cobranza>>(`${this.base}/cobranza`, { params: aParams(f) })
      .pipe(map(data));
  }

  clientesEnfriados(f: FiltrosTablero = {}): Observable<ClientesEnfriados> {
    return this.http
      .get<ApiResponse<ClientesEnfriados>>(`${this.base}/clientes-enfriados`, { params: aParams(f) })
      .pipe(map(data));
  }

  hiloMuerto(f: FiltrosTablero = {}): Observable<HiloMuerto> {
    return this.http
      .get<ApiResponse<HiloMuerto>>(`${this.base}/hilo-muerto`, { params: aParams(f) })
      .pipe(map(data));
  }

  margen(f: FiltrosTablero = {}): Observable<Margen> {
    return this.http
      .get<ApiResponse<Margen>>(`${this.base}/margen`, { params: aParams(f) })
      .pipe(map(data));
  }
}
