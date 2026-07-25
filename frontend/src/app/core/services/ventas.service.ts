import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/auth.models';
import { Paginado } from '../models/catalogo.models';
import {
  Caja,
  CanalVenta,
  EstadoPedido,
  MetodoPago,
  Pedido,
  SesionCaja,
} from '../models/ventas.models';

function data<T>(r: ApiResponse<T>): T {
  if (r.error || r.data === null) throw r.error ?? { code: 'DESCONOCIDO', message: 'Respuesta vacía' };
  return r.data;
}

/** Como `data`, pero `null` es un valor válido (no un error). */
function dataNullable<T>(r: ApiResponse<T>): T | null {
  if (r.error) throw r.error;
  return r.data;
}

export interface ItemPedido {
  variante_id: number;
  cantidad: number;
  descuento?: number;
}
export interface PagoPedido {
  metodo_pago_id: number;
  monto: number;
  referencia_transaccion?: string;
}
export interface CrearPedidoInput {
  canal: CanalVenta;
  sesion_caja_id?: number;
  /** Lista de precios a aplicar. Sin esto se cobra el precio público. */
  tipo_cliente_id?: number;
  almacen_id?: number;
  cliente_id?: number;
  cupon_codigo?: string;
  costo_envio?: number;
  notas?: string;
  items: ItemPedido[];
  pagos?: PagoPedido[];
}

/** Servicio HTTP de ventas (pedidos) y caja. */
@Injectable({ providedIn: 'root' })
export class VentasService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  // ---- Caja ----
  cajas(): Observable<Caja[]> {
    return this.http.get<ApiResponse<Caja[]>>(`${this.base}/caja/cajas`).pipe(map(data));
  }
  /** Alta de caja. Solo administradores. */
  crearCaja(body: { almacen_id: number; nombre: string; activo?: boolean }): Observable<Caja> {
    return this.http.post<ApiResponse<Caja>>(`${this.base}/caja/cajas`, body).pipe(map(data));
  }
  /** Edición de caja (renombrar, cambiar almacén, activar/desactivar). Solo administradores. */
  actualizarCaja(
    id: number,
    body: { almacen_id?: number; nombre?: string; activo?: boolean }
  ): Observable<Caja> {
    return this.http.put<ApiResponse<Caja>>(`${this.base}/caja/cajas/${id}`, body).pipe(map(data));
  }
  /** Solo se permite si la caja nunca abrió turno. Solo administradores. */
  eliminarCaja(id: number): Observable<unknown> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/caja/cajas/${id}`).pipe(map(data));
  }
  sesionAbierta(caja_id: number): Observable<SesionCaja | null> {
    const params = new HttpParams().set('caja_id', caja_id);
    return this.http
      .get<ApiResponse<SesionCaja | null>>(`${this.base}/caja/sesiones/abierta`, { params })
      .pipe(map(dataNullable));
  }
  abrirSesion(caja_id: number, monto_inicial: number): Observable<SesionCaja> {
    return this.http
      .post<ApiResponse<SesionCaja>>(`${this.base}/caja/sesiones`, { caja_id, monto_inicial })
      .pipe(map(data));
  }
  obtenerSesion(id: number): Observable<SesionCaja> {
    return this.http.get<ApiResponse<SesionCaja>>(`${this.base}/caja/sesiones/${id}`).pipe(map(data));
  }
  cerrarSesion(id: number, monto_final: number): Observable<SesionCaja> {
    return this.http
      .post<ApiResponse<SesionCaja>>(`${this.base}/caja/sesiones/${id}/cerrar`, { monto_final })
      .pipe(map(data));
  }

  // ---- Pedidos ----
  metodosPago(): Observable<MetodoPago[]> {
    return this.http.get<ApiResponse<MetodoPago[]>>(`${this.base}/opciones/metodos-pago`).pipe(map(data));
  }
  crearPedido(body: CrearPedidoInput): Observable<Pedido> {
    return this.http.post<ApiResponse<Pedido>>(`${this.base}/pedidos`, body).pipe(map(data));
  }
  listarPedidos(f: { canal?: CanalVenta; estado?: EstadoPedido; page?: number } = {}): Observable<Paginado<Pedido>> {
    let params = new HttpParams();
    if (f.canal) params = params.set('canal', f.canal);
    if (f.estado) params = params.set('estado', f.estado);
    params = params.set('page', f.page ?? 1).set('limit', 50);
    return this.http.get<ApiResponse<Paginado<Pedido>>>(`${this.base}/pedidos`, { params }).pipe(map(data));
  }
  obtenerPedido(id: number): Observable<Pedido> {
    return this.http.get<ApiResponse<Pedido>>(`${this.base}/pedidos/${id}`).pipe(map(data));
  }
  misPedidos(): Observable<Paginado<Pedido>> {
    const params = new HttpParams().set('limit', 50);
    return this.http.get<ApiResponse<Paginado<Pedido>>>(`${this.base}/pedidos/mis`, { params }).pipe(map(data));
  }
  cambiarEstado(id: number, estado: EstadoPedido): Observable<Pedido> {
    return this.http
      .patch<ApiResponse<Pedido>>(`${this.base}/pedidos/${id}/estado`, { estado })
      .pipe(map(data));
  }
}
