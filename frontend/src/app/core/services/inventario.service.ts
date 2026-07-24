import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/auth.models';
import { Paginado, Variante } from '../models/catalogo.models';
import {
  Almacen,
  Movimiento,
  ResultadoMovimiento,
  StockItem,
  TipoMovimiento,
} from '../models/inventario.models';

function data<T>(r: ApiResponse<T>): T {
  if (r.error || r.data === null) throw r.error ?? { code: 'DESCONOCIDO', message: 'Respuesta vacía' };
  return r.data;
}

export interface FiltroStock {
  almacen_id?: number;
  variante_id?: number;
  q?: string;
  bajo_stock?: boolean;
  page?: number;
  limit?: number;
}

export interface MovimientoInput {
  variante_id: number;
  almacen_id: number;
  tipo: TipoMovimiento;
  cantidad: number;
  costo_unitario?: number | null;
  motivo?: string;
}

export interface TransferenciaInput {
  variante_id: number;
  almacen_origen_id: number;
  almacen_destino_id: number;
  cantidad: number;
  motivo?: string;
}

/** Servicio HTTP de inventario y almacenes. */
@Injectable({ providedIn: 'root' })
export class InventarioService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  almacenes(): Observable<Almacen[]> {
    return this.http.get<ApiResponse<Almacen[]>>(`${this.base}/almacenes`).pipe(map(data));
  }

  /** Búsqueda de variantes (SKU/código) para elegir en formularios. */
  buscarVariantes(q: string): Observable<Variante[]> {
    const params = new HttpParams().set('q', q).set('limit', 20);
    return this.http
      .get<ApiResponse<Paginado<Variante>>>(`${this.base}/variantes`, { params })
      .pipe(map((r) => data(r).items));
  }

  stock(f: FiltroStock = {}): Observable<Paginado<StockItem>> {
    let params = new HttpParams();
    if (f.almacen_id) params = params.set('almacen_id', f.almacen_id);
    if (f.variante_id) params = params.set('variante_id', f.variante_id);
    if (f.q) params = params.set('q', f.q);
    if (f.bajo_stock) params = params.set('bajo_stock', true);
    params = params.set('page', f.page ?? 1).set('limit', f.limit ?? 50);
    return this.http
      .get<ApiResponse<Paginado<StockItem>>>(`${this.base}/inventario`, { params })
      .pipe(map(data));
  }

  alertas(): Observable<StockItem[]> {
    return this.http.get<ApiResponse<StockItem[]>>(`${this.base}/inventario/alertas`).pipe(map(data));
  }

  movimientos(almacen_id?: number, variante_id?: number): Observable<Paginado<Movimiento>> {
    let params = new HttpParams().set('limit', 100);
    if (almacen_id) params = params.set('almacen_id', almacen_id);
    if (variante_id) params = params.set('variante_id', variante_id);
    return this.http
      .get<ApiResponse<Paginado<Movimiento>>>(`${this.base}/inventario/movimientos`, { params })
      .pipe(map(data));
  }

  registrarMovimiento(body: MovimientoInput): Observable<ResultadoMovimiento> {
    return this.http
      .post<ApiResponse<ResultadoMovimiento>>(`${this.base}/inventario/movimientos`, body)
      .pipe(map(data));
  }

  transferir(body: TransferenciaInput): Observable<unknown> {
    return this.http
      .post<ApiResponse<unknown>>(`${this.base}/inventario/transferencias`, body)
      .pipe(map(data));
  }

  configurar(body: {
    variante_id: number;
    almacen_id: number;
    stock_minimo?: number;
    stock_maximo?: number | null;
    ubicacion_fisica?: string;
  }): Observable<StockItem> {
    return this.http
      .put<ApiResponse<StockItem>>(`${this.base}/inventario/configuracion`, body)
      .pipe(map(data));
  }
}
