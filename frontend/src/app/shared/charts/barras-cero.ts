import { Component, computed, input } from '@angular/core';

/** Un renglón: qué es, cuánto vale y qué se escribe a la derecha. */
export interface BarraCero {
  etiqueta: string;
  valor: number;
  /** Lo que va en la columna de la derecha: "$18,400 · 31%". La pone la pantalla. */
  rotulo: string;
  /** El dato completo, al pasar el ratón. */
  titulo?: string;
}

/**
 * Barras horizontales HECHAS CON CAJAS, con el cero EN SU SITIO y una columna
 * fija a la derecha para la cifra. Es "Qué colores dejan dinero": de un golpe se
 * ve qué hilo deja y cuál se vendió perdiendo.
 *
 * Hace lo mismo que `barras.ts` (que es SVG), pero con el lenguaje del
 * rediseño: nombre | barra | cifra, en renglones de texto normal que se leen
 * del tamaño de la página y que un lector de pantalla recorre como texto.
 *
 * Reglas de la guía que hay que respetar al tocarla:
 *  · El cero va donde toca. Con todo positivo queda a la izquierda y no se
 *    dibuja la raya (coincidiría con el borde); con negativos se corre a su
 *    sitio y las barras crecen a los dos lados.
 *  · Solo el extremo del DATO va redondeado (4 px); el lado del cero queda a
 *    escuadra porque está anclado a la raya.
 *  · Lo que gana va del slot 1 (azul) y lo que pierde del slot 2 (naranja) de
 *    la paleta validada: el par pasa el validador (ΔE 24.7 en protanopia, 33.6
 *    en visión normal). El color NO carga el significado solo: la cifra lleva
 *    su signo ("-$1,400", con el signo ANTES del símbolo) y la raya marca el lado.
 *  · La cifra va en tinta de texto, nunca del color de la serie; la de lo que
 *    pierde, en la tinta de alerta.
 *  · Sin carril gris de fondo: con negativos dejaría gris vacío del lado
 *    contrario y se leería como si faltara dato.
 */
@Component({
  selector: 'app-barras-cero',
  imports: [],
  template: `
    <div class="bc" [style.--bc-etiqueta]="anchoEtiqueta()" [style.--bc-cola]="anchoCola()">
      @for (b of barras(); track $index) {
        <div class="bc-fila" [attr.title]="b.titulo || null">
          <span class="bc-etiqueta">{{ b.etiqueta }}</span>
          <div class="bc-carril" aria-hidden="true">
            @if (hayNegativos()) {
              <div class="bc-cero" [style.left.%]="x0()"></div>
            }
            <div class="bc-barra" [class.negativa]="b.negativa"
                 [style.left.%]="b.izq" [style.width.%]="b.ancho"></div>
          </div>
          <span class="bc-rotulo" [class.negativa]="b.negativa">{{ b.rotulo }}</span>
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .bc { display: flex; flex-direction: column; gap: 10px; }
    .bc-fila {
      display: grid; align-items: center; gap: 12px;
      grid-template-columns: var(--bc-etiqueta, 170px) minmax(0, 1fr) var(--bc-cola, 120px);
    }
    .bc-etiqueta { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .bc-carril { position: relative; height: 18px; }
    /* La raya del cero: 1 px, sólida y recesiva. */
    .bc-cero { position: absolute; top: -4px; bottom: -4px; width: 1px; background: var(--viz-baseline); }
    .bc-barra {
      position: absolute; top: 0; height: 18px;
      background: var(--viz-series-1); border-radius: 0 4px 4px 0;
    }
    .bc-barra.negativa { background: var(--viz-series-2); border-radius: 4px 0 0 4px; }
    .bc-rotulo {
      font-size: 13px; font-weight: 600; text-align: right; white-space: nowrap;
      font-variant-numeric: tabular-nums; color: var(--tinta);
    }
    .bc-rotulo.negativa { color: var(--alerta-t); }
    /* En el celular el nombre y la cifra van arriba y la barra abajo, a lo ancho:
       con tres columnas a 360 px la barra se quedaba en un hilito. */
    @media (max-width: 560px) {
      .bc-fila { grid-template-columns: minmax(0, 1fr) auto; row-gap: 6px; }
      .bc-carril { grid-column: 1 / -1; grid-row: 2; }
    }
  `,
})
export class BarrasCero {
  readonly data = input<BarraCero[]>([]);
  /** Ancho de la columna de nombres (CSS). "MARINO OSCURO 1/30" cabe en 170 px. */
  readonly anchoEtiqueta = input('170px');
  /** Ancho de la columna de la cifra (CSS). */
  readonly anchoCola = input('120px');

  readonly hayNegativos = computed(() => this.data().some((d) => d.valor < 0));

  /** La escala abarca del valor más bajo al más alto, con el cero siempre dentro. */
  private readonly escala = computed(() => {
    const vals = this.data().map((d) => d.valor);
    const max = Math.max(0, ...vals);
    const min = Math.min(0, ...vals);
    const span = max - min;
    return { min, span: span > 0 ? span : 1 };
  });

  /** Dónde cae el cero, en % del carril. */
  readonly x0 = computed(() => {
    const { min, span } = this.escala();
    return (-min / span) * 100;
  });

  readonly barras = computed(() => {
    const { span } = this.escala();
    const x0 = this.x0();
    return this.data().map((d) => {
      let ancho = (Math.abs(d.valor) / span) * 100;
      // Lo poquito se ve: una ganancia de $30 junto a una de $18,000 no desaparece.
      if (d.valor !== 0 && ancho < 0.5) ancho = 0.5;
      const negativa = d.valor < 0;
      // La barra arranca en el cero y crece hacia su lado.
      return { ...d, negativa, ancho, izq: negativa ? x0 - ancho : x0 };
    });
  });
}
