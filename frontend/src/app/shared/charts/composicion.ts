import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

/** Un tramo de la barra: cuánto y de qué color. */
export interface Tramo {
  etiqueta: string;
  valor: number;
  color: string;
  /** Segundo dato del tooltip: cuántos clientes, cuántos hilos… */
  detalle?: string | null;
}

/**
 * UNA barra horizontal de ancho completo, partida en tramos. Contesta "de este
 * total, cuánto es de cada cosa" — la cartera por antigüedad es el caso: de todo
 * lo que te deben, cuánto está al día y cuánto lleva meses.
 *
 * El color de los tramos es una rampa ORDINAL (un solo tono, de claro a oscuro):
 * la antigüedad es una escala ordenada, y una rampa hace que el orden se VEA en
 * el color. Con colores categóricos —azul, naranja, verde— el lector tendría que
 * ir a la leyenda para saber cuál es peor.
 *
 * Reglas de la guía que hay que respetar al tocarla:
 *  · Hueco de 2 px del color del fondo entre tramos. NUNCA un borde: un trazo
 *    alrededor añade tinta que no es dato.
 *  · Solo el extremo del dato va redondeado; el arranque va a escuadra.
 *  · La leyenda es OBLIGATORIA (hay más de una serie) y la pone quien usa el
 *    componente, con su color y su etiqueta: la identidad no puede depender
 *    solo del color.
 *  · Dentro del tramo solo se escribe si el texto CABE con aire a los lados.
 *    Un número recortado es peor que ningún número; el que no cabe lo lleva la
 *    leyenda y el tooltip.
 */
@Component({
  selector: 'app-composicion',
  imports: [],
  template: `
    <svg
      class="viz-svg"
      [attr.viewBox]="'0 0 ' + W() + ' ' + alto"
      preserveAspectRatio="none"
      role="img"
      width="100%"
      [attr.height]="alto"
    >
      <!-- Carril: se ve cuando no hay nada que pintar. -->
      <rect x="0" y="0" [attr.width]="W()" [attr.height]="barH" rx="4"
            fill="var(--viz-grid)" opacity="0.45" />

      @for (t of tramos(); track t.etiqueta) {
        <path [attr.d]="t.d" [attr.fill]="t.color">
          <title>
            {{ t.etiqueta }}: {{ prefijo() }}{{ fmt(t.valor) }}{{ t.detalle ? ' · ' + t.detalle : '' }}
          </title>
        </path>
        @if (t.cabe) {
          <!-- Texto DENTRO del tramo: se elige blanco o tinta según qué tan
               oscuro es el relleno, para que siempre se lea. -->
          <text
            [attr.x]="t.centro"
            [attr.y]="barH / 2 + 4"
            [attr.fill]="t.textoClaro ? '#ffffff' : 'var(--viz-text)'"
            class="viz-en-tramo"
            text-anchor="middle"
          >
            {{ t.pct }}%
          </text>
        }
      }
    </svg>
  `,
})
export class Composicion {
  readonly data = input<Tramo[]>([]);
  readonly prefijo = input('$');
  readonly decimals = input(0);

  readonly barH = 34;
  readonly alto = 34;

  private readonly medido = signal(900);
  readonly W = computed(() => this.medido());

  constructor() {
    const host = inject(ElementRef).nativeElement as HTMLElement;
    const ro = new ResizeObserver((entradas) => {
      const w = Math.round(entradas[0].contentRect.width);
      if (w > 120) this.medido.set(w);
    });
    ro.observe(host);
    inject(DestroyRef).onDestroy(() => ro.disconnect());
  }

  private readonly total = computed(() =>
    Math.max(0, this.data().reduce((s, t) => s + Math.max(0, t.valor), 0))
  );

  readonly tramos = computed(() => {
    const total = this.total();
    if (total <= 0) return [];
    const W = this.W();
    const GAP = 2;
    const conValor = this.data().filter((t) => t.valor > 0);

    let x = 0;
    return conValor.map((t, i) => {
      const ancho = (t.valor / total) * W;
      const ultimo = i === conValor.length - 1;
      const primero = i === 0;
      // El hueco se le quita al tramo, así la suma sigue midiendo el total.
      const dibujado = Math.max(0, ancho - (ultimo ? 0 : GAP));
      const pct = Math.round((t.valor / total) * 100);

      const pieza = {
        ...t,
        d: this.path(x, dibujado, primero, ultimo),
        centro: x + dibujado / 2,
        pct,
        // Solo se escribe dentro si el texto cabe con aire: "100%" son unos
        // 34 px, más 8 px de margen a cada lado.
        cabe: dibujado > 50,
        textoClaro: this.esOscuro(t.color),
      };
      x += ancho;
      return pieza;
    });
  });

  /**
   * Redondea solo los extremos LIBRES de la barra completa: el izquierdo del
   * primer tramo y el derecho del último. Los cortes de en medio van a escuadra
   * porque ahí la barra continúa.
   */
  private path(x: number, w: number, primero: boolean, ultimo: boolean): string {
    const h = this.barH;
    const r = Math.min(4, w);
    if (w <= 0.5) return `M${x},0 L${x},${h} Z`;
    const izq = primero
      ? `M${x + r},0 Q${x},0 ${x},${r} L${x},${h - r} Q${x},${h} ${x + r},${h}`
      : `M${x},0 L${x},${h}`;
    const der = ultimo
      ? `L${x + w - r},${h} Q${x + w},${h} ${x + w},${h - r} L${x + w},${r} Q${x + w},0 ${x + w - r},0`
      : `L${x + w},${h} L${x + w},0`;
    return `${izq} ${der} Z`;
  }

  /**
   * Si el relleno es oscuro, el texto va en blanco. Se calcula con la luminancia
   * relativa aproximada del hex; los colores de la rampa vienen de la paleta
   * validada, así que basta con distinguir claro de oscuro.
   */
  private esOscuro(hexOVar: string): boolean {
    const m = /^#?([0-9a-f]{6})$/i.exec(hexOVar.trim());
    if (!m) return true; // un var() de la paleta: los pasos usados son oscuros
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    // Luminancia percibida (Rec. 601), suficiente para elegir blanco o tinta.
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.6;
  }

  fmt(v: number): string {
    return new Intl.NumberFormat('es-MX', {
      maximumFractionDigits: this.decimals(),
    }).format(v);
  }
}
