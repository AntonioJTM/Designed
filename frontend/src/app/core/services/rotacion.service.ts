import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/auth.models';
import {
  AjustesRotacion,
  HiloDetalle,
  PreviaAnteriores,
  QuePedirRotacion,
  ResumenAnteriores,
  ResumenRotacion,
  TemporadasRotacion,
} from '../models/rotacion.models';

function data<T>(r: ApiResponse<T>): T {
  if (r.error) throw r.error;
  return r.data as T;
}

/** Los parámetros que vienen (sin los vacíos). */
function params(o: Record<string, string | number | null | undefined>): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(o)) if (v != null && v !== '') p = p.set(k, String(v));
  return p;
}

/**
 * ROTACIÓN DE INVENTARIO (2026-10-22): las cuatro pestañas, los ajustes de «Qué
 * pedir» y las ventas de años anteriores. Todo en kilos.
 */
@Injectable({ providedIn: 'root' })
export class RotacionService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/rotacion`;

  resumen(almacenId: number | null, productoId: number | null): Observable<ResumenRotacion> {
    return this.http
      .get<ApiResponse<ResumenRotacion>>(`${this.base}/resumen`, { params: params({ almacen_id: almacenId, producto_id: productoId }) })
      .pipe(map(data));
  }

  temporadas(almacenId: number | null, anio: number | 'promedio' | null): Observable<TemporadasRotacion> {
    return this.http
      .get<ApiResponse<TemporadasRotacion>>(`${this.base}/temporadas`, { params: params({ almacen_id: almacenId, anio }) })
      .pipe(map(data));
  }

  /** Sin id, el que más se vende. */
  hilo(productoId: number | null): Observable<HiloDetalle> {
    return this.http.get<ApiResponse<HiloDetalle>>(`${this.base}/hilo${productoId ? '/' + productoId : ''}`).pipe(map(data));
  }

  quePedir(): Observable<QuePedirRotacion> {
    return this.http.get<ApiResponse<QuePedirRotacion>>(`${this.base}/que-pedir`).pipe(map(data));
  }

  /** El CSV para el proveedor con los hilos elegidos. */
  quePedirCsv(ids: number[]): Observable<Blob> {
    return this.http.get(`${this.base}/que-pedir.csv`, { params: params({ hilos: ids.join(',') }), responseType: 'blob' });
  }

  guardarAjustes(a: Omit<AjustesRotacion, 'confirmados'>): Observable<AjustesRotacion> {
    return this.http.put<ApiResponse<AjustesRotacion>>(`${this.base}/ajustes`, a).pipe(map(data));
  }

  anteriores(): Observable<ResumenAnteriores> {
    return this.http.get<ApiResponse<ResumenAnteriores>>(`${this.base}/ventas-anteriores`).pipe(map(data));
  }

  previaAnteriores(archivo: File): Observable<PreviaAnteriores> {
    return this.http
      .post<ApiResponse<PreviaAnteriores>>(`${this.base}/ventas-anteriores/previa`, archivo, {
        headers: { 'Content-Type': 'application/octet-stream' },
      })
      .pipe(map(data));
  }

  cargarAnteriores(archivo: File): Observable<{ cargados: number; kg: number; hilos: number; desde: string | null; hasta: string | null }> {
    return this.http
      .post<ApiResponse<{ cargados: number; kg: number; hilos: number; desde: string | null; hasta: string | null }>>(
        `${this.base}/ventas-anteriores`, archivo, { headers: { 'Content-Type': 'application/octet-stream' } })
      .pipe(map(data));
  }

  borrarAnteriores(): Observable<{ borrados: number }> {
    return this.http.delete<ApiResponse<{ borrados: number }>>(`${this.base}/ventas-anteriores`).pipe(map(data));
  }
}
