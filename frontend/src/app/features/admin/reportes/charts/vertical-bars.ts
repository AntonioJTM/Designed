import { Component, computed, input } from '@angular/core';

export interface Barra {
  label: string;
  value: number;
  color?: string;
  title?: string;
}

/**
 * Gráfica de barras verticales en SVG puro (sin librerías).
 * Extremos superiores redondeados (4px) anclados a la línea base, 2px de
 * separación, ejes tenues y etiqueta de valor directa sobre cada barra.
 */
@Component({
  selector: 'app-vertical-bars',
  imports: [],
  template: `
    <svg class="viz-svg" [attr.viewBox]="'0 0 ' + W + ' ' + H" preserveAspectRatio="xMidYMid meet"
         role="img" width="100%">
      <!-- línea base -->
      <line [attr.x1]="pad.left" [attr.x2]="W - pad.right" [attr.y1]="baseY" [attr.y2]="baseY"
            stroke="var(--viz-baseline)" stroke-width="1" />
      @for (b of barras(); track b.label) {
        <path [attr.d]="b.d" [attr.fill]="b.color || 'var(--viz-series-1)'">
          <title>{{ b.title || b.label }}: {{ prefix() }}{{ fmt(b.value) }}</title>
        </path>
        <!-- valor sobre la barra -->
        @if (b.showLabel) {
          <text [attr.x]="b.cx" [attr.y]="b.top - 6" text-anchor="middle"
                class="viz-value">{{ prefix() }}{{ fmt(b.value) }}</text>
        }
        <!-- etiqueta de categoría (se ralea si hay muchas barras) -->
        @if (b.showLabel) {
          <text [attr.x]="b.cx" [attr.y]="baseY + 16" text-anchor="middle"
                class="viz-axis">{{ b.label }}</text>
        }
      }
    </svg>
  `,
})
export class VerticalBars {
  readonly data = input<Barra[]>([]);
  readonly prefix = input('');
  readonly decimals = input(0);

  readonly W = 640;
  readonly H = 240;
  readonly pad = { top: 26, right: 12, bottom: 28, left: 12 };
  readonly baseY = this.H - this.pad.bottom;

  private readonly max = computed(() => Math.max(1, ...this.data().map((d) => d.value)));

  readonly barras = computed(() => {
    const data = this.data();
    const plotW = this.W - this.pad.left - this.pad.right;
    const plotH = this.H - this.pad.top - this.pad.bottom;
    const n = Math.max(1, data.length);
    const slot = plotW / n;
    const barW = Math.min(slot * 0.6, 72);
    const max = this.max();
    // Con muchas barras, se muestra una etiqueta de cada `step` para no encimar.
    const step = Math.ceil(n / 12);

    return data.map((d, i) => {
      const h = max > 0 ? (d.value / max) * plotH : 0;
      const x = this.pad.left + i * slot + (slot - barW) / 2;
      const top = this.baseY - h;
      return {
        ...d,
        cx: x + barW / 2,
        top,
        d: this.pathTop(x, top, barW, h),
        showLabel: i % step === 0,
      };
    });
  });

  /** Rectángulo con solo las esquinas superiores redondeadas, base plana. */
  private pathTop(x: number, y: number, w: number, h: number): string {
    const r = Math.min(4, w / 2, h);
    const b = y + h;
    return `M${x},${b} L${x},${y + r} Q${x},${y} ${x + r},${y} ` +
      `L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${b} Z`;
  }

  fmt(v: number): string {
    return new Intl.NumberFormat('es-MX', { maximumFractionDigits: this.decimals() }).format(v);
  }
}
