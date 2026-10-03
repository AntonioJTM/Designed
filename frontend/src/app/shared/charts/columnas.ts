import { Component, computed, input } from '@angular/core';

/** Una columna: qué periodo es, cuánto vale y si se resalta. */
export interface Columna {
  /** Lo que va debajo: "21 sep", "sáb 27". */
  etiqueta: string;
  valor: number;
  /** Número corto encima de la columna ("$104k"). Sin él, no se escribe nada. */
  rotulo?: string | null;
  /** La columna que se resalta (la semana en curso, los sábados). */
  fuerte?: boolean;
  /** El dato exacto, al pasar el ratón. */
  titulo?: string;
}

/**
 * Columnas verticales hechas con CAJAS (las clases globales `.columnas` y
 * `.columnas-pie` del sistema de diseño), para "cuánto se vendió cada semana /
 * cada día". Una sola serie: todas del mismo azul claro y la que importa en el
 * paso oscuro de la misma rampa —`.fuerte`—, que la pantalla explica en el
 * subtítulo ("la de color fuerte es la más reciente"). No lleva leyenda: el
 * título de la tarjeta ya dice qué se mide.
 *
 * Reglas de la guía que respeta:
 *  · Solo el extremo del DATO va redondeado (4 px arriba); la base queda a
 *    escuadra, anclada a la línea del eje (el borde inferior de `.columnas`).
 *  · El número va directo encima solo si la pantalla lo pide, y con texto de
 *    tinta, nunca del color de la serie.
 *  · Cada columna lleva su tooltip con el dato exacto.
 *
 * Con muchas columnas (un mes día por día) el hueco se angosta y las etiquetas
 * de abajo se ralean, para que no se encimen.
 */
@Component({
  selector: 'app-columnas',
  imports: [],
  template: `
    <div class="columnas" role="img" [attr.aria-label]="descripcion() || null"
         [style.height.px]="alto()" [style.gap.px]="hueco()">
      @for (c of columnas(); track $index) {
        <div [attr.title]="c.titulo || null">
          @if (c.rotulo) { <span>{{ c.rotulo }}</span> }
          <i [class.fuerte]="c.fuerte" [style.height.px]="c.h"></i>
        </div>
      }
    </div>
    <div class="columnas-pie" aria-hidden="true" [style.gap.px]="hueco()">
      @for (c of columnas(); track $index) {
        <span>{{ c.verEtiqueta ? c.etiqueta : '' }}</span>
      }
    </div>
  `,
  styles: `:host { display: block; min-width: 0; }`,
})
export class Columnas {
  readonly data = input<Columna[]>([]);
  /** Alto de la zona de dibujo, en px. */
  readonly alto = input(220);
  /** Lo que dice la gráfica en una frase, para el lector de pantalla. */
  readonly descripcion = input('');

  /** Espacio que se reserva arriba para el rótulo de la columna más alta. */
  readonly ESPACIO_ROTULO = 30;

  /** El hueco entre columnas: con muchas, se angosta para que quepan. */
  readonly hueco = computed(() => {
    const n = this.data().length;
    return n <= 16 ? 10 : n <= 31 ? 6 : n <= 62 ? 3 : 2;
  });

  readonly columnas = computed(() => {
    const data = this.data();
    // Lo vendido no baja de cero; un negativo se dibuja como nada.
    const max = Math.max(0, ...data.map((d) => d.valor));
    const util = Math.max(0, this.alto() - this.ESPACIO_ROTULO);
    // Una etiqueta de cada `paso`: con 30 días no caben las 30 abajo.
    const paso = Math.max(1, Math.ceil(data.length / 16));
    return data.map((d, i) => {
      const v = Math.max(0, d.valor);
      let h = max > 0 ? Math.round((v / max) * util) : 0;
      // Lo poquito se ve: una venta de $50 junto a una de $20,000 no desaparece.
      if (v > 0 && h < 2) h = 2;
      return { ...d, h, verEtiqueta: i % paso === 0 };
    });
  });
}
