import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

/** Un pedazo de la barra: cuánto hay de esa serie (almacén) en esa categoría. */
export interface Segmento {
  serie: string;
  value: number;
  color: string;
}

export interface BarraApilada {
  label: string;
  /** Contexto que aparece en el tooltip (material, línea…). */
  detalle?: string;
  total: number;
  segmentos: Segmento[];
}

/**
 * Barras horizontales APILADAS en SVG puro. Contesta "de esto, cuánto hay y
 * dónde está": una barra por categoría (el color del hilo) y un pedazo por serie
 * (el almacén).
 *
 * Reglas de la guía de visualización que hay que respetar al tocarla:
 *  · Separación de 2 px del color de fondo entre pedazos —NO un borde alrededor—.
 *  · Solo el extremo del dato va redondeado (4 px): el último pedazo por la
 *    derecha. El arranque queda a escuadra porque está anclado al eje.
 *  · Se etiqueta el TOTAL al final de la barra, que es el extremo libre. Los
 *    pedazos de en medio NO llevan número: no cabe y se convierte en ruido; los
 *    lleva la leyenda y el tooltip de cada uno.
 *  · El texto nunca va del color de la serie; usa los tokens de texto.
 * La leyenda la pone quien la usa (`.viz-legend`), y es obligatoria: la identidad
 * no puede depender solo del color.
 */
@Component({
  selector: 'app-stacked-bars',
  imports: [],
  template: `
    <svg class="viz-svg" [attr.viewBox]="'0 0 ' + W() + ' ' + alto()"
         preserveAspectRatio="xMidYMid meet" role="img" width="100%">
      @for (b of barras(); track b.label) {
        <!-- etiqueta de la categoría (completa en el tooltip si se recortó) -->
        <text [attr.x]="0" [attr.y]="b.cy + 4" class="viz-axis" text-anchor="start">
          {{ b.corta }}<title>{{ b.label }}{{ b.detalle ? ' · ' + b.detalle : '' }}</title>
        </text>
        <!-- carril tenue: hasta dónde llegaría el máximo -->
        <rect [attr.x]="gutter" [attr.y]="b.y" [attr.width]="plotW()" [attr.height]="barH"
              rx="4" fill="var(--viz-grid)" opacity="0.5" />
        @for (s of b.piezas; track s.serie) {
          <path [attr.d]="s.d" [attr.fill]="s.color">
            <title>
              {{ b.label }}{{ b.detalle ? ' · ' + b.detalle : '' }} · {{ s.serie }}:
              {{ fmt(s.value) }} {{ unidad() }}
            </title>
          </path>
        }
        <!-- total al final: el único número directo, con su unidad -->
        <text [attr.x]="b.valX" [attr.y]="b.cy + 4" class="viz-value" text-anchor="start">
          {{ fmt(b.total) }} {{ unidad() }}
        </text>
      }
    </svg>
  `,
})
export class StackedBars {
  readonly data = input<BarraApilada[]>([]);
  readonly unidad = input('kg');
  readonly decimals = input(0);

  readonly gutter = 150; // espacio para el nombre del color
  readonly rowH = 30;
  readonly barH = 18;
  readonly padRight = 118; // espacio para el total con su unidad

  /**
   * El lienzo se dibuja al ANCHO REAL que ocupa en pantalla, medido con un
   * `ResizeObserver`. Con un viewBox fijo pasaba una de dos, y las dos se vieron:
   * si era angosto (640) el SVG se estiraba y escalaba TODO el texto al doble —la
   * gráfica se veía tosca—; si se le ponía un tope de ancho, sobraba media
   * tarjeta vacía a la derecha. Midiendo, la escala es 1 a cualquier ancho: el
   * texto sale de su tamaño y las barras llenan el espacio.
   */
  private readonly medido = signal(980);
  readonly W = computed(() => this.medido());
  readonly plotW = computed(() => this.W() - this.gutter - this.padRight);
  readonly alto = computed(() => Math.max(1, this.data().length) * this.rowH + 8);

  constructor() {
    const host = inject(ElementRef).nativeElement as HTMLElement;
    const ro = new ResizeObserver((entradas) => {
      const w = Math.round(entradas[0].contentRect.width);
      // Debajo de eso no cabe ni la etiqueta: se queda con el ancho por omisión.
      if (w > 360) this.medido.set(w);
    });
    ro.observe(host);
    inject(DestroyRef).onDestroy(() => ro.disconnect());
  }

  /** Todas las barras se miden contra la más grande. */
  private readonly max = computed(() => Math.max(1, ...this.data().map((d) => d.total)));

  readonly barras = computed(() => {
    const max = this.max();
    const plotW = this.plotW();
    const GAP = 2; // el hueco que separa los pedazos, del color del fondo

    return this.data().map((d, i) => {
      const y = i * this.rowH + 6;
      const cy = y + this.barH / 2;
      const conValor = d.segmentos.filter((s) => s.value > 0);

      let x = this.gutter;
      const piezas = conValor.map((s, j) => {
        const ancho = (s.value / max) * plotW;
        const ultimo = j === conValor.length - 1;
        // El hueco se le quita al pedazo, así la suma sigue midiendo lo mismo.
        const dibujado = Math.max(0, ancho - (ultimo ? 0 : GAP));
        const pieza = {
          ...s,
          d: ultimo
            ? this.pathDerechaRedonda(x, y, dibujado, this.barH)
            : this.pathRecto(x, y, dibujado, this.barH),
        };
        x += ancho;
        return pieza;
      });

      const anchoTotal = (d.total / max) * plotW;
      return {
        ...d,
        y,
        cy,
        piezas,
        valX: this.gutter + anchoTotal + 8,
        corta: d.label.length > 22 ? d.label.slice(0, 21) + '…' : d.label,
      };
    });
  });

  /** Pedazo de en medio: a escuadra por los dos lados. */
  private pathRecto(x: number, y: number, w: number, h: number): string {
    return `M${x},${y} L${x + w},${y} L${x + w},${y + h} L${x},${y + h} Z`;
  }

  /** Último pedazo: el extremo del dato lleva 4 px de redondeo. */
  private pathDerechaRedonda(x: number, y: number, w: number, h: number): string {
    const r = Math.min(4, h / 2, w);
    return `M${x},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} ` +
      `L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x},${y + h} Z`;
  }

  fmt(v: number): string {
    return new Intl.NumberFormat('es-MX', { maximumFractionDigits: this.decimals() }).format(v);
  }
}
