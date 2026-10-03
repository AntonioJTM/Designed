import { Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ClienteRitmo, EstadoRitmo, Frecuencia } from '../../../../core/models/rediseno.models';
import { COLOR, ESTADO_RITMO, enPeriodo, fechaCorta, plural, kilos, pesos } from '../clientes-ui';

type Mostrar = 'toca' | 'todos' | 'frio' | 'perdido';

/**
 * Pestaña FRECUENCIA DE COMPRA: cada cuánto vienen y a quién le toca venir.
 *
 * Cada quien se mide contra SU PROPIO ritmo: 20 días sin venir es mucho para
 * quien viene cada semana y nada para quien viene cada mes. El ritmo se mide en
 * días con compra (dos tickets el mismo día son una visita) y lo calcula el
 * backend (`clientes/analisis.js → ritmos()`); aquí solo se dibuja.
 */
@Component({
  selector: 'app-vista-frecuencia',
  imports: [FormsModule, RouterLink],
  templateUrl: './vista-frecuencia.html',
  host: { class: 'pila' },
  styles: `
    .ritmo-leyenda { display: flex; flex-wrap: wrap; gap: 8px 18px; font-size: 13px; color: var(--tinta-2); }
    .ritmo-leyenda > span { display: inline-flex; align-items: center; gap: 8px; }
    .ritmo-leyenda .marca-ej { width: 2px; height: 16px; background: var(--tinta-2); }
    .ritmo-leyenda .punto-ej { width: 12px; height: 12px; border-radius: 50%; background: #C2410C; }
    .ritmo-fila {
      display: grid; grid-template-columns: 220px minmax(0, 1fr) 190px; align-items: center;
      gap: 18px; min-height: 54px; border-bottom: 1px solid var(--borde-suave);
    }
    .ritmo-fila .quien { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .ritmo-fila .quien a { font-size: 14px; font-weight: 500; color: var(--tinta); text-decoration: none;
                           white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ritmo-fila .quien a:hover { text-decoration: underline; }
    .ritmo-fila .quien span { font-size: 13px; color: var(--tinta-3); }
    .ritmo-fila .cola { display: flex; align-items: center; justify-content: flex-end; gap: 10px; font-size: 14px; }
    .pista { position: relative; height: 24px; }
    .pista .base { position: absolute; left: 0; right: 0; top: 11px; height: 2px; background: #E6E8EC; border-radius: 1px; }
    .pista .tramo { position: absolute; top: 10px; height: 4px; border-radius: 2px; }
    .pista .marca { position: absolute; top: 3px; width: 2px; height: 18px; margin-left: -1px; background: var(--tinta-2); }
    .pista .punto { position: absolute; top: 5px; width: 14px; height: 14px; margin-left: -7px; border-radius: 50%; box-shadow: 0 0 0 2px #fff; }
    .eje { display: grid; grid-template-columns: 220px minmax(0, 1fr) 190px; gap: 18px; padding-top: 8px; }
    .eje .marcas { position: relative; height: 18px; font-size: 12px; color: var(--tinta-3); font-variant-numeric: tabular-nums; }
    .eje .marcas span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
    .eje .marcas span:first-child { transform: none; }
    .eje .marcas span:last-child { transform: translateX(-100%); }
    .filtros-tabla { display: flex; flex-wrap: wrap; gap: 12px; }
    .filtros-tabla label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--tinta-3); }
    .filtros-tabla select { min-height: 36px; padding: 0 10px; border: 1px solid var(--borde-campo); border-radius: 8px; background: #fff; font: inherit; font-size: 14px; color: var(--tinta); }
    .tramos-frec > span { flex-basis: 0; min-width: 0; }
    @media (max-width: 720px) {
      .ritmo-fila { grid-template-columns: minmax(0, 1fr); gap: 6px; padding: 10px 0; }
      .ritmo-fila .cola { justify-content: flex-start; }
      .eje { display: none; }
    }
  `,
})
export class VistaFrecuencia {
  readonly datos = input.required<Frecuencia>();
  readonly dias = input.required<number>();

  readonly ESTADO = ESTADO_RITMO;
  readonly fechaCorta = fechaCorta;
  readonly enPeriodo = enPeriodo;

  /** Qué renglones enseña la tabla. Señal (no campo suelto) porque la lee un `computed`. */
  readonly mostrar = signal<Mostrar>('toca');
  readonly orden = signal<'tardo' | 'reciente' | 'kg' | 'dinero'>('tardo');
  readonly kilos = kilos;
  readonly pesos = pesos;
  /** Kilos con un decimal, para lo aproximado ("unos 24.5 kg por visita"). */
  readonly kg1 = (v: unknown) => kilos(Math.round(Number(v ?? 0) * 10) / 10);

