import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { VentasService } from '../../../core/services/ventas.service';
import { AuthService } from '../../../core/services/auth.service';
import { Apartado, Apartados as Datos, Caja, MetodoPago } from '../../../core/models/ventas.models';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { hoyLocal } from '../../../shared/fecha.pipe';
import { FolioPipe } from '../../../shared/folio.pipe';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';

/** La caja que se eligió la última vez (la comparten Caja y Punto de venta). */
function cajaGuardada(): number | null {
  try {
    const v = Number(localStorage.getItem('caja_sel'));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

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
  imports: [FolioPipe, FormsModule, RouterLink, DineroPipe, CantidadPipe],
  templateUrl: './apartados.html',
  styleUrl: './apartados.scss',
})
export class ApartadosPantalla {
  private readonly ventas = inject(VentasService);
  private readonly confirmacion = inject(ConfirmacionService);
  private readonly auth = inject(AuthService);

  readonly vePos = computed(() => this.auth.puede('ver:pos'));
  readonly veCaja = computed(() => this.auth.puede('ver:caja'));
  readonly veClientes = computed(() => this.auth.puede('ver:clientes'));

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
  /** El turno abierto al que entra un abono en efectivo: su id y el nombre de la caja. */
  readonly sesion = signal<{ id: number; caja: string } | null>(null);
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
   *
   * El listado de cajas ya trae su turno abierto, así que no hace falta
   * preguntar caja por caja. Se prefiere la que se eligió en Caja o en Punto de
   * venta: es donde está trabajando quien cobra.
   */
  private buscarTurno(): void {
    this.ventas.cajas().subscribe({
      next: (cajas) => this.sesion.set(this.turnoPreferido(cajas)),
      error: () => this.sesion.set(null),
    });
  }

  private turnoPreferido(cajas: Caja[]): { id: number; caja: string } | null {
    const abiertas = cajas.filter((c) => c.turno_id);
    const guardada = cajaGuardada();
    const c = abiertas.find((x) => x.id === guardada) ?? abiertas[0];
    return c ? { id: Number(c.turno_id), caja: c.nombre } : null;
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

  /** Lo que falta de los que no se han liquidado: lo que hay que perseguir. */
  readonly porCobrar = computed(() =>
    Math.round(this.pendientes().reduce((s, a) => s + Number(a.pendiente), 0) * 100) / 100
  );

  /**
   * "TURQUESA 1/30 · 2 paquetes", "CARAMEL 1/30, HUESO 2/48". Los paquetes
   * son aproximados (cada bulto pesa distinto); sin presentación de paquete se
   * dicen los kilos.
   */
  queSeAparto(a: Apartado): string {
    const h = a.hilos ?? [];
    if (h.length === 0) return '';
    if (h.length === 1) {
      const x = h[0];
      const cuanto = x.paquetes
        ? `${x.paquetes} ${x.paquetes === 1 ? 'paquete' : 'paquetes'}`
        : `${x.kg.toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg${x.tipo_presentacion === 'cono' ? ' en cono' : ''}`;
      return `${x.hilo} · ${cuanto}`;
    }
    const nombres = [...new Set(h.map((x) => x.hilo))];
    return nombres.length <= 2 ? nombres.join(', ') : `${nombres[0]} y ${nombres.length - 1} más`;
  }

  /** "Liquidado el 30 sep", "Liquidado hoy". La fecha del último pago es la de liquidación. */
  cuandoLiquido(a: Apartado): string {
    const dia = String(a.ultimo_abono ?? a.creado_en ?? '').replace('T', ' ').split(' ')[0];
    if (!dia) return 'Ya pagado';
    if (dia === hoyLocal()) return 'Liquidado hoy';
    const [, m, d] = dia.split('-').map(Number);
    return m && d ? `Liquidado el ${d} ${MESES[m - 1]}` : 'Ya pagado';
  }

  /** "1 oct": desde cuándo está apartado. */
  desde(a: Apartado): string {
    const dia = String(a.creado_en ?? '').replace('T', ' ').split(' ')[0];
    const [y, m, d] = dia.split('-').map(Number);
    if (!m || !d) return '—';
    return `${d} ${MESES[m - 1]}${String(y) === hoyLocal().slice(0, 4) ? '' : ' ' + y}`;
  }

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
          'va a cuadrar. Abre el turno en Caja, o registra el abono con otro método.'
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

  async entregar(a: Apartado): Promise<void> {
    if (!this.puedeEntregar(a)) return;
    const quien = a.nombre_comercial || a.cliente || 'el cliente';
    const si = await this.confirmacion.pedir({
      titulo: `¿Entregar la mercancía a ${quien}?`,
      mensaje: `Apartado ${a.numero_pedido}. Al entregarla sale del inventario.`,
      aceptar: 'Entregar',
    });
    if (!si) return;
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
