import { Component, computed, input } from '@angular/core';
import { Barra } from './vertical-bars';

/**
 * Gráfica de barras horizontales en SVG puro. Útil cuando hay muchas categorías
 * o etiquetas largas (p.ej. ranking de más vendidos). Extremo derecho redondeado.
 */
@Component({
  selector: 'app-horizontal-bars',
  imports: [],
  template: `
    <svg class="viz-svg" [attr.viewBox]="'0 0 ' + W + ' ' + alto()" preserveAspectRatio="xMidYMid meet"
         role="img" width="100%">
      @for (b of barras(); track b.label) {
        <!-- etiqueta a la izquierda (truncada si es larga; completa en el tooltip) -->
        <text [attr.x]="0" [attr.y]="b.cy + 4" class="viz-axis" text-anchor="start">
          {{ b.corta }}<title>{{ b.label }}</title>
        </text>
        <!-- carril tenue -->
        <rect [attr.x]="gutter" [attr.y]="b.y" [attr.width]="plotW" [attr.height]="barH"
              rx="4" fill="var(--viz-grid)" opacity="0.5" />
        <!-- barra -->
        <path [attr.d]="b.d" [attr.fill]="b.color || 'var(--viz-series-1)'">
          <title>{{ b.title || b.label }}: {{ prefix() }}{{ fmt(b.value) }}</title>
        </path>
        <!-- valor al final -->
        <text [attr.x]="b.valX" [attr.y]="b.cy + 4" class="viz-value"
              [attr.text-anchor]="b.dentro ? 'end' : 'start'">{{ prefix() }}{{ fmt(b.value) }}</text>
      }
    </svg>
  `,
})
export class HorizontalBars {
  readonly data = input<Barra[]>([]);
  readonly prefix = input('');
  readonly decimals = input(0);

  readonly W = 640;
  readonly gutter = 92; // espacio para la etiqueta izquierda
  readonly rowH = 34;
  readonly barH = 20;
  readonly padRight = 52;

  readonly plotW = this.W - this.gutter - this.padRight;
  readonly alto = computed(() => Math.max(1, this.data().length) * this.rowH + 8);

  private readonly max = computed(() => Math.max(1, ...this.data().map((d) => d.value)));

  readonly barras = computed(() => {
    const max = this.max();
    return this.data().map((d, i) => {
      const w = max > 0 ? (d.value / max) * this.plotW : 0;
      const y = i * this.rowH + 6;
      const cy = y + this.barH / 2;
      // Si la barra es corta, el valor va afuera (a la derecha); si es larga, dentro.
      const dentro = w > 46;
      return {
        ...d,
        y,
        cy,
        d: this.pathRight(this.gutter, y, w, this.barH),
        valX: dentro ? this.gutter + w - 6 : this.gutter + w + 6,
        dentro,
        corta: d.label.length > 13 ? d.label.slice(0, 12) + '…' : d.label,
      };
    });
  });

  /** Barra con esquinas derechas redondeadas (extremo de dato). */
  private pathRight(x: number, y: number, w: number, h: number): string {
    const r = Math.min(4, h / 2, w);
    return `M${x},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} ` +
      `L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x},${y + h} Z`;
  }

  fmt(v: number): string {
    return new Intl.NumberFormat('es-MX', { maximumFractionDigits: this.decimals() }).format(v);
  }
}
