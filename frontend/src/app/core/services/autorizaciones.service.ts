import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/auth.models';
import { Autorizacion, ListaAutorizaciones, VistaAutorizaciones } from '../models/autorizaciones.models';

function data<T>(r: ApiResponse<T>): T {
  if (r.error || r.data === null) throw r.error ?? { code: 'DESCONOCIDO', message: 'Respuesta vacía' };
  return r.data;
}

/** Las solicitudes de autorización (2026-10-19): verlas, aceptarlas, rechazarlas o retirarlas. */
@Injectable({ providedIn: 'root' })
export class AutorizacionesService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/autorizaciones`;

  listar(vista: VistaAutorizaciones): Observable<ListaAutorizaciones> {
    return this.http.get<ApiResponse<ListaAutorizaciones>>(this.base, { params: { vista } }).pipe(map(data));
  }

  /** La acepta: el sistema la hace en ese momento (si ya no se puede, 409 y sigue pendiente). */
  /** `ajustes`: autorizar MENOS de lo pedido (un pedido a otra tienda: `{ items: [{ variante_id, paquetes }] }`). */
  /** `ajustes`: lo que cambia quien autoriza (de un pedido, cuánto de cada hilo; de un tipo de gasto, su límite). */
  aprobar(
    id: number,
    ajustes?: { items: { variante_id: number; paquetes?: number; cantidad?: number }[] } | { limite: number | null }
  ): Observable<Autorizacion> {
    return this.http.post<ApiResponse<Autorizacion>>(`${this.base}/${id}/aprobar`, ajustes ? { ajustes } : {}).pipe(map(data));
  }

  rechazar(id: number, motivo: string): Observable<Autorizacion> {
    return this.http.post<ApiResponse<Autorizacion>>(`${this.base}/${id}/rechazar`, { motivo }).pipe(map(data));
  }

  /** "Mi clave para autorizar": la pone o la cambia quien tiene la sesión, con su contraseña. */
  fijarMiClave(contrasena: string, clave: string): Observable<{ tiene_clave_autorizacion: boolean }> {
    return this.http
      .put<ApiResponse<{ tiene_clave_autorizacion: boolean }>>(`${environment.apiUrl}/usuarios/perfil/clave-autorizacion`, { contrasena, clave })
      .pipe(map(data));
  }

  /** Quien la pidió la retira mientras siga pendiente. */
  cancelar(id: number): Observable<Autorizacion> {
    return this.http.post<ApiResponse<Autorizacion>>(`${this.base}/${id}/cancelar`, {}).pipe(map(data));
  }
}
