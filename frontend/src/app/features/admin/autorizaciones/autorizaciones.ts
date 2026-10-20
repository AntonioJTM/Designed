import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AutorizacionesService } from '../../../core/services/autorizaciones.service';
import { TiempoRealService } from '../../../core/services/tiempo-real.service';
import { Autorizacion, EstadoAutorizacion, LineaAjuste, VistaAutorizaciones } from '../../../core/models/autorizaciones.models';
import { ApiError } from '../../../core/models/auth.models';
import { fechaRelativa } from '../../../shared/fecha.pipe';
import { DineroPipe } from '../../../shared/dinero.pipe';

const ESTADOS: Record<EstadoAutorizacion, { texto: string; tono: string }> = {
  pendiente: { texto: 'Esperando', tono: 'ambar' },
  aprobando: { texto: 'Haciéndose…', tono: 'info' },
  aprobada: { texto: 'Aceptada', tono: 'ok' },
  rechazada: { texto: 'Rechazada', tono: 'rojo' },
  cancelada: { texto: 'Retirada', tono: 'gris' },
  vencida: { texto: 'Venció', tono: 'gris' },
  cerrada: { texto: 'Cerrada', tono: 'gris' },
};

/**
 * AUTORIZACIONES (2026-10-19: "que se haga la solicitud y el administrador o
 * quien tenga el permiso autorice la operación"). Tres pestañas:
 *   · Por autorizar: lo que esta persona puede aceptar (hace la operación
 *     directo y ve su tienda). Aceptar la HACE en ese momento; si ya no se
 *     puede, lo dice y sigue pendiente. Rechazar pide el motivo.
 *   · Mis solicitudes: lo que pidió, con su estado; se retira mientras espera.
 *   · Historial: lo ya resuelto que pidió o que podía autorizar.
 * Se pone al día en vivo (`autorizaciones`).
 * Un pedido a otra tienda (fase 2) se puede autorizar por MENOS: "Aceptar" abre
 * sus renglones con cuánto se autoriza de cada hilo ("de esos 20, solo 10").
 */
@Component({
  selector: 'app-autorizaciones',
  imports: [FormsModule, DineroPipe],
  templateUrl: './autorizaciones.html',
  styleUrl: './autorizaciones.scss',
})
export class Autorizaciones {
  private readonly api = inject(AutorizacionesService);

  readonly vista = signal<VistaAutorizaciones>('por_autorizar');
  readonly filas = signal<Autorizacion[] | null>(null);
  readonly porAutorizar = signal(0);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  /** La que se está aceptando (el sistema la está haciendo). */
  readonly aceptando = signal<number | null>(null);
  /** La que se está rechazando: la ventana del motivo. */
  readonly rechazando = signal<Autorizacion | null>(null);
  readonly guardando = signal(false);
  motivo = '';
  /** El pedido que se está autorizando por renglones, y cuánto de cada hilo. */
  readonly ajustando = signal<Autorizacion | null>(null);
  cuanto: Record<number, number | null> = {};

  readonly PESTANAS: { clave: VistaAutorizaciones; nombre: string }[] = [
    { clave: 'por_autorizar', nombre: 'Por autorizar' },
    { clave: 'mias', nombre: 'Mis solicitudes' },
    { clave: 'historial', nombre: 'Historial' },
  ];

