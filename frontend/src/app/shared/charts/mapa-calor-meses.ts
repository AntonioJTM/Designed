import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { colorReal, tintaSobre } from './contraste';

/** Un mes de un hilo: sus kilos y su tramo (1–5; null = sin color). */
export interface CeldaMes {
  kg: number | null;
  tramo: number | null;
  en_curso?: boolean;
}

export interface FilaCalor {
  id: number;
  nombre: string;
  meses: CeldaMes[];
  /** El mes más alto (1–12): va en negritas. */
  mejorMes: number | null;
  total: number;
  temporada: string | null;
}

/** Los cinco tramos: su fondo y su leyenda (sección 4 de las instrucciones). */
export const TRAMOS_CALOR = [
  { tramo: 1, fondo: 'var(--viz-calor-1)', texto: '30% menos o más abajo' },
  { tramo: 2, fondo: 'var(--viz-calor-2)', texto: '10% a 30% menos' },
  { tramo: 3, fondo: 'var(--viz-rampa-2)', texto: 'Un mes normal' },
  { tramo: 4, fondo: 'var(--viz-rampa-3)', texto: '10% a 40% más' },
  { tramo: 5, fondo: 'var(--viz-rampa-4)', texto: '40% más o arriba' },
] as const;

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * MAPA DE CALOR hilo × mes (Rotación de inventario, 2026-10-22): cada celda con
 * sus kilos escritos y el color de su tramo (el mes contra un mes normal de ESE
 * hilo); el mes más alto de cada hilo en negritas; a la derecha el total del año
 * y «Su temporada», y al final el renglón de todos en toneladas.
 *
 * Es una CUADRÍCULA con `role="table"` (no un SVG): el lector de pantalla la
 * recorre como tabla. La letra de cada celda la elige `tintaSobre()`.
 */
@Component({
  selector: 'app-mapa-calor-meses',
  imports: [RouterLink],
  template: `
    @if (conColores()) {
      <div class="leyenda mc-leyenda">
        @for (t of TRAMOS; track t.tramo) { <span><i [style.background]="t.fondo"></i>{{ t.texto }}</span> }
      </div>
    }
    <div class="tabla-scroll">
      <div class="mc" role="table" [attr.aria-label]="descripcion()">
        <div class="mc-fila mc-cabeza" role="row">
          <span role="columnheader" class="mc-hilo">Hilo</span>
          @for (m of MESES_CORTOS; track $index) {
            <span role="columnheader" class="mc-mes"><span aria-hidden="true">{{ m }}</span><span class="oculto">{{ MESES[$index] }}</span></span>
          }
          <span role="columnheader" class="mc-num">Al año</span>
          <span role="columnheader" class="mc-temp">Su temporada</span>
        </div>
        @for (f of filas(); track f.id) {
          <div class="mc-fila" role="row">
            <span role="rowheader" class="mc-hilo">
              @if (rutaHilo(); as ruta) { <a [routerLink]="ruta + f.id">{{ f.nombre }}</a> } @else { {{ f.nombre }} }
            </span>
            @for (c of f.meses; track $index) {
              <span role="cell" class="mc-celda" [class.fuerte]="f.mejorMes === $index + 1" [class.curso]="c.en_curso"
                    [style.background]="fondo(c)" [style.color]="tinta(c)"
                    [attr.title]="c.kg == null ? MESES[$index] + ': sin datos' : MESES[$index] + ': ' + kg(c.kg) + (c.en_curso ? ' (va en curso)' : '')">
                {{ c.kg == null ? '—' : num(c.kg) }}
              </span>
            }
            <span role="cell" class="mc-num"><b>{{ kg(f.total) }}</b></span>
            <span role="cell" class="mc-temp">{{ f.temporada ?? '—' }}</span>
          </div>
        }
        @if (total(); as t) {
          <div class="mc-fila mc-total" role="row">
            <span role="rowheader" class="mc-hilo"><b>{{ nombreTotal() }}</b></span>
            @for (v of t.meses; track $index) { <span role="cell" class="mc-celda-t">{{ v == null ? '—' : ton(v) }}</span> }
            <span role="cell" class="mc-num"><b>{{ ton(t.total) }}</b></span>
            <span role="cell" class="mc-temp">{{ t.temporada ?? '—' }}</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .mc-leyenda { margin-bottom: 12px; }
    .mc { display: grid; min-width: 880px; font-size: 0.8125rem; font-variant-numeric: tabular-nums; }
    .mc-fila { display: grid; grid-template-columns: 170px repeat(12, minmax(42px, 1fr)) 84px 150px; gap: 2px; align-items: stretch; }
    .mc-fila + .mc-fila { margin-top: 2px; }
    .mc-cabeza { color: var(--tinta-3); font-weight: 600; font-size: 0.8125rem; margin-bottom: 4px; }
    .mc-hilo { display: flex; align-items: center; padding-right: 8px; min-width: 0; overflow-wrap: anywhere; font-weight: 600; }
    .mc-mes { text-align: center; }
    .mc-celda { display: flex; align-items: center; justify-content: center; min-height: 36px; border-radius: 4px; background: var(--superficie-2); }
    .mc-celda.fuerte { font-weight: 700; }
    .mc-celda.curso { outline: 1.5px dashed var(--viz-series-2); outline-offset: -3px; }
    .mc-celda-t { display: flex; align-items: center; justify-content: center; min-height: 34px; font-weight: 600; }
    .mc-num { display: flex; align-items: center; justify-content: flex-end; padding-right: 10px; white-space: nowrap; }
    .mc-temp { display: flex; align-items: center; color: var(--tinta-2); padding-left: 6px; }
    .mc-total { border-top: 1px solid var(--borde); padding-top: 4px; margin-top: 6px; }
  `,
})
export class MapaCalorMeses {
  readonly filas = input<FilaCalor[]>([]);
  readonly total = input<{ meses: (number | null)[]; total: number; temporada: string | null } | null>(null);
  readonly nombreTotal = input('Todos');
  /** Sin temporada todavía: solo los kilos, sin colores. */
  readonly conColores = input(true);
  /** "/admin/rotacion/hilo/": el nombre del hilo lleva a su detalle. */
  readonly rutaHilo = input<string | null>(null);
  readonly descripcion = input('Kilos vendidos por hilo y mes');

  readonly TRAMOS = TRAMOS_CALOR;
  readonly MESES_CORTOS = MESES_CORTOS;
  readonly MESES = MESES;

  /** El color de verdad de cada tramo y la letra que se lee mejor encima (una vez). */
  private readonly colores = computed(() =>
    TRAMOS_CALOR.map((t) => {
      const real = colorReal(t.fondo);
      return { fondo: t.fondo, tinta: tintaSobre(real) };
    })
  );

  fondo(c: CeldaMes): string | null {
    if (!this.conColores() || c.tramo == null) return null;
    return this.colores()[c.tramo - 1]?.fondo ?? null;
  }

  tinta(c: CeldaMes): string | null {
    if (!this.conColores() || c.tramo == null) return null;
    return this.colores()[c.tramo - 1]?.tinta ?? null;
  }

  num(v: number): string {
    return Math.round(v).toLocaleString('es-MX');
  }

  kg(v: number): string {
    return `${Math.round(v).toLocaleString('es-MX')} kg`;
  }

  /** Los totales en toneladas ("1.97 t"); lo de menos de una tonelada, en kg. */
  ton(v: number): string {
    return v >= 1000 ? `${(Math.round((v / 1000) * 100) / 100).toLocaleString('es-MX')} t` : this.kg(v);
  }
}
