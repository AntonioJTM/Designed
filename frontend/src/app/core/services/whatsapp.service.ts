import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subscription, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/auth.models';

/**
 * El WhatsApp de la TIENDA enlazado al sistema con el QR (2026-10-16), para
 * mandar los tickets directo, sin abrir WhatsApp. `qr` solo llega a Configuración.
 */
export interface WhatsappTienda {
  estado: 'apagado' | 'sin_enlazar' | 'conectando' | 'esperando_qr' | 'enlazado';
  /** "+52 775 165 9032", ya enlazado. */
  numero: string | null;
  nombre: string | null;
  /** Desde cuándo está enlazado (ISO). */
  desde: string | null;
  /** Lo que pasó y hay que decir ("Se acabó el tiempo para escanear…"). */
  aviso: string | null;
  /** La imagen del QR ("data:image/png…") mientras se espera que lo escaneen. */
  qr?: string | null;
}

function data<T>(r: ApiResponse<T>): T {
  if (r.error || r.data === null) throw r.error ?? { code: 'DESCONOCIDO', message: 'Respuesta vacía' };
  return r.data;
}

/** Un ticket listo para mandarse: su PDF y con qué se manda. */
export interface PaqueteWhatsapp {
  /** "Ticket de venta POS-468D": el título de la ventana y del PDF. */
  titulo: string;
  pdf: Blob;
  /** "Ticket POS-468D.pdf" */
  archivo: string;
  /** El mensaje que acompaña al PDF en el chat. */
  mensaje: string;
  /** El nombre del cliente, si lo hay. */
  cliente: string | null;
  /** Su teléfono guardado; null si no tiene (entonces se teclea o se elige en WhatsApp). */
  telefono: string | null;
  /**
   * El cliente y sus DOS teléfonos tal como están en su expediente: si el cajero
   * escribe otro número, se le ofrece guardarlo ahí (2026-10-16).
   */
  clienteId: number | null;
  telefonoPrincipal: string | null;
  telefonoAlt: string | null;
}

/** La ventana abierta: mientras se prepara el PDF, `paquete` es null. */
export interface EnvioWhatsapp {
  /** Cambia con cada ventana que se abre: así la ventana sabe que empieza de cero. */
  id: number;
  /** Lo que se sabe antes de tener el PDF ("Ticket del abono"). */
  titulo: string;
  paquete: PaqueteWhatsapp | null;
  error: string | null;
}

/**
 * MANDAR UN TICKET POR WHATSAPP (2026-10-16). Los botones de cada pantalla
 * piden aquí que se abra la ventana (`<app-whatsapp-ticket>`, puesta UNA vez en
 * la raíz de la aplicación, como la de confirmación) y le pasan cómo preparar el
 * PDF; la ventana enseña "Preparando…", el número del cliente y el botón que baja
 * el PDF y abre su chat.
 *
 * Va en una ventana y no directo al apretar el ícono porque el navegador solo
 * deja abrir otra pestaña (el chat) en el momento en que se aprieta un botón, y
 * el PDF tarda un instante: el botón de la ventana ya lo tiene listo.
 */
@Injectable({ providedIn: 'root' })
export class WhatsappService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/whatsapp`;
  readonly actual = signal<EnvioWhatsapp | null>(null);
  private preparando?: Subscription;
  private abiertas = 0;

  abrir(titulo: string, preparar: Observable<PaqueteWhatsapp>): void {
    this.preparando?.unsubscribe();
    const envio: EnvioWhatsapp = { id: ++this.abiertas, titulo, paquete: null, error: null };
    this.actual.set(envio);
    this.preparando = preparar.subscribe({
      next: (paquete) => {
        if (this.actual() === envio) this.actual.set({ ...envio, titulo: paquete.titulo, paquete });
      },
      error: (e) => {
        if (this.actual() === envio) this.actual.set({ ...envio, error: mensajeDe(e) });
      },
    });
  }

  cerrar(): void {
    this.preparando?.unsubscribe();
    this.actual.set(null);
  }

  // ---- El WhatsApp de la tienda (2026-10-16) ----

  /** Si está enlazado (sin el QR): lo pregunta la ventana de cada ticket. */
  estadoTienda(): Observable<WhatsappTienda> {
    return this.http.get<ApiResponse<WhatsappTienda>>(`${this.base}/estado`).pipe(map(data));
  }

  /** Con el QR: Configuración, mientras se enlaza. */
  enlace(): Observable<WhatsappTienda> {
    return this.http.get<ApiResponse<WhatsappTienda>>(`${this.base}/enlace`).pipe(map(data));
  }

  enlazar(): Observable<WhatsappTienda> {
    return this.http.post<ApiResponse<WhatsappTienda>>(`${this.base}/enlazar`, {}).pipe(map(data));
  }

  desenlazar(): Observable<WhatsappTienda> {
    return this.http.post<ApiResponse<WhatsappTienda>>(`${this.base}/desenlazar`, {}).pipe(map(data));
  }

  prueba(telefono: string): Observable<{ enviado: boolean; numero: string }> {
    return this.http.post<ApiResponse<{ enviado: boolean; numero: string }>>(`${this.base}/prueba`, { telefono }).pipe(map(data));
  }

  /**
   * Manda el ticket DIRECTO desde el WhatsApp de la tienda: el PDF en crudo y lo
   * demás en cabeceras (con acentos, por eso `encodeURIComponent`).
   */
  enviar(p: PaqueteWhatsapp, telefono: string): Observable<{ enviado: boolean; numero: string }> {
    return this.http.post<ApiResponse<{ enviado: boolean; numero: string }>>(`${this.base}/enviar`, p.pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'X-Telefono': encodeURIComponent(telefono),
        'X-Archivo': encodeURIComponent(p.archivo),
        'X-Mensaje': encodeURIComponent(p.mensaje),
      },
    }).pipe(map(data));
  }
}

function mensajeDe(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return (e as { error?: { error?: { message?: string } } })?.error?.error?.message
    ?? 'No se pudo preparar el ticket. Vuelve a intentarlo.';
}
