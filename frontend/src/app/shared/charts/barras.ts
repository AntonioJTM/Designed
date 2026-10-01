import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

/** Una barra: qué es, cuánto vale y qué contexto se muestra al pasar el ratón. */
export interface Barra {
  label: string;
  value: number;
  /** Segundo renglón bajo el nombre: el calibre, el material, los días… */
  detalle?: string | null;
  /**
   * Color de ESTA barra. Sin él todas van del slot 1, que es lo correcto para
   * una sola serie. Solo se pasa cuando el color significa algo —lo que pierde
   * dinero va en rojo— y entonces la pantalla tiene que poner la etiqueta que
   * lo explique: el color nunca carga el significado solo.
   */
  color?: string;
  /** Texto extra en el tooltip. */
  title?: string;
}

/**
 * Barras horizontales en SVG puro, con el cero EN SU SITIO.
 *
 * Si todos los valores son positivos el cero queda a la izquierda y son barras
 * normales. Si hay negativos, el cero se coloca donde toca y las barras crecen a
 * los dos lados desde ahí — que es lo que hace falta para leer un margen: de un
 * golpe se ve qué hilo deja y qué hilo cuesta.
 *
 * Reglas de la guía de visualización que hay que respetar al tocarla:
 *  · La barra no pasa de 24 px de grosor: el resto del carril es aire.
 *  · Solo el extremo del DATO va redondeado (4 px); el lado del cero queda a
 *    escuadra porque está anclado a la línea base.
 *  · La línea del cero es de 1 px, sólida y recesiva. Nunca punteada.
 *  · El valor va al final de cada barra —etiqueta directa— y el texto usa los
 *    tokens de texto, NUNCA el color de la serie.
 *  · Una sola serie NO lleva leyenda: el título de la tarjeta ya dice qué se
 *    está midiendo, y una leyenda de un solo color solo repetiría el título.
 *  · Cada barra lleva su tooltip: una gráfica en HTML es interactiva y esconder
 *    el dato exacto sería desperdiciarlo.
 *
 * El lienzo se mide con `ResizeObserver` en vez de usar un viewBox fijo: con un
 * viewBox angosto dentro de una tarjeta ancha, el SVG se estira y escala TODO el
 * texto, y la gráfica se ve tosca. Midiendo, la escala siempre es 1.
 */
@Component({
  selector: 'app-barras',
  imports: [],
  template: `
    <svg
      class="viz-svg"
      [attr.viewBox]="'0 0 ' + W() + ' ' + alto()"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      width="100%"
    >
      <!-- La línea del cero. Solo se dibuja cuando hay negativos: con todo
           positivo coincide con el borde del carril y sería ruido. -->
      @if (hayNegativos()) {
        <line
          [attr.x1]="x0()"
          [attr.y1]="2"
          [attr.x2]="x0()"
          [attr.y2]="alto() - 2"
          stroke="var(--viz-baseline)"
          stroke-width="1"
        />
      }

      @for (b of barras(); track b.label) {
        <!-- Nombre a la izquierda; completo en el tooltip si se recortó. -->
        <text [attr.x]="0" [attr.y]="b.cy - 1" class="viz-axis" text-anchor="start">
          {{ b.corta }}<title>{{ b.label }}</title>
        </text>
        @if (b.detalle) {
          <text [attr.x]="0" [attr.y]="b.cy + 11" class="viz-axis viz-sub" text-anchor="start">
            {{ b.detalle }}
          </text>
        }

        <!-- Carril tenue: hasta dónde llegaría el máximo. Solo con valores
             POSITIVOS: si la barra arranca de un cero que está en medio del
             lienzo, un carril de ancho completo deja gris vacío del lado
             contrario y se lee como si faltara dato. Con negativos, la línea
             del cero ya ancla la lectura. -->
        @if (!hayNegativos()) {
          <rect
            [attr.x]="gutter()"
            [attr.y]="b.y"
            [attr.width]="plotW()"
            [attr.height]="barH"
            rx="4"
            fill="var(--viz-grid)"
            opacity="0.45"
          />
        }

        <path [attr.d]="b.d" [attr.fill]="b.color || 'var(--viz-series-1)'">
          <title>{{ b.title || b.label }}: {{ conSigno(b.value) }} {{ unidad() }}</title>
        </path>

        <!-- El valor, al extremo libre de la barra. -->
        <text
          [attr.x]="b.valX"
          [attr.y]="b.cy + 4"
          class="viz-value"
          [attr.text-anchor]="b.anclaFin ? 'end' : 'start'"
        >
          {{ conSigno(b.value) }} {{ unidad() }}
        </text>
      }
    </svg>
  `,
})
export class Barras {
  readonly data = input<Barra[]>([]);
  readonly unidad = input('');
  readonly prefijo = input('');
  readonly decimals = input(0);
  /** Ancho reservado para los nombres. Se sube cuando son largos. */
  readonly gutter = input(170);

