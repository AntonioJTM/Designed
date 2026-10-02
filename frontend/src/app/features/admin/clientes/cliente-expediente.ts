import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ClientesService } from '../../../core/services/clientes.service';
import { VentasService } from '../../../core/services/ventas.service';
import { AuthService } from '../../../core/services/auth.service';
import { Expediente } from '../../../core/models/clientes.models';
import { MetodoPago, SesionCaja } from '../../../core/models/ventas.models';
import { ApiError } from '../../../core/models/auth.models';
import { Barras, Barra } from '../../../shared/charts/barras';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';

/**
 * El expediente del cliente: todo lo que se sabe de él en una pantalla.
 *
 * El orden responde a cómo se atiende a alguien en el mostrador: primero quién
 * es y si debe (lo que hay que saber ANTES de venderle), luego qué se lleva
 * —los colores, que es lo que permite atenderlo bien— y al final el historial.
 */
@Component({
  selector: 'app-cliente-expediente',
  imports: [FormsModule, RouterLink, Barras, CantidadPipe, FechaPipe],
  templateUrl: './cliente-expediente.html',
})
export class ClienteExpediente {
  private readonly clientes = inject(ClientesService);
  private readonly ventas = inject(VentasService);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);

  readonly exp = signal<Expediente | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  // --- Abono ---
  readonly abonando = signal(false);
  readonly registrando = signal(false);
  readonly metodos = signal<MetodoPago[]>([]);
  readonly sesion = signal<SesionCaja | null>(null);
  montoAbono: number | null = null;
  metodoAbono: number | '' = '';
  referenciaAbono = '';

  // --- Ajuste de la deuda (solo jefes) ---
  //
  // Para lo que no es un abono: condonar una deuda, corregir un cargo capturado
  // de más o agregar uno que faltó. Queda en el libro como 'ajuste' con su
  // motivo; el cargo original no se borra.
  readonly esJefe = computed(() => ['administrador', 'gerente'].includes(this.auth.sesion()?.rol ?? ''));
  readonly ajustando = signal(false);
  readonly guardandoAjuste = signal(false);
  sentidoAjuste: 'baja' | 'sube' = 'baja';
  montoAjuste: number | null = null;
  motivoAjuste = '';

  private readonly id: number;

  constructor() {
    this.id = Number(this.route.snapshot.paramMap.get('id'));
    this.cargar();
    this.ventas.metodosPago().subscribe({
      next: (m) => this.metodos.set(m),
      error: () => this.metodos.set([]),
    });
  }

  private cargar(): void {
    this.cargando.set(true);
    this.clientes.expediente(this.id).subscribe({
      next: (e) => {
        this.exp.set(e);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  // ------------------------------------------------------------- lo que compra

  /**
   * Los colores que más compra, en kilos. Una sola serie: todas del mismo
   * color, porque lo que se compara es la longitud, no la identidad.
   */
  readonly barrasColores = computed<Barra[]>(() => {
    const e = this.exp();
    if (!e) return [];
    return e.colores_mas_comprados.slice(0, 10).map((c) => ({
      label: `${c.color}${c.calibre ? ' ' + c.calibre : ''}`,
      value: Number(c.kilos),
      detalle:
        `${c.veces} ${Number(c.veces) === 1 ? 'vez' : 'veces'} · ` +
        `${this.dinero(c.importe)}`,
      title: `${c.color} ${c.calibre ?? ''} · ${c.material ?? ''}`,
    }));
  });

  /** El pago elegido es efectivo: entonces hace falta un turno de caja abierto. */
  readonly abonoEsEfectivo = computed(() => {
    const m = this.metodos().find((x) => x.id === Number(this.metodoAbono));
    return (m?.nombre ?? '').toLowerCase().includes('efectivo');
  });

  // ---------------------------------------------------------------- el abono

  abrirAbono(): void {
    const e = this.exp();
    if (!e) return;
    this.montoAbono = Number(e.saldo ?? 0) || null;
    this.metodoAbono = '';
    this.referenciaAbono = '';
    this.error.set(null);
    this.mensaje.set(null);
    this.abonando.set(true);
    // Un abono en efectivo tiene que entrar a un turno abierto. Se busca aquí
    // para poder avisar ANTES de que teclee el monto, no al confirmar.
    this.buscarTurno();
  }

  private buscarTurno(): void {
    this.ventas.cajas().subscribe({
      next: (cajas) => {
        const activas = cajas.filter((c) => c.activo);
        if (activas.length === 0) return;
        // Se prueba caja por caja hasta encontrar un turno abierto.
        let restantes = activas.length;
        for (const caja of activas) {
          this.ventas.sesionAbierta(caja.id).subscribe({
            next: (s) => {
              if (s && !this.sesion()) this.sesion.set(s);
              restantes--;
            },
            error: () => restantes--,
          });
        }
      },
      error: () => this.sesion.set(null),
    });
  }

  cerrarAbono(): void {
    this.abonando.set(false);
  }

  abrirAjuste(): void {
    this.abonando.set(false);
    this.sentidoAjuste = 'baja';
    this.montoAjuste = null;
    this.motivoAjuste = '';
    this.error.set(null);
    this.ajustando.set(true);
  }

  cerrarAjuste(): void {
    this.ajustando.set(false);
  }

  /** Cómo quedaría la deuda. Método, no `computed`: lee campos de ngModel. */
  saldoTrasAjuste(): number {
    const saldo = this.num(this.exp()?.saldo);
    const m = Number(this.montoAjuste ?? 0);
    return Math.round((this.sentidoAjuste === 'baja' ? saldo - m : saldo + m) * 100) / 100;
  }

  guardarAjuste(): void {
    const e = this.exp();
    const m = Number(this.montoAjuste ?? 0);
    const motivo = this.motivoAjuste.trim();
    if (!e || !(m > 0)) {
      this.error.set('Pon de cuánto es el ajuste.');
      return;
    }
    if (motivo.length < 3) {
      this.error.set('Escribe el motivo: un saldo que cambia sin explicación no se puede aclarar después.');
      return;
    }
    if (this.saldoTrasAjuste() < 0) {
      this.error.set(`Debe ${this.dinero(e.saldo)}: no se le puede quitar más que eso.`);
      return;
    }
    this.guardandoAjuste.set(true);
    this.error.set(null);
    this.clientes.ajustar(e.id, this.sentidoAjuste === 'baja' ? -m : m, motivo).subscribe({
      next: () => {
        this.guardandoAjuste.set(false);
        this.ajustando.set(false);
        this.mensaje.set(`Ajuste registrado. Ahora debe ${this.dinero(this.saldoTrasAjuste())}.`);
        this.cargar();
      },
      error: (err) => {
        this.guardandoAjuste.set(false);
        this.error.set(this.msg(err));
      },
    });
  }

  registrarAbono(): void {
    const e = this.exp();
    if (!e || !this.montoAbono || this.montoAbono <= 0) {
      this.error.set('Pon cuánto está abonando.');
      return;
    }
    if (!this.metodoAbono) {
      this.error.set('Elige con qué está pagando.');
      return;
    }
    if (this.abonoEsEfectivo() && !this.sesion()) {
      this.error.set(
        'Un abono en efectivo tiene que entrar en un turno de caja abierto, o el corte ' +
          'no va a cuadrar. Abre el turno en Punto de venta, o registra el abono con otro método.'
      );
      return;
    }

    this.registrando.set(true);
    this.error.set(null);
    this.clientes
      .abonar(e.id, {
        monto: Number(this.montoAbono),
        metodo_pago_id: Number(this.metodoAbono),
        sesion_caja_id: this.abonoEsEfectivo() ? this.sesion()!.id : undefined,
        referencia: this.referenciaAbono.trim() || undefined,
      })
      .subscribe({
        next: (r) => {
          this.registrando.set(false);
          this.abonando.set(false);
          this.mensaje.set(
            `Abono registrado. ${
              r.saldo_nuevo > 0
                ? `Le quedan ${this.dinero(r.saldo_nuevo)} por pagar.`
                : 'Quedó al día.'
            }`
          );
          this.cargar();
        },
        error: (err) => {
          this.error.set(this.msg(err));
          this.registrando.set(false);
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

  /** Cuántos días lleva sin venir. `null` si nunca ha comprado. */
  readonly diasSinVenir = computed(() => {
    const u = this.exp()?.estadisticas?.ultima_compra;
    if (!u) return null;
    return Math.floor((Date.now() - new Date(String(u).replace(' ', 'T')).getTime()) / 86400000);
  });

  /** Etiqueta del movimiento de crédito, en palabras de la tienda. */
  /**
   * El monto con el signo de hacia dónde mueve la deuda: el abono la baja, el
   * cargo la sube y el ajuste trae su propio signo. Antes se le pegaba un "+" a
   * todo lo que no fuera abono, y el ajuste negativo salía como "+-$17,941.79".
   */
  montoMovimiento(m: { tipo: string; monto: unknown }): string {
    const n = this.num(m.monto);
    const efecto = m.tipo === 'abono' ? -Math.abs(n) : n;
    return (efecto < 0 ? '−' : '+') + this.dinero(Math.abs(efecto));
  }

  etiquetaMovimiento(tipo: string): string {
    return tipo === 'cargo' ? 'Se llevó a crédito'
      : tipo === 'abono' ? 'Abonó'
      : 'Ajuste';
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
