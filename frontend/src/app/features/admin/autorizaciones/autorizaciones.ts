import { Component, Injector, afterNextRender, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AutorizacionesService } from '../../../core/services/autorizaciones.service';
import { TiempoRealService } from '../../../core/services/tiempo-real.service';
import { Autorizacion, EstadoAutorizacion, LineaAjuste, VistaAutorizaciones } from '../../../core/models/autorizaciones.models';
import { ApiError } from '../../../core/models/auth.models';
import { fechaRelativa } from '../../../shared/fecha.pipe';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { folioCorto } from '../../../shared/folio.pipe';

/**
 * De qué tipo es cada operación, para leer la lista de un vistazo (2026-10-20,
 * auditoría). Una operación nueva de `autorizaciones/operaciones.js` se agrega
 * aquí; sin ella sale "Otra".
 */
export const TIPO_OPERACION: Record<string, string> = {
  mover_efectivo: 'Dinero',
  cancelar_venta: 'Dinero',
  devolucion: 'Dinero',
  corregir_deuda: 'Dinero',
  ajustar_saldo_favor: 'Dinero',
  fiar_atrasado: 'Dinero',
  dar_credito: 'Dinero',
  credito_alta: 'Dinero',
  gasto_sobre_limite: 'Dinero',
  tipo_gasto: 'Dinero',
  cambiar_precio: 'Precios',
  precio_lista: 'Precios',
  ajuste_merma: 'Inventario',
  cargar_inventario: 'Inventario',
  bulto_a_mano: 'Inventario',
  surtir_sucursal: 'Inventario',
  pagar_nomina: 'Personal',
  vacaciones: 'Personal',
};

/** Un pedazo del resumen: texto, un monto o un folio. */
export interface ParteResumen { t: string; k: 'txt' | 'dinero' | 'folio'; corto?: string; titulo?: string }

// Montos como los escribe el servidor ("$1,234.00", "-$50.00") y folios ("POS-…-79FA",
// "TRA-…", "C-0001").
const PIEZA = /(-?\$[\d,]+\.\d{2})|\b([A-Z]{1,4}-\d[0-9A-Z-]*)\b/g;