  readonly rowH = 34;
  readonly barH = 20; // por debajo del tope de 24 px de la guía
  readonly padRight = 130; // espacio para el valor con su unidad

  private readonly medido = signal(900);
  readonly W = computed(() => this.medido());
  readonly plotW = computed(() => Math.max(80, this.W() - this.gutter() - this.padRight));
  readonly alto = computed(() => Math.max(1, this.data().length) * this.rowH + 8);

  constructor() {
    const host = inject(ElementRef).nativeElement as HTMLElement;
    const ro = new ResizeObserver((entradas) => {
      const w = Math.round(entradas[0].contentRect.width);
      if (w > 360) this.medido.set(w);
    });
    ro.observe(host);
    inject(DestroyRef).onDestroy(() => ro.disconnect());
  }

  readonly hayNegativos = computed(() => this.data().some((d) => d.value < 0));

  /** La escala se mide contra el valor absoluto más grande, a los dos lados. */
  private readonly escala = computed(() => {
    const vals = this.data().map((d) => d.value);
    const max = Math.max(0, ...vals);
    const min = Math.min(0, ...vals);
    const span = max - min;
    return { max, min, span: span > 0 ? span : 1 };
  });

  /** Dónde cae el cero en el eje. */
  readonly x0 = computed(() => {
    const { min, span } = this.escala();
    return this.gutter() + (-min / span) * this.plotW();
  });

  readonly barras = computed(() => {
    const { span } = this.escala();
    const plotW = this.plotW();
    const x0 = this.x0();

    return this.data().map((d, i) => {
      const y = i * this.rowH + 6;
      const cy = y + this.barH / 2;
      const ancho = (Math.abs(d.value) / span) * plotW;
      const negativa = d.value < 0;

      // La barra arranca en el cero y crece hacia su lado.
      const x = negativa ? x0 - ancho : x0;
      const d2 = negativa
        ? this.pathIzquierdaRedonda(x, y, ancho, this.barH)
        : this.pathDerechaRedonda(x, y, ancho, this.barH);

      return {
        ...d,
        y,
        cy,
        d: d2,
        // El valor va del lado libre: a la izquierda si la barra es negativa.
        valX: negativa ? x - 8 : x + ancho + 8,
        anclaFin: negativa,
        corta: d.label.length > 24 ? d.label.slice(0, 23) + '…' : d.label,
      };
    });
  });

  /** Crece a la derecha: el extremo del dato lleva los 4 px. */
  private pathDerechaRedonda(x: number, y: number, w: number, h: number): string {
    const r = Math.min(4, h / 2, Math.max(0, w));
    if (w <= 0.5) return `M${x},${y} L${x},${y + h} Z`;
    return (
      `M${x},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} ` +
      `L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x},${y + h} Z`
    );
  }

  /** Crece a la izquierda: el redondeo va en el extremo izquierdo. */
  private pathIzquierdaRedonda(x: number, y: number, w: number, h: number): string {
    const r = Math.min(4, h / 2, Math.max(0, w));
    if (w <= 0.5) return `M${x + w},${y} L${x + w},${y + h} Z`;
    return (
      `M${x + w},${y} L${x + r},${y} Q${x},${y} ${x},${y + r} ` +
      `L${x},${y + h - r} Q${x},${y + h} ${x + r},${y + h} L${x + w},${y + h} Z`
    );
  }

  fmt(v: number): string {
    return new Intl.NumberFormat('es-MX', {
      maximumFractionDigits: this.decimals(),
    }).format(v);
  }

  /**
   * El valor con su prefijo y su signo en el orden correcto: "-$3,200" y no
   * "$-3,200", que es lo que sale de concatenar prefijo + número y se lee como
   * un error de captura.
   */
  conSigno(v: number): string {
    const signo = v < 0 ? '-' : '';
    return `${signo}${this.prefijo()}${this.fmt(Math.abs(v))}`;
  }
}
