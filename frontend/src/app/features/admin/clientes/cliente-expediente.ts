import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ClientesService } from '../../../core/services/clientes.service';
import { VentasService } from '../../../core/services/ventas.service';
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