  readonly kpis = computed(() => {
    const d = this.datos();
    return [
      {
        etiqueta: 'Vienen cada',
        valor: d.mediana_ritmo ? plural(d.mediana_ritmo, 'día', 'días') : '—',
        // Cada cuánto vienen Y cuánto se llevan cada vez (en kilos y en dinero).
        pie: d.mediana_ritmo
          ? 'lo normal entre una compra y otra' +
            (d.mediana_kg_visita ? `; cada vez se llevan unos ${this.kg1(d.mediana_kg_visita)} (${pesos(d.mediana_dinero_visita)})` : '')
          : 'hace falta que vuelvan a comprar para medirlo',
        punto: COLOR.acento,
      },
      { etiqueta: 'Al corriente', valor: String(d.al_corriente), pie: 'vinieron dentro de su ritmo de siempre', punto: COLOR.serie1 },
      { etiqueta: 'Ya les toca', valor: String(d.les_toca), pie: 'pasaron su ritmo, todavía no el doble', punto: COLOR.ambar },
      { etiqueta: 'Se están enfriando', valor: String(d.enfriandose), pie: 'llevan más del doble de su ritmo sin venir', punto: COLOR.alerta },
    ];
  });

  /**
   * La barra partida "cada cuánto vienen". Cada cliente cae en UN tramo. Los de
   * una sola compra van al final: todavía no tienen ritmo que medir.
   */
  readonly tramos = computed(() => {
    const t = this.datos().tramos;
    const def = [
      { etiqueta: 'Cada semana', n: t.semana, color: COLOR.rampa[3], tinta: '#FFFFFF' },
      { etiqueta: 'Cada 2 a 4 semanas', n: t.mes, color: COLOR.rampa[1], tinta: '#FFFFFF' },
      { etiqueta: 'Más de un mes', n: t.mas, color: COLOR.rampa[0], tinta: 'var(--tinta)' },
      { etiqueta: 'Se están enfriando', n: t.frio, color: COLOR.alerta, tinta: '#FFFFFF' },
      { etiqueta: '90 días o más sin venir', n: t.perdido, color: COLOR.otros, tinta: 'var(--tinta)' },
      { etiqueta: 'Una sola compra', n: t.una, color: COLOR.linea, tinta: 'var(--tinta)' },
    ].filter((x) => x.n > 0);
    const total = def.reduce((s, x) => s + x.n, 0);
    return def.map((x) => {
      const pct = total ? Math.round((100 * x.n) / total) : 0;
      return { ...x, pct, texto: pct >= 10 ? pct + '%' : '' };
    });
  });

  readonly resumenTramos = computed(() =>
    this.tramos().map((t) => `${t.n} ${t.etiqueta.toLowerCase()}`).join(', ')
  );

  /**
   * "A quién le toca venir": los que ya pasaron su ritmo, del que más se pasó
   * al que menos. La escala llega hasta 120 días: uno que lleva un año sin
   * venir aplastaría a todos los demás contra el cero.
   */
  readonly toca = computed(() => {
    const filas = this.datos()
      .clientes.filter((c) => c.estado === 'toca' || c.estado === 'frio')
      .sort((a, b) => (b.veces ?? 0) - (a.veces ?? 0))
      .slice(0, 10);
    const mayor = Math.max(30, ...filas.map((c) => Math.max(c.ritmo ?? 0, c.dias_sin_venir)));
    const escala = Math.min(120, Math.ceil(mayor / 20) * 20);
    const pos = (d: number) => (Math.min(d, escala) / escala) * 100;
    return {
      escala,
      marcas: [0, 0.25, 0.5, 0.75, 1].map((f) => ({
        pos: f * 100,
        texto: f === 1 ? `${escala} días` : String(Math.round(escala * f)),
      })),
      filas: filas.map((c) => {
        const e = ESTADO_RITMO[c.estado];
        const a = pos(Math.min(c.ritmo ?? 0, c.dias_sin_venir));
        const b = pos(Math.max(c.ritmo ?? 0, c.dias_sin_venir));
        return {
          c,
          posRitmo: pos(c.ritmo ?? 0),
          posSin: pos(c.dias_sin_venir),
          desde: a,
          ancho: b - a,
          color: e.color,
          suave: e.suave,
          pill: e.pill,
          pasado: c.dias_sin_venir > escala,
        };
      }),
    };
  });

  readonly tabla = computed<ClienteRitmo[]>(() => {
    const m = this.mostrar();
    const quiere: Record<Mostrar, (e: EstadoRitmo) => boolean> = {
      toca: (e) => e === 'toca' || e === 'frio',
      todos: () => true,
      frio: (e) => e === 'frio',
      perdido: (e) => e === 'perdido',
    };
    const filas = this.datos().clientes.filter((c) => quiere[m](c.estado));
    // El backend ya los manda del que más se tardó (contra su ritmo) al que
    // vino hace poco; "el que vino más reciente" es el orden contrario por días.
    // Por kilos o por dinero: lo del periodo, y a empate lo de siempre.
    switch (this.orden()) {
      case 'reciente':
        return [...filas].sort((a, b) => a.dias_sin_venir - b.dias_sin_venir);
      case 'kg':
        return [...filas].sort((a, b) => b.kg_periodo - a.kg_periodo || b.kg_total - a.kg_total);
      case 'dinero':
        return [...filas].sort((a, b) => b.dinero_periodo - a.dinero_periodo || b.dinero_total - a.dinero_total);
      default:
        return filas;
    }
  });

  veces(v: number | null): string {
    return v === null ? '—' : `${v.toLocaleString('es-MX', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}×`;
  }
}
