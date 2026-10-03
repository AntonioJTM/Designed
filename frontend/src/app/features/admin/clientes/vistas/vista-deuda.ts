import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Deuda, DeudorCartera } from '../../../../core/models/rediseno.models';
import { DineroPipe } from '../../../../shared/dinero.pipe';
import { COLOR, fechaCorta, pesos, plural } from '../clientes-ui';

/** Cómo va cada cuenta según los días sin movimiento (los tramos de `cartera`). */
const TRAMO: Record<DeudorCartera['tramo'], { texto: string; pill: string; leyenda: string }> = {
  al_dia: { texto: 'Al día', pill: 'azul', leyenda: 'Al día (0 a 30 días)' },
  un_mes: { texto: 'Por cobrar', pill: 'ambar', leyenda: '31 a 60 días' },
  dos_meses: { texto: 'Atrasado', pill: 'naranja', leyenda: '61 a 90 días' },
  vencido: { texto: 'Muy atrasado', pill: 'rojo', leyenda: 'Más de 90 días' },
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

  readonly kpis = computed(() => {
    const d = this.datos();
    const usado = d.credito_autorizado > 0 ? Math.round((100 * d.credito_usado) / d.credito_autorizado) : null;
    return [
      {
        etiqueta: 'Por cobrar',
        valor: pesos(d.total_por_cobrar),
        pie: d.num_clientes ? `${plural(d.num_clientes, 'cliente', 'clientes')} con saldo` : 'nadie te debe',
        punto: COLOR.acento,
      },
      {
        etiqueta: 'Atrasado',
        valor: pesos(d.vencido),
        pie: d.num_vencidos
          ? `${plural(d.num_vencidos, 'cliente lleva', 'clientes llevan')} ${d.dias_aviso} días o más sin abonar`
          : `nadie lleva ${d.dias_aviso} días sin abonar`,
        punto: COLOR.alerta,
      },
      {
        etiqueta: 'Crédito usado',
        valor: usado === null ? '—' : `${usado}%`,
        pie: d.credito_autorizado > 0 ? `de ${pesos(d.credito_autorizado)} que tienen autorizado` : 'nadie tiene crédito autorizado',
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

  /** La tabla ya viene del que más tiempo lleva sin abonar al más reciente. */
  readonly porAntiguedad = computed(() => this.datos().clientes);

  num(v: unknown): number {
    return Number(v ?? 0);
  }
}
