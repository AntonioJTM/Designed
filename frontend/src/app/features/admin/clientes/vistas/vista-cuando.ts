import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Cuando } from '../../../../core/models/rediseno.models';
import { COLOR, capitalizar, diaCorto, enPeriodo, fechaCorta, horaRango, plural, unoDeCada } from '../clientes-ui';

/**
 * Los cinco tonos del mapa de calor, de "casi nadie" a "lo más lleno", más el
 * vacío. Es la rampa azul de la paleta con dos pasos claros del diseño.
 * [fondo, tinta]
 */
const TONOS: [string, string][] = [
  ['#F4F5F7', '#5B6270'],
  ['#DCE8FA', '#1D4596'],
  ['#9EC3F2', '#0F2E5C'],
  ['#3987e5', '#FFFFFF'],
  ['#1c5cab', '#FFFFFF'],
  ['#0d366b', '#FFFFFF'],
];

/**
 * Pestaña CUÁNDO COMPRA: a qué día y hora vienen (para saber cuándo hace falta
 * gente en el mostrador), cómo van las semanas y cuándo debería volver cada
 * quien según su ritmo.
 *
 * Los tonos del mapa se miden contra la celda MÁS llena del periodo y no contra
 * números fijos: en una tienda chica "8 compras" es lo más lleno, y con cortes
 * fijos todo el mapa saldría pálido.
 */
@Component({
  selector: 'app-vista-cuando',
  imports: [RouterLink],
  templateUrl: './vista-cuando.html',
  host: { class: 'pila' },
  styles: `
    .calor { display: flex; flex-direction: column; gap: 4px; min-width: 640px; }
    .calor .renglon { display: grid; gap: 4px; }
    .calor .horas { font-size: 12px; color: var(--tinta-3); font-variant-numeric: tabular-nums; }
    .calor .horas span { text-align: center; }
    .calor .dia { font-size: 13px; color: var(--tinta-2); display: flex; align-items: center; }
    .calor .celda {
      height: 40px; border-radius: 5px; font-size: 12px; font-weight: 600;
      display: flex; align-items: center; justify-content: center; font-variant-numeric: tabular-nums;
    }
    .escala { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--tinta-3); }
    .escala i { width: 18px; height: 12px; border-radius: 3px; display: inline-block; }
  `,
})
export class VistaCuando {
  readonly datos = input.required<Cuando>();
  readonly dias = input.required<number>();

  readonly TONOS = TONOS.slice(1);
  readonly enPeriodo = enPeriodo;
  readonly fechaCorta = fechaCorta;
  readonly horaRango = horaRango;

  readonly kpis = computed(() => {
    const d = this.datos();
    const hay = d.total_compras > 0;
    const dif = d.esta_semana - d.semana_pasada;
    return [
      {
        etiqueta: 'Día más fuerte',
        valor: hay ? capitalizar(d.dia_fuerte.dia) : '—',
        pie: hay ? `${unoDeCada(d.dia_fuerte.pct)} compras de la semana` : 'todavía no hay compras',
        punto: COLOR.rampa[3],
      },
      {
        etiqueta: 'Hora pico',
        valor: hay ? `${d.hora_pico.desde} a ${d.hora_pico.hasta} h` : '—',
        pie: hay ? `${unoDeCada(d.hora_pico.pct)} compras cae ahí` : 'todavía no hay compras',
        punto: COLOR.rampa[1],
      },
      {
        etiqueta: 'Esta semana',
        valor: plural(d.esta_semana, 'compra', 'compras'),
        pie:
          dif === 0
            ? 'igual que la semana pasada'
            : `${Math.abs(dif)} ${dif > 0 ? 'más' : 'menos'} que la semana pasada`,
        punto: COLOR.serie3,
      },
      {
        etiqueta: 'Les toca volver',
        valor: String(d.les_toca_7_dias),
        pie: 'clientes en los próximos 7 días, según su ritmo',
        punto: COLOR.ambar,
      },
    ];
  });

  /** El mapa día × hora, con su tono contra la celda más llena. */
  readonly mapa = computed(() => {
    const d = this.datos();
    const max = Math.max(0, ...d.mapa.flatMap((m) => m.celdas));
    let mejor = { dia: '', hora: 0, n: 0 };
    const filas = d.mapa.map((m) => ({
      dia: diaCorto(m.dia),
      celdas: m.celdas.map((n, i) => {
        if (n > mejor.n) mejor = { dia: m.dia, hora: d.horas[i], n };
        const nivel = n === 0 || max === 0 ? 0 : Math.max(1, Math.ceil((n / max) * 5));
        return { n, fondo: TONOS[nivel][0], tinta: TONOS[nivel][1], titulo: `${m.dia}, ${horaRango(d.horas[i])}: ${plural(n, 'compra', 'compras')}` };
      }),
    }));
    return {
      columnas: `52px repeat(${d.horas.length}, minmax(0, 1fr))`,
      horas: d.horas.map((h, i) => (i === d.horas.length - 1 ? `${h} h` : String(h))),
      filas,
      resumen: mejor.n
        ? `Lo más lleno: ${mejor.dia} de ${horaRango(mejor.hora)}, con ${plural(mejor.n, 'compra', 'compras')}.`
        : 'Sin compras en el periodo.',
    };
  });

  /** Las 12 semanas; la última, que no termina, en color fuerte. */
  readonly semanas = computed(() => {
    const s = this.datos().semanas;
    const max = Math.max(1, ...s.map((x) => x.n));
    return s.map((x, i) => ({
      etiqueta: fechaCorta(x.lunes),
      n: x.n,
      alto: Math.round((x.n / max) * 170),
      fuerte: i === s.length - 1,
    }));
  });

  readonly resumenSemanas = computed(() => {
    const s = this.datos().semanas.map((x) => x.n);
    if (!s.length) return '';
    return `Entre ${Math.min(...s)} y ${Math.max(...s)} compras por semana; esta semana van ${s[s.length - 1]}.`;
  });

  /** Cuándo debería volver, en palabras: lo que importa es si ya se pasó. */
  cuando(enDias: number | null): { texto: string; pill: string } {
    if (enDias === null) return { texto: 'Una sola compra', pill: 'gris' };
    if (enDias < 0) return { texto: 'Ya se pasó', pill: 'ambar' };
    if (enDias === 0) return { texto: 'Hoy', pill: 'azul' };
    if (enDias === 1) return { texto: 'Mañana', pill: 'azul' };
    if (enDias <= 7) return { texto: `En ${enDias} días`, pill: 'azul' };
    return { texto: `En ${enDias} días`, pill: 'gris' };
  }
}
