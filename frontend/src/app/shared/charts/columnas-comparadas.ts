import { Component, computed, input } from '@angular/core';
import { resumenGrafica } from './resumen';

/** Un mes: lo del año anterior y lo del año en curso (real, en curso o lo que se espera). */
export interface MesComparado {
  /** "ene", "feb"… */
  etiqueta: string;
  /** "enero", para el tooltip. */
  nombre: string;
  anterior: number | null;
  actual: number | null;
  origen: 'real' | 'en_curso' | 'pronostico' | null;
}

/** Una marca sobre varios meses seguidos ("Temporada alta"). */
export interface MarcaMeses {
  texto: string;
  /** Índices de los meses (0 = el primero de la gráfica), seguidos. */
  meses: number[];
  /** La alta lleva fondo; la baja, solo su raya. */
  alta: boolean;
}

/**
 * COLUMNAS COMPARADAS (Rotación de inventario, 2026-10-22): por mes, el año
 * anterior (`--viz-otros`) junto al año en curso (`--viz-series-1`). El mes en
 * curso va en `--viz-series-2` y los meses que faltan, en contorno punteado
 * (`--viz-series-1`): "lo que se espera vender". Arriba, las marcas «Temporada
 * alta» (con fondo `--acento-tenue`) y «Temporada baja».
 *
 * Reglas de la guía: solo la punta del dato redondeada (4 px), hueco de 2 px
 * entre la pareja, leyenda (son varias series), tooltip en cada columna y la
 * tabla equivalente (`comoTabla`). Son cajas HTML, no SVG: no escalan la letra.
 */
@Component({
  selector: 'app-columnas-comparadas',
  imports: [],
  template: `
    <div class="leyenda cc-leyenda">
      <span><i class="ant"></i>{{ anioAnterior() }}</span>
      <span><i class="act"></i>{{ anioActual() }}</span>
      @if (textoEnCurso()) { <span><i class="curso"></i>{{ textoEnCurso() }}</span> }
      @if (hayPronostico()) { <span><i class="prono"></i>Lo que se espera vender</span> }
    </div>
    @if (comoTabla()) {
      <div class="tabla-scroll">
        <table class="grid cc-tabla">
          <thead><tr><th scope="col">Mes</th><th scope="col" class="num">{{ anioAnterior() }}</th><th scope="col" class="num">{{ anioActual() }}</th></tr></thead>
          <tbody>
            @for (m of meses(); track $index) {
              <tr>
                <th scope="row">{{ m.nombre }}</th>
                <td class="num">{{ fmt(m.anterior) }}</td>
                <td class="num">
                  {{ fmt(m.actual) }}
                  @if (m.origen === 'en_curso') { <span class="muted"> · va en curso</span> }
                  @if (m.origen === 'pronostico') { <span class="muted"> · lo que se espera</span> }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <div class="cc" role="img" [attr.aria-label]="aria()">
        <div class="cc-marcas" aria-hidden="true">
          @for (mk of marcas(); track mk.texto) {
            <span class="cc-marca" [class.alta]="mk.alta"
                  [style.grid-column]="(mk.meses[0] + 1) + ' / span ' + mk.meses.length">{{ mk.texto }}</span>
          }
        </div>
        <div class="cc-cuerpo">
          <div class="cc-eje" aria-hidden="true" [style.height.px]="alto()">
            @for (t of escala().ticks; track t.v) { <span [style.bottom.%]="t.pct">{{ t.texto }}</span> }
          </div>
          <div class="cc-area" [style.height.px]="alto()">
            @for (t of escala().ticks; track t.v) { <i class="cc-linea" [style.bottom.%]="t.pct"></i> }
            @for (mk of marcas(); track mk.texto) {
              @if (mk.alta) {
                <i class="cc-fondo" [style.left.%]="(mk.meses[0] / meses().length) * 100"
                   [style.width.%]="(mk.meses.length / meses().length) * 100"></i>
              }
            }
            <div class="cc-grupos">
              @for (m of meses(); track $index) {
                <div class="cc-grupo">
                  <i class="ant" [style.height.%]="pct(m.anterior)" [attr.title]="titulo(m.nombre, anioAnterior(), m.anterior)"></i>
                  <i [class.act]="m.origen === 'real'" [class.curso]="m.origen === 'en_curso'"
                     [class.prono]="m.origen === 'pronostico'" [style.height.%]="pct(m.actual)"
                     [attr.title]="titulo(m.nombre, anioActual(), m.actual, m.origen)"></i>
                </div>
              }
            </div>
          </div>
        </div>
        <div class="cc-pie" aria-hidden="true">
          @for (m of meses(); track $index) { <span>{{ m.etiqueta }}</span> }
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .cc-leyenda { margin-bottom: 12px; }
    .cc-leyenda i.ant, .cc-grupo i.ant { background: var(--viz-otros); }
    .cc-leyenda i.act, .cc-grupo i.act { background: var(--viz-series-1); }
    .cc-leyenda i.curso, .cc-grupo i.curso { background: var(--viz-series-2); }
    .cc-leyenda i.prono { background: transparent; border: 1.5px dashed var(--viz-series-1); }
    .cc { --eje: 44px; }
    .cc-marcas { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); margin-left: var(--eje); min-height: 22px; }
    .cc-marca { font-size: 0.75rem; font-weight: 600; color: var(--tinta-2); text-align: center; border-bottom: 2px solid var(--borde);
      padding-bottom: 3px; margin: 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cc-marca.alta { color: var(--acento-oscuro); border-bottom-color: var(--acento); }
    .cc-cuerpo { display: flex; }
    .cc-eje { position: relative; width: var(--eje); flex: 0 0 var(--eje); }
    .cc-eje span { position: absolute; right: 8px; transform: translateY(50%); font-size: 0.75rem; color: var(--tinta-3);
      font-variant-numeric: tabular-nums; white-space: nowrap; }
    .cc-area { position: relative; flex: 1 1 auto; min-width: 0; border-bottom: 1px solid var(--borde); }
    .cc-linea { position: absolute; left: 0; right: 0; height: 0; border-top: 1px solid var(--viz-grid); }
    .cc-fondo { position: absolute; top: 0; bottom: 0; background: var(--acento-tenue); }
    .cc-grupos { position: relative; display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); height: 100%; }
    .cc-grupo { display: flex; justify-content: center; align-items: flex-end; gap: 2px; padding: 0 12%; }
    .cc-grupo i { display: block; flex: 1 1 0; max-width: 26px; border-radius: 4px 4px 0 0; min-height: 0; }
    .cc-grupo i.prono { background: transparent; border: 1.5px dashed var(--viz-series-1); border-bottom: 0; }
    .cc-pie { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); margin-left: var(--eje); margin-top: 6px; }
    .cc-pie span { text-align: center; font-size: 0.75rem; color: var(--tinta-3); }
    @media (max-width: 640px) { .cc-grupo { padding: 0 4%; gap: 1px; } .cc-pie span { font-size: 0.625rem; } }
  `,
})
export class ColumnasComparadas {
  readonly meses = input<MesComparado[]>([]);
  readonly anioAnterior = input<string | number>('');
  readonly anioActual = input<string | number>('');
  /** "Octubre 2026, va en curso (hasta el 21)"; vacío si no hay mes en curso. */
  readonly textoEnCurso = input('');
  readonly marcas = input<MarcaMeses[]>([]);
  /** Alto de la zona de dibujo, en px. */
  readonly alto = input(200);
  /** Lo que dice la gráfica (título), para el lector de pantalla. */
  readonly descripcion = input('');
  /** Con la tabla en lugar de las columnas («Ver como tabla»). */
  readonly comoTabla = input(false);

