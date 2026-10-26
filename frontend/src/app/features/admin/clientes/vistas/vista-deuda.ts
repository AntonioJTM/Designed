import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Deuda, DeudorCartera } from '../../../../core/models/rediseno.models';
import { DineroPipe } from '../../../../shared/dinero.pipe';
import { COLOR, fechaCorta, pesos, plural } from '../clientes-ui';

/**
 * Cómo va cada cuenta según sus NOTAS VENCIDAS (los tramos de `cartera`, 2026-10-20):
 * cada nota vence el día en que se fió más sus días de crédito (sin decirlos, 15).
 * Pasada esa fecha la caja avisa antes de fiarle y la campana la cuenta.
 */
const TRAMO: Record<DeudorCartera['tramo'], { texto: string; pill: string; leyenda: string }> = {
  al_dia: { texto: 'Al corriente', pill: 'azul', leyenda: 'Al corriente (ninguna nota vencida)' },
  atrasado: { texto: 'Vencida', pill: 'ambar', leyenda: 'Vencida hasta 15 días' },
  un_mes: { texto: 'Muy vencida', pill: 'naranja', leyenda: 'Vencida 16 a 45 días' },
  vencido: { texto: 'Más de 45 días', pill: 'rojo', leyenda: 'Vencida hace más de 45 días' },
};

/** Cuántos renglones caben en las dos gráficas de barras; el resto va en la tabla. */
const TOPE_BARRAS = 12;

/**
 * Pestaña CUÁNTO DEBE: quién debe, desde cuándo y a quién cobrarle primero.
 *
 * El cajero también la ve (al usuario le gustó así): es quien cobra en el
 * mostrador. El abono se registra aquí mismo; corregir una deuda NO, eso vive
 * en el expediente y pide su permiso.
 *
 * Los días se cuentan desde el ÚLTIMO MOVIMIENTO de la cuenta, no desde la
 * venta: quien abonó la semana pasada está pagando, y tratarlo como moroso
 * llevaría a cobrarle a quien no toca.
 */
@Component({
  selector: 'app-vista-deuda',
  imports: [RouterLink, DineroPipe],
  templateUrl: './vista-deuda.html',
  host: { class: 'pila' },
})
export class VistaDeuda {
  readonly datos = input.required<Deuda>();
  readonly abonar = output<DeudorCartera>();

  readonly TRAMO = TRAMO;
  readonly fechaCorta = fechaCorta;
  readonly pesos = pesos;

  /** "venció hace 6 días" o "vence 4 nov" (2026-10-20). */
  vencimiento(r: DeudorCartera): string {
    const d = Number(r.dias_vencida ?? 0);
    if (d > 0) return `venció hace ${plural(d, 'día', 'días')}`;
    return r.vence_el ? `vence ${fechaCorta(r.vence_el)}` : '—';
  }

  readonly kpis = computed(() => {
    const d = this.datos();
    const mes = d.por_cobrar_mes ?? { monto: 0, clientes: 0, hasta: '' };
    return [
      {
        etiqueta: 'Por cobrar',
        valor: pesos(d.total_por_cobrar),
        pie: d.num_clientes ? `${plural(d.num_clientes, 'cliente', 'clientes')} con saldo` : 'nadie te debe',
        punto: COLOR.acento,
      },
      {
        etiqueta: 'Con notas vencidas',
        valor: pesos(d.vencido),
        pie: d.num_vencidos
          ? `${plural(d.num_vencidos, 'cliente tiene', 'clientes tienen')} notas que pasaron sus días`
          : 'ninguna nota pasó sus días',
        punto: COLOR.alerta,
      },
      // "Crédito usado" se quitó el 2026-10-22 ("no sirve", usuario): en su lugar,
      // lo vencido y lo que vence hasta el último día del mes.
      {
        etiqueta: 'Crédito por cobrar este mes',
        valor: pesos(mes.monto),
        pie: mes.clientes
          ? `${plural(mes.clientes, 'cliente', 'clientes')} · lo vencido y lo que vence al ${fechaCorta(mes.hasta)}`
          : 'nada vence este mes',
        punto: COLOR.serie1,
      },
      {
        etiqueta: 'Cobrado este mes',
        valor: pesos(d.cobrado_mes.monto),
        pie: `en ${plural(d.cobrado_mes.abonos, 'abono', 'abonos')}`,
        punto: COLOR.serie3,
      },
    ];
  });

  /** La cartera por antigüedad: una barra partida con la rampa de claro a oscuro. */
  readonly tramos = computed(() => {
    const d = this.datos();
    const tinta = ['var(--tinta)', '#FFFFFF', '#FFFFFF', '#FFFFFF'];
    const lista = d.por_antiguedad.map((t, i) => ({
      clave: t.clave,
      etiqueta: TRAMO[t.clave as DeudorCartera['tramo']]?.leyenda ?? t.etiqueta,
      monto: t.monto,
      clientes: t.clientes,
      color: COLOR.rampa[i] ?? COLOR.rampa[3],
      tinta: tinta[i] ?? '#FFFFFF',
    }));
    const total = lista.reduce((s, t) => s + t.monto, 0);
    return lista.map((t) => {
      const pct = total ? Math.round((100 * t.monto) / total) : 0;
      return { ...t, texto: pct >= 8 ? pct + '%' : '' };
    });
  });

  readonly resumenTramos = computed(() =>
    this.tramos().map((t) => `${t.etiqueta}: ${pesos(t.monto)}`).join('; ')
  );

  /** "Quién debe más": del saldo mayor al menor, contra el que más debe. */
  readonly porSaldo = computed(() => {
    const filas = [...this.datos().clientes].sort((a, b) => Number(b.saldo) - Number(a.saldo));
    const max = Math.max(1, ...filas.map((c) => Number(c.saldo)));
    return {
      resto: Math.max(0, filas.length - TOPE_BARRAS),
      filas: filas.slice(0, TOPE_BARRAS).map((c) => ({
        c,
        ancho: Math.max(1, Math.round((Number(c.saldo) / max) * 82)),
      })),
    };
  });

  /**
   * "Cuánto de su crédito han usado": solo los que TIENEN límite (sin límite
   * no hay contra qué medir). En naranja, los que ya casi no tienen dónde fiar.
   */
  readonly porUso = computed(() => {
    const filas = this.datos()
      .clientes.filter((c) => Number(c.limite_credito) > 0)
      .map((c) => {
        const limite = Number(c.limite_credito);
        const saldo = Number(c.saldo);
        const uso = saldo / limite;
        return {
          c,
          uso,
          pct: Math.min(100, Math.round(uso * 100)),
          texto: `${Math.round(uso * 100)}%`,
          color: uso >= 0.85 ? COLOR.serie2 : COLOR.serie1,
          queda: limite - saldo,
        };
      })
      .sort((a, b) => b.uso - a.uso);
    return { resto: Math.max(0, filas.length - TOPE_BARRAS), filas: filas.slice(0, TOPE_BARRAS) };
  });

  /** La tabla ya viene de la nota más vieja sin pagar a la más reciente. */
  readonly porAntiguedad = computed(() => this.datos().clientes);

  num(v: unknown): number {
    return Number(v ?? 0);
  }
}