  constructor() {
    this.cargar();
    // EN VIVO: una solicitud nueva, aceptada o rechazada en otra computadora.
    inject(TiempoRealService)
      .cambios(['autorizaciones'])
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (!this.aceptando() && !this.rechazando() && !this.ajustando()) this.cargar(true);
      });
  }

  elegir(v: VistaAutorizaciones): void {
    if (this.vista() === v) return;
    this.vista.set(v);
    this.filas.set(null);
    this.cargar();
  }

  cargar(callado = false): void {
    const vista = this.vista();
    if (!callado) this.error.set(null);
    this.api.listar(vista).subscribe({
      next: (r) => {
        if (this.vista() !== vista) return;
        this.filas.set(r.filas);
        this.porAutorizar.set(r.por_autorizar);
      },
      error: (e) => {
        if (!callado) this.error.set(this.msg(e));
      },
    });
  }

  aceptar(a: Autorizacion): void {
    // Un pedido a otra tienda: primero cuánto se autoriza de cada hilo.
    if (a.ajustable && a.detalle?.lineas?.length) {
      this.cuanto = Object.fromEntries(a.detalle.lineas.map((l) => [l.variante_id, l.pedido]));
      this.ajustando.set(a);
      return;
    }
    this.hacer(a);
  }

  private hacer(a: Autorizacion, items?: { variante_id: number; paquetes?: number; cantidad?: number }[]): void {
    this.aceptando.set(a.id);
    this.error.set(null);
    this.mensaje.set(null);
    this.api.aprobar(a.id, items ? { items } : undefined).subscribe({
      next: (r) => {
        this.aceptando.set(null);
        this.ajustando.set(null);
        this.mensaje.set(r.nota_aprobacion ? `Aceptada y hecha. ${r.nota_aprobacion}` : `Aceptada y hecha: ${a.resumen}.`);
        this.cargar(true);
      },
      error: (e) => {
        this.aceptando.set(null);
        if (this.ajustando()) this.errorAjuste.set(this.msg(e));
        else this.error.set(this.msg(e));
        this.cargar(true);
      },
    });
  }

  readonly errorAjuste = signal<string | null>(null);

  cerrarAjuste(): void {
    if (this.aceptando() === null) {
      this.ajustando.set(null);
      this.errorAjuste.set(null);
    }
  }

  /** Lo que se autoriza de un renglón (lo escrito, o todo lo pedido). */
  vale(l: LineaAjuste): number {
    const v = this.cuanto[l.variante_id];
    return v == null || Number.isNaN(Number(v)) ? l.pedido : Number(v);
  }

  /** Un renglón mal escrito: menos de 0, más de lo pedido o paquetes con decimales. */
  malo(l: LineaAjuste): boolean {
    const v = this.vale(l);
    return v < 0 || v > l.pedido || (l.unidad === 'paquetes' && !Number.isInteger(v));
  }

  /** "Se autorizan 10 de 20 paquetes" (en palabras, para antes de aceptar). */
  resumenAjuste(a: Autorizacion): string {
    const lineas = a.detalle?.lineas ?? [];
    const paq = lineas.filter((l) => l.unidad === 'paquetes');
    const pedido = paq.reduce((s, l) => s + l.pedido, 0);
    const vale = paq.reduce((s, l) => s + this.vale(l), 0);
    if (!paq.length) return '';
    return vale === pedido ? `Se autoriza todo: ${pedido} ${pedido === 1 ? 'paquete' : 'paquetes'}.`
      : `Se autorizan ${vale} de ${pedido} paquetes.`;
  }

  ajusteValido(a: Autorizacion): boolean {
    const lineas = a.detalle?.lineas ?? [];
    return lineas.every((l) => !this.malo(l)) && lineas.some((l) => this.vale(l) > 0);
  }

  autorizarAjustado(): void {
    const a = this.ajustando();
    if (!a || !this.ajusteValido(a)) return;
    this.errorAjuste.set(null);
    const items = (a.detalle?.lineas ?? []).map((l) =>
      l.unidad === 'paquetes' ? { variante_id: l.variante_id, paquetes: this.vale(l) } : { variante_id: l.variante_id, cantidad: this.vale(l) });
    this.hacer(a, items);
  }

  abrirRechazo(a: Autorizacion): void {
    this.motivo = '';
    this.rechazando.set(a);
  }

  cerrarRechazo(): void {
    if (!this.guardando()) this.rechazando.set(null);
  }

  rechazar(): void {
    const a = this.rechazando();
    if (!a || !this.motivo.trim()) return;
    this.guardando.set(true);
    this.api.rechazar(a.id, this.motivo.trim()).subscribe({
      next: () => {
        this.guardando.set(false);
        this.rechazando.set(null);
        this.mensaje.set(`Se rechazó: ${a.resumen}.`);
        this.cargar(true);
      },
      error: (e) => {
        this.guardando.set(false);
        this.error.set(this.msg(e));
      },
    });
  }

  retirar(a: Autorizacion): void {
    this.api.cancelar(a.id).subscribe({
      next: () => {
        this.mensaje.set(`Se retiró la solicitud: ${a.resumen}.`);
        this.cargar(true);
      },
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  estado(a: Autorizacion): { texto: string; tono: string } {
    if (a.interrumpida) return { texto: 'Se interrumpió', tono: 'naranja' };
    return ESTADOS[a.estado] ?? { texto: a.estado, tono: 'gris' };
  }

  cuando(t: string | null): string {
    return fechaRelativa(t);
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