  readonly hayPronostico = computed(() => this.meses().some((m) => m.origen === 'pronostico' && m.actual != null));

  /** Kilos, o toneladas si lo más alto pasa de 1,000 kg. */
  private readonly enToneladas = computed(() => this.maximo() >= 1000);
  private readonly maximo = computed(() => Math.max(0, ...this.meses().flatMap((m) => [m.anterior ?? 0, m.actual ?? 0])));

  /** La escala: 3 o 4 rayas "redondas" (0, 1 t, 2 t, 3 t). */
  readonly escala = computed(() => {
    const max = this.maximo();
    if (!(max > 0)) return { tope: 1, ticks: [{ v: 0, pct: 0, texto: '0' }] };
    const crudo = max / 3;
    const pot = 10 ** Math.floor(Math.log10(crudo));
    const paso = [1, 2, 2.5, 5, 10].map((k) => k * pot).find((p) => p >= crudo) ?? 10 * pot;
    const tope = Math.ceil(max / paso) * paso;
    const ticks = [];
    for (let v = 0; v <= tope + 1e-9; v += paso) {
      ticks.push({ v, pct: (v / tope) * 100, texto: v === 0 ? '0' : this.fmtEje(v) });
    }
    return { tope, ticks };
  });

  pct(v: number | null): number {
    if (v == null || !(v > 0)) return 0;
    return (v / this.escala().tope) * 100;
  }

  private fmtEje(v: number): string {
    if (this.enToneladas()) return `${(Math.round((v / 1000) * 100) / 100).toLocaleString('es-MX')} t`;
    return `${Math.round(v).toLocaleString('es-MX')} kg`;
  }

  fmt(v: number | null): string {
    if (v == null) return '—';
    return `${Math.round(v).toLocaleString('es-MX')} kg`;
  }

  titulo(mes: string, anio: string | number, v: number | null, origen?: string | null): string {
    if (v == null) return `${mes} ${anio}: sin datos`;
    const que = origen === 'en_curso' ? ' (va en curso)' : origen === 'pronostico' ? ' (lo que se espera)' : '';
    return `${mes} ${anio}: ${this.fmt(v)}${que}`;
  }

  readonly aria = computed(() =>
    resumenGrafica(this.descripcion(), this.meses().map((m) =>
      `${m.nombre}: ${this.anioAnterior()} ${this.fmt(m.anterior)}, ${this.anioActual()} ${this.fmt(m.actual)}`), 12)
  );
}
