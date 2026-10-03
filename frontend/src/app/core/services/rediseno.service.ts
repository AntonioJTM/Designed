import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { ClientesEnfriados } from '../models/analisis.models';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/auth.models';
import {
  Cuando,
  Deuda,
  Frecuencia,
  Gasto,
  Hoy,
  MatrizPermisos,
  PeriodoClientes,
  QueCompra,
  ResumenPedidos,
} from '../models/rediseno.models';

function data<T>(r: ApiResponse<T>): T {
  if (r.error || r.data === null) throw r.error ?? { code: 'DESCONOCIDO', message: 'Respuesta vacía' };
  return r.data;
}

/**
 * Lo que piden las pantallas nuevas del rediseño: las pestañas de Clientes,
 * Hoy, el resumen de Pedidos y Permisos.
 */
@Injectable({ providedIn: 'root' })
export class RedisenoService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  private vista<T>(vista: string, dias: PeriodoClientes): Observable<T> {
    const params = new HttpParams().set('dias', dias);
    return this.http.get<ApiResponse<T>>(`${this.base}/clientes/analisis/${vista}`, { params }).pipe(map(data));
  }

  frecuencia(dias: PeriodoClientes): Observable<Frecuencia> { return this.vista('frecuencia', dias); }
  deuda(dias: PeriodoClientes): Observable<Deuda> { return this.vista('deuda', dias); }
  queCompra(dias: PeriodoClientes): Observable<QueCompra> { return this.vista('que-compra', dias); }
  cuando(dias: PeriodoClientes): Observable<Cuando> { return this.vista('cuando', dias); }
  gasto(dias: PeriodoClientes): Observable<Gasto> { return this.vista('gasto', dias); }
  /** Los que compraban y dejaron de venir: los mismos del aviso de la campana (60 días por omisión). */
  dejaron(sinVenir: number): Observable<ClientesEnfriados> {
    const params = new HttpParams().set('sin_venir', sinVenir);
    return this.http.get<ApiResponse<ClientesEnfriados>>(`${this.base}/clientes/analisis/dejaron`, { params }).pipe(map(data));
  }

  hoy(): Observable<Hoy> {
    return this.http.get<ApiResponse<Hoy>>(`${this.base}/hoy`).pipe(map(data));
  }

  resumenPedidos(): Observable<ResumenPedidos> {
    return this.http.get<ApiResponse<ResumenPedidos>>(`${this.base}/pedidos/resumen`).pipe(map(data));
  }

  permisos(): Observable<MatrizPermisos> {
    return this.http.get<ApiResponse<MatrizPermisos>>(`${this.base}/permisos`).pipe(map(data));
  }

  guardarPermisos(rolId: number, claves: string[]): Observable<MatrizPermisos> {
    return this.http.put<ApiResponse<MatrizPermisos>>(`${this.base}/permisos/roles/${rolId}`, { claves }).pipe(map(data));
  }

  crearPuesto(nombre: string, copiarDe: number | null): Observable<MatrizPermisos> {
    return this.http
      .post<ApiResponse<MatrizPermisos>>(`${this.base}/permisos/roles`, { nombre, copiar_de: copiarDe })
      .pipe(map(data));
  }
}
