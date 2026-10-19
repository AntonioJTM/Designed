import { Injectable, inject, signal } from '@angular/core';
import { Observable, Subject, auditTime, filter, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { TokenService } from './token.service';

/** Un evento tal como lo manda el servidor (formato "eventos del servidor"). */
export interface EventoServidor {
  evento: string;
  datos: string;
}

/**
 * Parte el texto que va llegando en eventos completos (`event:` + `data:`,
 * separados por una línea en blanco). Lo que todavía no termina se regresa en
 * `resto` para juntarlo con lo que llegue después. Los latidos (`: latido`) y
 * `retry:` no son eventos.
 */
export function leerEventos(texto: string): { eventos: EventoServidor[]; resto: string } {
  const normal = texto.replace(/\r\n/g, '\n');
  const partes = normal.split('\n\n');
  const resto = partes.pop() ?? '';
  const eventos: EventoServidor[] = [];
  for (const bloque of partes) {
    let evento = 'message';
    const datos: string[] = [];
    for (const linea of bloque.split('\n')) {
      if (linea.startsWith('event:')) evento = linea.slice(6).trim();
      else if (linea.startsWith('data:')) datos.push(linea.slice(5).replace(/^ /, ''));
    }
    if (datos.length) eventos.push({ evento, datos: datos.join('\n') });
  }
  return { eventos, resto };
}

/** "Algo cambió" de cualquier tipo: lo que se avisa al volver la conexión. */
export const TODO = '*';

/**
 * EL SISTEMA EN TIEMPO REAL (2026-10-19: "quiero que todo el sistema funcione en
 * tiempo real con sockets"). Una conexión en vivo con el servidor
 * (`GET /tiempo-real`, eventos del servidor): cuando alguien guarda algo, llega
 * qué TIPO de cosa cambió (inventario, caja, ventas…) y las pantallas abiertas
 * vuelven a pedir lo suyo. El aviso no trae datos: cada pantalla los pide con
 * sus permisos de siempre (cada quien, sus tiendas).
 *
 * Va con `fetch` y no con EventSource porque EventSource no deja mandar el
 * token en el encabezado (tendría que ir en la dirección y quedaría en las
 * bitácoras del servidor). Si se cae, vuelve a conectar sola (2 s, 4 s… hasta
 * 30 s) y al volver avisa "cambió todo", porque pudo perderse algo.
 *
 * Lo que hace ESTA pestaña no se le avisa a ella misma (`X-Pestana`): ya se
 * recargó sola al guardar.
 */
@Injectable({ providedIn: 'root' })
export class TiempoRealService {
  private readonly tokens = inject(TokenService);
  /** Quién es esta pestaña; va en cada petición (interceptor) como `X-Pestana`. */
  readonly pestana = Math.random().toString(36).slice(2) + Date.now().toString(36);
  /** Si la conexión en vivo está abierta. */
  readonly conectado = signal(false);

  private readonly cambios$ = new Subject<string[]>();
  private control: AbortController | null = null;
  private reintento: ReturnType<typeof setTimeout> | null = null;
  private espera = 2000;
  private yaConecto = false;

  /** Abre la conexión (una por pestaña). Se llama al entrar al panel. */
  iniciar(): void {
    if (this.control || this.reintento) return;
    void this.conectar();
  }

  /** La cierra (al salir de la sesión). */
  detener(): void {
    if (this.reintento) clearTimeout(this.reintento);
    this.reintento = null;
    this.control?.abort();
    this.control = null;
    this.yaConecto = false;
    this.conectado.set(false);
  }

  /**
   * Avisa cuando OTRA pantalla cambió algo de esos tipos. Junta en una sola
   * recarga los avisos que llegan dentro de `pausaMs` desde el primero (una venta
   * avisa inventario, caja y ventas a la vez). No espera a que haya silencio: con
   * avisos cada 2 s y una pausa de 3 s, una pantalla pesada no se recargaría nunca.
   */
  cambios(tipos: string[], pausaMs = 400): Observable<void> {
    return this.cambios$.pipe(
      filter((ts) => ts.includes(TODO) || ts.some((t) => tipos.includes(t))),
      auditTime(pausaMs),
      map(() => undefined)
    );
  }

  /** Para las pruebas y para quien recibe un aviso por otro lado. */
  recibir(tipos: string[], origen: string | null = null): void {
    if (origen && origen === this.pestana) return;
    this.cambios$.next(tipos);
  }

  private async conectar(): Promise<void> {
    const token = this.tokens.token();
    if (!token) return;
    const control = new AbortController();
    this.control = control;
    try {
      const r = await fetch(`${environment.apiUrl}/tiempo-real`, {
        // Con su pestaña: el servidor no le manda lo que ella misma guardó.
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream', 'X-Pestana': this.pestana },
        signal: control.signal,
        cache: 'no-store',
      });
      // Sesión vencida o sin permiso: no se insiste; al volver a entrar se abre otra.
      if (r.status === 401 || r.status === 403) {
        this.control = null;
        return;
      }
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      this.conectado.set(true);
      this.espera = 2000;
      // Al volver después de una caída pudo perderse algo: que todo se recargue.
      if (this.yaConecto) this.cambios$.next([TODO]);
      this.yaConecto = true;
      const lector = r.body.getReader();
      const dec = new TextDecoder();
      let pendiente = '';
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        pendiente += dec.decode(value, { stream: true });
        const { eventos, resto } = leerEventos(pendiente);
        pendiente = resto;
        for (const e of eventos) {
          if (e.evento !== 'cambio') continue;
          try {
            const d = JSON.parse(e.datos) as { tipos?: string[] };
            this.recibir(d.tipos ?? []);
          } catch {
            /* un aviso que no se entiende se ignora */
          }
        }
      }
    } catch {
      if (control.signal.aborted) return;
    } finally {
      this.conectado.set(false);
    }
    // Se cayó (el servidor se reinició, se fue el internet…): volver a intentar.
    if (this.control === control) {
      this.control = null;
      this.reintento = setTimeout(() => {
        this.reintento = null;
        this.iniciar();
      }, this.espera);
      this.espera = Math.min(this.espera * 2, 30000);
    }
  }
}
