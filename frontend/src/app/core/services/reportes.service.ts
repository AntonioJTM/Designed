import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/auth.models';
import { MasVendido, PorReabastecer, ReporteCortes, ReporteVentas } from '../models/reportes.models';

function data<T>(r: ApiResponse<T>): T {
  if (r.error || r.data === null) throw r.error ?? { code: 'DESCONOCIDO', message: 'Respuesta vacía' };
  return r.data;
}

function rangoParams(desde?: string, hasta?: string): HttpParams {
  let p = new HttpParams();
  if (desde) p = p.set('desde', desde);
  if (hasta) p = p.set('hasta', hasta);
  return p;
}

/** Servicio HTTP de reportes. */
@Injectable({ providedIn: 'root' })
export class ReportesService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  ventas(desde?: string, hasta?: string): Observable<ReporteVentas> {
    return this.http
      .get<ApiResponse<ReporteVentas>>(`${this.base}/reportes/ventas`, { params: rangoParams(desde, hasta) })
      .pipe(map(data));
  }

  masVendidos(limite = 10): Observable<MasVendido[]> {
    const params = new HttpParams().set('limite', limite);
    return this.http
      .get<ApiResponse<MasVendido[]>>(`${this.base}/reportes/mas-vendidos`, { params })
      .pipe(map(data));
  }

  porReabastecer(): Observable<PorReabastecer[]> {
    return this.http
      .get<ApiResponse<PorReabastecer[]>>(`${this.base}/reportes/por-reabastecer`)
      .pipe(map(data));
  }

  cortesCaja(desde?: string, hasta?: string): Observable<ReporteCortes> {
    return this.http
      .get<ApiResponse<ReporteCortes>>(`${this.base}/reportes/cortes-caja`, { params: rangoParams(desde, hasta) })
      .pipe(map(data));
  }
}
