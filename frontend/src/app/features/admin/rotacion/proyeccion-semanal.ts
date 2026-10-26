import { Component, computed, input } from '@angular/core';
import { SemanaProyeccion } from '../../../core/models/rotacion.models';
import { resumenGrafica } from '../../../shared/charts/resumen';
import { MESES_CORTOS, fechaLarga, kilos } from './rotacion-ui';

/**
 * CUÁNTO VA A HABER, SEMANA POR SEMANA (Por hilo, 2026-10-22): hoy y las
 * siguientes 26 semanas, en `--viz-series-1`. Las semanas en que quedan menos de
 * 3 semanas de venta van en `--punto-aviso`. Con el pedido, la cápsula verde
 * «Llega el <fecha> · +<kg>» sobre la semana en que llega. Abajo, «hoy» y el
 * mes de cada cambio de mes. Cajas HTML, con tooltip en cada columna y su tabla.
 */
@Component({
  selector: 'app-proyeccion-semanal',
  imports: [],
  template: `
    <div class="leyenda ps-leyenda">
      <span><i class="hay"></i>Lo que habría en {{ dondeTexto() }}</span>
      <span><i class="poco"></i>Le quedan menos de 3 semanas de venta</span>
      @if (conPedido() && llega() != null) { <span><span class="pill verde">Llega</span>el pedido</span> }
    </div>
    @if (comoTabla()) {
      <div class="tabla-scroll">
        <table class="grid">
          <thead><tr><th scope="col">Semana</th><th scope="col" class="num">Habría</th><th scope="col">Nota</th></tr></thead>
          <tbody>
            @for (s of columnas(); track s.inicio) {
              <tr>
                <th scope="row">{{ s.i === 0 ? 'Hoy' : 'Del ' + fecha(s.inicio) }}</th>
                <td class="num">{{ kg(s.v) }}</td>
                <td>{{ s.llega ? 'Llega el pedido' : s.poco ? 'Le quedan menos de 3 semanas de venta' : '' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <div class="ps" role="img" [attr.aria-label]="aria()">
        <div class="ps-cuerpo">
          <div class="ps-eje" aria-hidden="true" [style.height.px]="alto()">
            @for (t of escala().ticks; track t.v) { <span [style.bottom.%]="t.pct">{{ t.texto }}</span> }
          </div>
          <div class="ps-area" [style.height.px]="alto()">
            @for (t of escala().ticks; track t.v) { <i class="ps-linea" [style.bottom.%]="t.pct"></i> }
            @if (llegaPct(); as x) {
              <!-- Sobre la semana en que llega, sin salirse: a la izquierda se alinea a la izquierda, a la derecha a la derecha. -->
              <span class="pill verde ps-llega" [style.left.%]="x" [style.transform]="'translateX(-' + x + '%)'">Llega el {{ llegaTexto() }} · +{{ kg(kgPedido()) }}</span>
            }
            <div class="ps-cols">
              @for (s of columnas(); track s.inicio) {
                <div class="ps-col" [attr.title]="(s.i === 0 ? 'Hoy' : 'Semana del ' + fecha(s.inicio)) + ': ' + kg(s.v) + (s.llega ? ' · llega el pedido' : '')">
                  <i [class.poco]="s.poco" [style.height.%]="pct(s.v)"></i>
                </div>
              }
            </div>
          </div>
        </div>
        <div class="ps-pie" aria-hidden="true">
          @for (s of columnas(); track s.inicio) { <span>{{ s.etiqueta }}</span> }
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .ps-leyenda { margin-bottom: 14px; align-items: center; }
    .ps-leyenda i.hay, .ps-col i { background: var(--viz-series-1); }
    .ps-leyenda i.poco, .ps-col i.poco { background: var(--punto-aviso); }
    .ps-leyenda .pill { margin-right: 6px; }
    .ps { --eje: 64px; }
    .ps-cuerpo { display: flex; padding-top: 30px; }
    .ps-eje { position: relative; width: var(--eje); flex: 0 0 var(--eje); }
    .ps-eje span { position: absolute; right: 8px; transform: translateY(50%); font-size: 0.75rem; color: var(--tinta-3); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .ps-area { position: relative; flex: 1 1 auto; min-width: 0; border-bottom: 1px solid var(--borde); }
    .ps-linea { position: absolute; left: 0; right: 0; border-top: 1px solid var(--viz-grid); }
    .ps-cols { position: relative; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 2px; height: 100%; align-items: end; }
    .ps-col { position: relative; height: 100%; display: flex; align-items: flex-end; }
    .ps-col i { display: block; width: 100%; border-radius: 4px 4px 0 0; }
    .ps-llega { position: absolute; bottom: calc(100% + 4px); white-space: nowrap; z-index: 1; }
    .ps-pie { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 2px; margin-left: var(--eje); margin-top: 6px; }
    .ps-pie span { font-size: 0.75rem; color: var(--tinta-3); white-space: nowrap; overflow: visible; }
  `,
})
export class ProyeccionSemanal {
  readonly semanas = input<SemanaProyeccion[]>([]);
  /** «Si se pide hoy» (true) o «Si no se pide». */
  readonly conPedido = input(true);
  readonly llega = input<number | null>(null);
  readonly kgPedido = input(0);
  readonly llegaFecha = input<string | null>(null);
  readonly hoy = input('');
  readonly dondeTexto = input('los almacenes');
  readonly alto = input(200);
  readonly descripcion = input('');
  readonly comoTabla = input(false);

