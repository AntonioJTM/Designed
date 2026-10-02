import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/auth.models';
import {
  ConfiguracionTienda,
  Cotizacion,
  Direccion,
  DireccionInput,
  OpcionConfiguracion,
} from '../models/tienda.models';
import { CrearPedidoInput } from './ventas.service';

function data<T>(r: ApiResponse<T>): T {
  if (r.error || r.data === null) throw r.error ?? { code: 'DESCONOCIDO', message: 'Respuesta vacía' };
  return r.data;
}

/**
 * Lo que la tienda en línea necesita además del catálogo: las direcciones del
 * cliente, la configuración de la tienda y el desglose del pedido antes de
 * confirmarlo.
 */
@Injectable({ providedIn: 'root' })
export class TiendaService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  // ---- Direcciones del cliente autenticado ----
  direcciones(): Observable<Direccion[]> {
    return this.http.get<ApiResponse<Direccion[]>>(`${this.base}/direcciones`).pipe(map(data));
  }
  crearDireccion(body: DireccionInput): Observable<Direccion> {
    return this.http.post<ApiResponse<Direccion>>(`${this.base}/direcciones`, body).pipe(map(data));
  }

  // ---- Configuración de la tienda ----
  /** Las claves públicas: tarifa de envío, datos para depositar, dónde recoger. */
  configuracion(): Observable<ConfiguracionTienda> {
    return this.http
      .get<ApiResponse<ConfiguracionTienda>>(`${this.base}/configuracion`)
      .pipe(map(data));
  }
  /** Todas las claves con su descripción, para el formulario del panel. Solo administradores. */
  configuracionCompleta(): Observable<OpcionConfiguracion[]> {
    return this.http
      .get<ApiResponse<OpcionConfiguracion[]>>(`${this.base}/configuracion/completa`)
      .pipe(map(data));
  }
  guardarConfiguracion(cambios: Record<string, string | null>): Observable<OpcionConfiguracion[]> {
    return this.http
      .put<ApiResponse<OpcionConfiguracion[]>>(`${this.base}/configuracion`, cambios)
      .pipe(map(data));
  }

  // ---- Checkout ----
  /**
   * Lo que costaría el pedido, sin crearlo. El backend calcula envío, cupón e
   * impuestos con la misma lógica que la venta, así que el total que se muestra
   * es el que se cobra. No lleva pagos: cotizar no cobra.
   */
  cotizar(body: Omit<CrearPedidoInput, 'pagos'>): Observable<Cotizacion> {
    return this.http
      .post<ApiResponse<Cotizacion>>(`${this.base}/pedidos/cotizacion`, body)
      .pipe(map(data));
  }
}
