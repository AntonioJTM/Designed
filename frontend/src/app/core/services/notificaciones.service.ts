import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/auth.models';

/** Un traspaso esperando que alguien lo atienda. */
export interface TraspasoPendiente {
  id: number;
  folio: string;
  almacen_origen: string;
  almacen_destino: string;
  usuario?: string | null;
  enviado_por?: string | null;
  num_lineas: number | string;
  kg: string | number;
  creado_en?: string;
  enviado_en?: string;
}

export interface Pendientes {
  traspasos_por_enviar: TraspasoPendiente[];
  traspasos_por_recibir: TraspasoPendiente[];
  alertas_stock: number;
  total: number;
}

/**
 * La campana del panel. Son pendientes VIVOS —se calculan de la base— no un buzón
 * con mensajes leídos: si la sucursal de Moroleón pide mercancía, el aviso está
 * ahí hasta que alguien la surte.
 *
 * Se refresca cada minuto y también a mano, para que al surtir un traspaso el
 * número baje sin recargar la página.
 */
@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** Cada cuánto se vuelve a preguntar. Un minuto es suficiente para una tienda. */
  private static readonly CADA_MS = 60_000;

  readonly pendientes = signal<Pendientes | null>(null);
  private reloj: ReturnType<typeof setInterval> | null = null;

  /** Arranca el sondeo. Idempotente: llamarlo dos veces no duplica el reloj. */
  iniciar(): void {
    this.refrescar();
    if (this.reloj) return;
    this.reloj = setInterval(() => this.refrescar(), NotificacionesService.CADA_MS);
  }

  detener(): void {
    if (this.reloj) clearInterval(this.reloj);
    this.reloj = null;
  }

  refrescar(): void {
    this.http
      .get<ApiResponse<Pendientes>>(`${this.base}/notificaciones`)
      .pipe(
        map((r) => {
          if (r.error || r.data === null) throw r.error;
          return r.data;
        })
      )
      .subscribe({
        next: (p) => this.pendientes.set(p),
        // Sin sesión o sin red no se hace ruido: la campana simplemente no aparece.
        error: () => {},
      });
  }
}