  readonly columnas = computed(() => {
    const ss = this.semanas();
    let mesAnterior = -1;
    let ultima = -9;
    return ss.map((s, i) => {
      const mes = Number(s.inicio.slice(5, 7)) - 1;
      // Un mes que empieza justo después de «hoy» no se rotula: se encimarían.
      const etiqueta = i === 0 ? 'hoy' : mes !== mesAnterior && i - ultima >= 3 ? MESES_CORTOS[mes] : '';
      if (etiqueta) ultima = i;
      mesAnterior = mes;
      const con = this.conPedido();
      return {
        i, inicio: s.inicio, etiqueta,
        v: con ? s.con_pedido : s.sin_pedido,
        poco: con ? s.poco_con : s.poco_sin,
        llega: con && this.llega() === i,
      };
    });
  });

  /** Dónde va la cápsula «Llega…»: el centro de su semana, en % del ancho. */
  readonly llegaPct = computed(() => {
    const cols = this.columnas();
    const i = cols.findIndex((c) => c.llega);
    return i < 0 ? null : Math.round(((i + 0.5) / cols.length) * 1000) / 10;
  });

  readonly escala = computed(() => {
    const max = Math.max(0, ...this.columnas().map((c) => c.v));
    if (!(max > 0)) return { tope: 1, ticks: [{ v: 0, pct: 0, texto: '0' }] };
    const crudo = max / 3;
    const pot = 10 ** Math.floor(Math.log10(crudo));
    const paso = [1, 2, 2.5, 5, 10].map((k) => k * pot).find((p) => p >= crudo) ?? 10 * pot;
    const tope = Math.ceil(max / paso) * paso;
    const ticks = [];
    for (let v = 0; v <= tope + 1e-9; v += paso) ticks.push({ v, pct: (v / tope) * 100, texto: v === 0 ? '0' : kilos(v) });
    return { tope, ticks };
  });

  pct(v: number): number {
    return v > 0 ? (v / this.escala().tope) * 100 : 0;
  }

  kg(v: number): string {
    return kilos(v);
  }

  fecha(d: string): string {
    return fechaLarga(d, this.hoy() || d);
  }

  readonly llegaTexto = computed(() => (this.llegaFecha() ? fechaLarga(this.llegaFecha(), this.hoy() || this.llegaFecha()!) : ''));

  readonly aria = computed(() =>
    resumenGrafica(this.descripcion(), this.columnas().map((c) => `${c.i === 0 ? 'hoy' : 'semana del ' + this.fecha(c.inicio)}: ${kilos(c.v)}`), 27)
  );
}
