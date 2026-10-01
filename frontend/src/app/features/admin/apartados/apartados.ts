import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { VentasService } from '../../../core/services/ventas.service';
import { Apartado, Apartados as Datos, MetodoPago, SesionCaja } from '../../../core/models/ventas.models';
import { ApiError } from '../../../core/models/auth.models';
import { Barras, Barra } from '../../../shared/charts/barras';
import { FechaPipe } from '../../../shared/fecha.pipe';

/**
 * Los apartados vigentes: mercancía guardada que todavía no se entrega.
 *
 * La pantalla contesta dos preguntas, en este orden:
 *   1. A QUIÉN LLAMO. Los que ya casi liquidan son los que vale la pena
 *      llamar: un empujón y se cierra la venta. Por eso el orden por omisión
 *      es por porcentaje pagado, no por fecha.
 *   2. QUÉ ESTÁ GUARDADO Y CUÁNTO DINERO ES. La mercancía apartada no se
 *      puede vender a nadie más, así que un apartado olvidado es inventario
 *      congelado.
 */
@Component({
  selector: 'app-apartados',
  host: { '(document:keydown.escape)': 'cerrarAbono()' },
  imports: [FormsModule, RouterLink, Barras, FechaPipe],
  templateUrl: './apartados.html',
})
export class ApartadosPantalla {
  private readonly ventas = inject(VentasService);

  readonly datos = signal<Datos | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  orden: 'por_liquidar' | 'antiguos' | 'monto' = 'por_liquidar';

  readonly ordenes = [
    // "Ya casi liquida" y no "a quién llamar": los liquidados también van
    // arriba con este orden, y a esos no se les llama para cobrar — se les
    // entrega. Van en su propio bloque.
    { valor: 'por_liquidar' as const, etiqueta: 'Los que ya casi liquidan' },
    { valor: 'antiguos' as const, etiqueta: 'Los más viejos' },
    { valor: 'monto' as const, etiqueta: 'Los de más dinero' },
  ];

  // --- Abono ---
  readonly abonando = signal<Apartado | null>(null);
  readonly registrando = signal(false);
  readonly metodos = signal<MetodoPago[]>([]);
  readonly sesion = signal<SesionCaja | null>(null);
  montoAbono: number | null = null;
  metodoAbono: number | '' = '';
  referenciaAbono = '';

  readonly entregando = signal(false);

