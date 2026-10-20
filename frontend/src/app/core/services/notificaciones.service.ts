import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subscription, map } from 'rxjs';
import { TiempoRealService } from './tiempo-real.service';
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

/** Un cliente que debe y lleva tiempo sin abonar. */
export interface DeudorPendiente {
  cliente_id: number;
  nombre: string;
  nombre_comercial?: string | null;
  telefono?: string | null;
  saldo: string | number;
  dias_sin_abonar: number;
}

/** Un cliente que compraba y dejó de venir. */
export interface EnfriadoPendiente {
  cliente_id: number;
  nombre: string;
  nombre_comercial?: string | null;
  telefono?: string | null;
  num_compras: string | number;
  total_comprado: string | number;
  dias_sin_venir: number;
}

/** Un cliente recién capturado al que nadie le ha autorizado crédito. */
export interface NuevoSinCredito {
  cliente_id: number;
  nombre: string;
  nombre_comercial?: string | null;
  telefono?: string | null;
  capturado: string;
  dias: number;
  compras: string | number;
}

export interface Pendientes {
  traspasos_por_enviar: TraspasoPendiente[];
  traspasos_por_recibir: TraspasoPendiente[];
  alertas_stock: number;
  /**
   * Hilos que no se pueden vender porque no tienen precio: los crea así la
   * lista completa del proveedor. Un aviso, con los primeros a la vista.
   */
  sin_precio?: {
    num: number;
    hilos: { producto_id: number; nombre: string; calibre: string | null; llego_en: string | null }[];
  };
  /** Quién debe y lleva tiempo sin abonar. */
  cobranza: {
    clientes: DeudorPendiente[];
    num_clientes: number;
    monto: number;
    dias: number;
  };
  /** Quién dejó de venir. */
  enfriados: {
    clientes: EnfriadoPendiente[];
    num_clientes: number;
    dias: number;
  };
  /** Clientes nuevos a los que hay que decidir si se les fía. */
  nuevos_sin_credito: {
    clientes: NuevoSinCredito[];
    num_clientes: number;
    dias: number;
  };
  /**
   * El WhatsApp de la tienda se desconectó (2026-10-16): la sesión se cerró desde el
   * celular, o ya enlazado no conecta desde hace 10 minutos. null si está bien.
   */
  whatsapp?: { motivo: 'sesion_cerrada' | 'sin_conexion'; desde: string | null } | null;
  /** Las solicitudes que esperan la autorización de esta persona (2026-10-19). */
  autorizaciones?: { num: number };
  /** Su clave para autorizar se apagó: alguien la escribió mal 10 veces seguidas. */
  mi_clave_apagada?: { desde: string; por: string | null } | null;
  /** Notas pendientes de pago (se llevaron la mercancía sin pagar): UN aviso. */
  notas_pendientes?: {
    num: number;
    num_clientes: number;
    monto: number;
    /** Cuándo salió la más antigua. */
    desde: string | null;
  };
  /**
   * El globo rojo. Cuenta UN aviso por asunto, no uno por cliente: con veinte
   * deudores diría "23" y dejaría de significar algo.
   */
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
  private readonly tiempoReal = inject(TiempoRealService);
  private enVivo: Subscription | null = null;

  /** Arranca el sondeo. Idempotente: llamarlo dos veces no duplica el reloj. */
  iniciar(): void {
    this.refrescar();
    // EN VIVO (2026-10-19): cuando alguien guarda algo que cambia los avisos, la
    // campana se pone al día en un par de segundos. El minuto queda de respaldo.
    this.enVivo ??= this.tiempoReal
      .cambios(['avisos', 'inventario', 'ventas', 'caja', 'traspasos', 'clientes', 'catalogo', 'autorizaciones'], 800)
      .subscribe(() => this.refrescar());
    if (this.reloj) return;
    this.reloj = setInterval(() => this.refrescar(), NotificacionesService.CADA_MS);
  }

  detener(): void {
    if (this.reloj) clearInterval(this.reloj);
    this.reloj = null;
    this.enVivo?.unsubscribe();
    this.enVivo = null;
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
