import { Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NominaService } from '../../../core/services/nomina.service';
import { ComisionesSemana, ComisionesVendedor, TipoVentaComision, VentaComision } from '../../../core/models/nomina.models';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { FolioPipe } from '../../../shared/folio.pipe';
import { diaCorto } from './semana';

const NOMBRE_TIPO: Record<TipoVentaComision, string> = {
  contado: 'Contado',
  credito: 'A crédito',
  apartado: 'Apartado',
  pedido: 'Nota en espera',
  nota: 'Nota pendiente',
  devolucion: 'Devolución',
};
const TONO_TIPO: Record<TipoVentaComision, string> = {
  contado: 'gris',
  credito: 'ambar',
  apartado: 'azul',
  pedido: 'verde',
  nota: 'ambar',
  devolucion: 'rojo',
};

/**
 * El REPORTE DE COMISIONES de una semana (2026-10-07: "queremos un reporte para
 * ver qué se está pagando de cada venta, por semana").
 *
 * La comisión de una venta se paga UNA vez, completa, en la nómina de la semana
 * en que quedó pagada: la de contado el día que se vende; la fiada, el apartado
 * y el pedido cuando se terminan de pagar. Por vendedor dice qué ventas paga
 * esta nómina (tal como quedaron en el recibo) y, al día de hoy, cuáles todavía
 * deben y cuánto se le pagará al liquidarse.
 *
 * Va en la pestaña "Comisiones" de Nómina y, con `usuarioId`, en el detalle del
 * recibo. `clave` es cualquier valor que cambia cuando hay que volver a pedirlo
 * (el periodo recalculado).
 */
@Component({
  selector: 'app-comisiones-semana',
  imports: [RouterLink, DineroPipe, FolioPipe],
  templateUrl: './comisiones-semana.html',
  styles: `
    :host { display: flex; flex-direction: column; gap: 22px; }
    .regla { margin: 0; font-size: 0.84375rem; color: var(--tinta-3); line-height: 1.5; }
    .vendedor { display: flex; flex-direction: column; gap: 10px; }
    .vendedor-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 6px 16px; }
    .vendedor-head h3 { margin: 0; font-size: 0.9375rem; font-weight: 600; }
    .vendedor-head .cifras { font-size: 0.84375rem; color: var(--tinta-2); font-variant-numeric: tabular-nums; }
    .vendedor-head .cifras b { color: var(--tinta); }
    h4 { margin: 4px 0 0; font-size: 0.8125rem; font-weight: 600; color: var(--tinta-2); }
    .sub3 { font-size: 0.75rem; color: var(--tinta-3); }
    .debe { color: var(--peligro-t); }
    .nota-chica { font-size: 0.8125rem; color: var(--tinta-3); margin: 0; }
    .sin { font-size: 0.84375rem; color: var(--tinta-3); margin: 0; }
  `,
})
export class ComisionesSemanaComponent {
  private readonly api = inject(NominaService);

  readonly periodoId = input.required<number>();
  readonly usuarioId = input<number | null>(null);
  /** Cambia cuando el periodo se recalcula: se vuelve a pedir. */
  readonly clave = input<unknown>(null);

  readonly datos = signal<ComisionesSemana | null>(null);
  readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.periodoId();
      const uid = this.usuarioId();
      this.clave();
      this.error.set(null);
      this.api.comisiones(id, uid ?? undefined).subscribe({
        next: (d) => this.datos.set(d),
        error: (e) => this.error.set((e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'No se pudo cargar.'),
      });
    });
  }

  /** Los que cobran comisión o tienen algo que contar. */
  conComision(): ComisionesVendedor[] {
    return (this.datos()?.vendedores ?? []).filter((v) => v.porcentaje > 0 || v.ventas.length || v.por_liquidar.length);
  }

  sinComision(): string[] {
    return (this.datos()?.vendedores ?? [])
      .filter((v) => !(v.porcentaje > 0 || v.ventas.length || v.por_liquidar.length))
      .map((v) => v.usuario);
  }

  tipo(t: TipoVentaComision): string {
    return NOMBRE_TIPO[t] ?? t;
  }

  tono(t: TipoVentaComision): string {
    return TONO_TIPO[t] ?? 'gris';
  }

  dia(fecha: string | null): string {
    return fecha ? diaCorto(fecha.slice(0, 10)) : '';
  }

  /** Lo que no cuenta de la venta (IVA y envío): total − venta neta − lo que regresó − lo condonado. */
  noCuenta(v: VentaComision): number {
    if (v.tipo === 'devolucion') return 0;
    return Math.round((v.total - v.venta_neta - Number(v.devuelto ?? 0) - Number(v.condonado ?? 0)) * 100) / 100;
  }

  /**
   * Lo que entra en la próxima nómina, en una frase: "1 venta ya pagada entra y
   * 1 devolución de una venta ya pagada se descuenta en la próxima nómina que se
   * calcule". Vacío si no hay nada.
   */
  textoProxima(v: ComisionesVendedor): string {
    const n = v.proxima_nomina.ventas;
    const d = v.proxima_nomina.devoluciones ?? 0;
    const partes = [
      n > 0 ? `${n} ${n === 1 ? 'venta ya pagada entra' : 'ventas ya pagadas entran'}` : '',
      d > 0 ? `${d} ${d === 1 ? 'descuento (regresó o se canceló una venta ya pagada) se aplica' : 'descuentos (ventas ya pagadas que regresaron o se cancelaron) se aplican'}` : '',
    ].filter(Boolean);
    return partes.length ? `${partes.join(' y ')} en la próxima nómina que se calcule` : '';
  }

  /**
   * Las ventas de verdad, para contarlas: sin los descuentos por devolución ni la
   * que regresó COMPLETA (su venta neta quedó en $0; 2026-10-20).
   */
  ventasDe(lista: VentaComision[]): number {
    return lista.filter((x) => x.tipo !== 'devolucion' && !this.devueltaCompleta(x)).length;
  }

  /** Regresó completa antes de pagarse su comisión: está en la lista, pero ya no es venta. */
  devueltaCompleta(x: VentaComision): boolean {
    return x.tipo !== 'devolucion' && Number(x.venta_neta) <= 0.004 && Number(x.devuelto ?? 0) > 0.004;
  }

  suma(lista: VentaComision[], k: 'total' | 'venta_neta' | 'comision'): number {
    // El total de la que regresó completa no se suma (como en el PDF).
    const cuentan = k === 'total' ? lista.filter((x) => x.tipo !== 'devolucion' && !this.devueltaCompleta(x)) : lista;
    return Math.round(cuentan.reduce((s, v) => s + Number(v[k]), 0) * 100) / 100;
  }
}