  constructor() {
    this.cargar();
    this.ventas.metodosPago().subscribe({
      next: (m) => this.metodos.set(m),
      error: () => this.metodos.set([]),
    });
    this.buscarTurno();
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set(null);
    this.ventas.apartados({ orden: this.orden }).subscribe({
      next: (d) => {
        this.datos.set(d);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  /**
   * Busca un turno de caja abierto. Hace falta para los abonos en efectivo, y
   * se busca AL ABRIR la pantalla para poder avisar antes de que teclee el
   * monto, no al confirmar.
   */
  private buscarTurno(): void {
    this.ventas.cajas().subscribe({
      next: (cajas) => {
        for (const caja of cajas.filter((c) => c.activo)) {
          this.ventas.sesionAbierta(caja.id).subscribe({
            next: (s) => {
              if (s && !this.sesion()) this.sesion.set(s);
            },
            error: () => {},
          });
        }
      },
      error: () => this.sesion.set(null),
    });
  }

  /**
   * Los que ya liquidaron: no hay que cobrarles, hay que ENTREGARLES. Van
   * aparte porque es una acción distinta, y mezclarlos con los pendientes hacía
   * que el orden "a quién llamar" pusiera primero justo a quien no hay que
   * llamar.
   */
  readonly listosParaEntregar = computed(() =>
    (this.datos()?.items ?? []).filter((a) => Number(a.pendiente) <= 0.001)
  );

  /** Los que todavía deben algo: a estos sí hay que cobrarles. */
  readonly pendientes = computed(() =>
    (this.datos()?.items ?? []).filter((a) => Number(a.pendiente) > 0.001)
  );

  /**
   * Cuánto falta por cobrar de cada uno. La barra mide el PENDIENTE porque es
   * lo que hay que perseguir.
   *
   * Los liquidados se quedan FUERA: una barra de $0 no dice nada y solo estorba
   * en una gráfica que se titula "cuánto falta por cobrar".
   */
  readonly barrasApartados = computed<Barra[]>(() => {
    const d = this.datos();
    if (!d) return [];
    return this.pendientes().slice(0, 12).map((a) => ({
      label: a.nombre_comercial || a.cliente || 'Sin cliente',
      value: Number(a.pendiente),
      detalle:
        `lleva ${Number(a.pct_pagado).toFixed(0)}% pagado · ` +
        `${a.dias_apartado} ${a.dias_apartado === 1 ? 'día' : 'días'} apartado`,
      title: `${a.numero_pedido} · total ${this.dinero(a.total)}`,
    }));
  });

  readonly abonoEsEfectivo = computed(() => {
    const m = this.metodos().find((x) => x.id === Number(this.metodoAbono));
    return (m?.nombre ?? '').toLowerCase().includes('efectivo');
  });

  // ------------------------------------------------------------------ abonar

  abrirAbono(a: Apartado): void {
    // Se propone lo que falta: lo normal es que venga a liquidar.
    this.montoAbono = Number(a.pendiente) || null;
    this.metodoAbono = '';
    this.referenciaAbono = '';
    this.error.set(null);
    this.mensaje.set(null);
    this.abonando.set(a);
  }

  cerrarAbono(): void {
    this.abonando.set(null);
  }

  registrarAbono(): void {
    const a = this.abonando();
    if (!a) return;
    if (!this.montoAbono || this.montoAbono <= 0) {
      this.error.set('Pon cuánto está abonando.');
      return;
    }
    if (!this.metodoAbono) {
      this.error.set('Elige con qué está pagando.');
      return;
    }
    if (this.abonoEsEfectivo() && !this.sesion()) {
      this.error.set(
        'Un abono en efectivo tiene que entrar en un turno de caja abierto, o el corte no ' +
          'va a cuadrar. Abre el turno en Punto de venta, o registra el abono con otro método.'
      );
      return;
    }

    this.registrando.set(true);
    this.error.set(null);
    this.ventas
      .abonarApartado(a.pedido_id, {
        monto: Number(this.montoAbono),
        metodo_pago_id: Number(this.metodoAbono),
        sesion_caja_id: this.abonoEsEfectivo() ? this.sesion()!.id : undefined,
        referencia: this.referenciaAbono.trim() || undefined,
      })
      .subscribe({
        next: (r) => {
          this.registrando.set(false);
          this.cerrarAbono();
          this.mensaje.set(
            r.liquidado
              ? `${a.numero_pedido} quedó liquidado. Ya se le puede entregar la mercancía.`
              : `Abono registrado. Le faltan ${this.dinero(r.pendiente)}.`
          );
          this.cargar();
        },
        error: (e) => {
          this.error.set(this.msg(e));
          this.registrando.set(false);
        },
      });
  }

  // ---------------------------------------------------------------- entregar

  /** Solo se puede entregar lo que está liquidado; el servidor lo revalida. */
  puedeEntregar(a: Apartado): boolean {
    return Number(a.pendiente) <= 0.001;
  }

  entregar(a: Apartado): void {
    if (!this.puedeEntregar(a)) return;
    const quien = a.nombre_comercial || a.cliente || 'el cliente';
    if (!confirm(`¿Entregar la mercancía de ${a.numero_pedido} a ${quien}? Sale del inventario.`)) {
      return;
    }
    this.entregando.set(true);
    this.error.set(null);
    this.ventas.entregarApartado(a.pedido_id).subscribe({
      next: () => {
        this.entregando.set(false);
        this.mensaje.set(`Entregado. La mercancía de ${a.numero_pedido} salió del inventario.`);
        this.cargar();
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.entregando.set(false);
      },
    });
  }

  // ------------------------------------------------------------------ ayudas

  num(v: unknown): number {
    return Number(v ?? 0);
  }

  dinero(v: unknown): string {
    return this.num(v).toLocaleString('es-MX', {
      style: 'currency',
      currency: 'MXN',
      maximumFractionDigits: 2,
    });
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