/** Parte el resumen en texto, montos y folios (sin innerHTML: lo escribió el servidor). */
export function partirResumen(texto: string | null | undefined): ParteResumen[] {
  const s = String(texto ?? '');
  const partes: ParteResumen[] = [];
  let desde = 0;
  for (const m of s.matchAll(PIEZA)) {
    const i = m.index ?? 0;
    if (i > desde) partes.push({ t: s.slice(desde, i), k: 'txt' });
    if (m[1]) partes.push({ t: m[1], k: 'dinero' });
    else partes.push({ t: m[2], k: 'folio', corto: folioCorto(m[2]), titulo: m[2] });
    desde = i + m[0].length;
  }
  if (desde < s.length) partes.push({ t: s.slice(desde), k: 'txt' });
  return partes;
}
import { ConfirmacionService } from '../../../core/services/confirmacion.service';

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
  // Escape cierra la ventana abierta, como en los demás modales (2026-10-20).
  host: { '(document:keydown.escape)': 'alEscape()' },
})
export class Autorizaciones {
  private readonly api = inject(AutorizacionesService);
  private readonly confirmacion = inject(ConfirmacionService);
  private readonly injector = inject(Injector);
  /**
   * La solicitud a la que lleva el enlace (`?id=`, 2026-10-20: "Autorizar o
   * rechazar ›" de Surtir sucursal): se resalta y se lleva a la vista.
   */
  readonly resaltar = Number(inject(ActivatedRoute).snapshot.queryParamMap.get('id')) || null;
  private resaltada = false;
  /** La que se está retirando: su botón se apaga mientras responde. */
  readonly retirando = signal<number | null>(null);

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
        // Una sola vez: la del enlace, a la vista.
        if (this.resaltar && !this.resaltada && r.filas.some((f) => f.id === this.resaltar)) {
          this.resaltada = true;
          afterNextRender(() => document.getElementById(`solicitud-${this.resaltar}`)?.scrollIntoView({ block: 'center' }),
            { injector: this.injector });
        }
      },
      error: (e) => {
        if (!callado) this.error.set(this.msg(e));
      },
    });
  }

  async aceptar(a: Autorizacion): Promise<void> {
    // Un tipo de gasto nuevo: primero su límite (2026-10-20).
    if (a.operacion === 'tipo_gasto' && a.detalle?.tipo_gasto) {
      this.limiteTipo = a.detalle.tipo_gasto.limite;
      this.errorAjuste.set(null);
      this.ajustandoTipo.set(a);
      return;
    }
    // Un pedido a otra tienda: primero cuánto se autoriza de cada hilo.
    if (a.ajustable && a.detalle?.lineas?.length) {
      this.cuanto = Object.fromEntries(a.detalle.lineas.map((l) => [l.variante_id, l.pedido]));
      this.ajustando.set(a);
      return;
    }
    // Pagar una nómina no tiene vuelta: se pregunta, como en Nómina (2026-10-20).
    if (a.operacion === 'pagar_nomina') {
      const total = (a.detalle?.recibos ?? []).reduce((t, r) => t + Number(r.total), 0);
      const si = await this.confirmacion.pedir({
        titulo: '¿Pagar esta nómina?',
        mensaje: `${a.resumen}. Por ${total.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}. ` +
          'Ya pagada, no se puede editar ni recalcular.',
        aceptar: 'Pagar la nómina',
      });
      if (!si) return;
    }
    this.hacer(a);
  }

  /**
   * Enter en una cantidad pasa a la siguiente, no autoriza todo el pedido
   * (2026-10-20, auditoría). En la última, el cursor va a "Autorizar".
   */
  siguienteCampo(ev: Event): void {
    ev.preventDefault();
    const campo = ev.target as HTMLElement;
    const ventana = campo.closest('[role="dialog"]');
    const campos = [...(ventana?.querySelectorAll<HTMLInputElement>('input.cuanto') ?? [])];
    const i = campos.indexOf(campo as HTMLInputElement);
    if (i >= 0 && i < campos.length - 1) {
      campos[i + 1].focus();
      campos[i + 1].select();
    } else {
      ventana?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
    }
  }

  private hacer(
    a: Autorizacion,
    ajustes?: { items: { variante_id: number; paquetes?: number; cantidad?: number }[] } | { limite: number | null }
  ): void {
    this.aceptando.set(a.id);
    this.error.set(null);
    this.mensaje.set(null);
    this.api.aprobar(a.id, ajustes).subscribe({
      next: (r) => {
        this.aceptando.set(null);
        this.ajustando.set(null);
        this.ajustandoTipo.set(null);
        this.mensaje.set(r.nota_aprobacion ? `Aceptada y hecha. ${r.nota_aprobacion}` : `Aceptada y hecha: ${a.resumen}.`);
        this.cargar(true);
      },
      error: (e) => {
        this.aceptando.set(null);
        if (this.ajustando() || this.ajustandoTipo()) this.errorAjuste.set(this.msg(e));
        else this.error.set(this.msg(e));
        this.cargar(true);
      },
    });
  }

  readonly errorAjuste = signal<string | null>(null);

  // ---- Un tipo de gasto nuevo: se acepta con el límite que decide quien autoriza ----
  readonly ajustandoTipo = signal<Autorizacion | null>(null);
  limiteTipo: number | null = null;

  /** Vacío = sin límite (todo gasto de ese tipo se autoriza). Método: lee ngModel. */
  limiteTipoValido(): boolean {
    const v = this.limiteTipo as unknown;
    return v === null || v === '' || Number(v) > 0;
  }

  autorizarTipo(): void {
    const a = this.ajustandoTipo();
    if (!a || !this.limiteTipoValido()) return;
    const v = this.limiteTipo as unknown;
    this.errorAjuste.set(null);
    this.hacer(a, { limite: v === null || v === '' ? null : Math.round(Number(v) * 100) / 100 });
  }

  cerrarAjusteTipo(): void {
    if (this.aceptando() === null) {
      this.ajustandoTipo.set(null);
      this.errorAjuste.set(null);
    }
  }

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
      : `${vale === 1 ? 'Se autoriza 1' : `Se autorizan ${vale}`} de ${pedido} paquetes.`;
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
    this.hacer(a, { items });
  }

  /** El error de rechazar se dice DENTRO de su ventana (2026-10-20: quedaba tapado). */
  readonly errorRechazo = signal<string | null>(null);

  abrirRechazo(a: Autorizacion): void {
    this.motivo = '';
    this.errorRechazo.set(null);
    this.rechazando.set(a);
  }

  cerrarRechazo(): void {
    if (!this.guardando()) {
      this.rechazando.set(null);
      this.errorRechazo.set(null);
    }
  }

  /** Escape: cierra la ventana de encima (sin perder lo que se está guardando). */
  alEscape(): void {
    if (this.rechazando()) this.cerrarRechazo();
    else if (this.ajustando()) this.cerrarAjuste();
    else if (this.ajustandoTipo()) this.cerrarAjusteTipo();
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
        this.errorRechazo.set(this.msg(e));
      },
    });
  }

  retirar(a: Autorizacion): void {
    if (this.retirando() !== null) return;
    this.retirando.set(a.id);
    this.api.cancelar(a.id).subscribe({
      next: () => {
        this.retirando.set(null);
        this.mensaje.set(`Se retiró la solicitud: ${a.resumen}.`);
        this.cargar(true);
      },
      error: (e) => {
        this.retirando.set(null);
        this.error.set(this.msg(e));
      },
    });
  }

  tipoDe(a: Autorizacion): string {
    return TIPO_OPERACION[a.operacion] ?? 'Otra';
  }

  // Se parte una vez por resumen: la lista se dibuja seguido (tiempo real).
  private readonly partesCache = new Map<string, ParteResumen[]>();
  partes(texto: string | null | undefined): ParteResumen[] {
    const k = String(texto ?? '');
    let p = this.partesCache.get(k);
    if (!p) {
      p = partirResumen(k);
      if (this.partesCache.size > 500) this.partesCache.clear();
      this.partesCache.set(k, p);
    }
    return p;
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
