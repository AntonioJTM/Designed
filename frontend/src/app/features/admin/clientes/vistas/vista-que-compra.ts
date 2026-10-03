import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QueCompra } from '../../../../core/models/rediseno.models';
import { CantidadPipe } from '../../../../shared/cantidad.pipe';
import { COLOR, capitalizar, enPeriodo, kilos, plural } from '../clientes-ui';

/**
 * Pestaña QUÉ COMPRA: los hilos que más se llevan los clientes, de qué
 * material y calibre, si en paquete o en cono, y qué se lleva cada quien.
 *
 * Todo va por HILO (producto_id), nunca por nombre: el mismo color en dos
 * calibres son dos productos, y agruparlos por nombre los sumaría en un
 * renglón que no existe. Por eso cada hilo se nombra con su calibre.
 */
@Component({
  selector: 'app-vista-que-compra',
  imports: [RouterLink, CantidadPipe],
  templateUrl: './vista-que-compra.html',
  host: { class: 'pila' },
  styles: `
    .reparto { display: flex; flex-direction: column; gap: 6px; }
    .reparto .linea { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
    .reparto .linea > span:last-child { color: var(--tinta-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .mini { width: 110px; height: 10px; display: flex; gap: 2px; flex: 0 0 110px; }
    .mini > span:first-child { border-radius: 3px 0 0 3px; }
    .mini > span:last-child { border-radius: 0 3px 3px 0; }
    .mini > span:only-child { border-radius: 3px; }
    .fichas { display: flex; flex-wrap: wrap; gap: 6px; }
  `,
})
export class VistaQueCompra {
  readonly datos = input.required<QueCompra>();
  readonly dias = input.required<number>();

  readonly COLOR = COLOR;
  readonly enPeriodo = enPeriodo;

  readonly pctPaquete = computed(() => 100 - this.datos().pct_cono);

  readonly kpis = computed(() => {
    const d = this.datos();
    const top = d.top[0];
    // Por material sumando sus calibres: "Acrilán 81%, viscosa 19%".
    const porMaterial = new Map<string, number>();
    for (const m of d.por_material) porMaterial.set(m.material, (porMaterial.get(m.material) ?? 0) + m.pct);
    const materiales = [...porMaterial.entries()].sort((a, b) => b[1] - a[1]);
    const [mat, pct] = materiales[0] ?? ['—', 0];
    const otros = materiales.slice(1, 3).map(([m, p]) => `${m.toLowerCase()}, el ${p}%`).join(' · ');
    return [
      {
        etiqueta: 'El hilo que más piden',
        valor: top ? [top.color, top.calibre].filter(Boolean).join(' ') : '—',
        chico: true,
        pie: top ? `${kilos(top.kg)} ${enPeriodo(d.dias)}, a ${plural(top.clientes, 'cliente', 'clientes')}` : 'todavía no hay ventas a clientes',
        punto: COLOR.acento,
      },
      {
        etiqueta: capitalizar(mat.toLowerCase()),
        valor: materiales.length ? `${pct}%` : '—',
        chico: false,
        pie: materiales.length ? `de los kilos${otros ? ' · ' + otros : ''}` : 'sin ventas en el periodo',
        punto: COLOR.serie1,
      },
      {
        etiqueta: 'En paquete',
        valor: d.total_kg > 0 ? `${this.pctPaquete()}%` : '—',
        chico: false,
        pie: `y ${d.pct_cono}% en cono, ya bajado a mostrador`,
        punto: COLOR.serie2,
      },
      {
        etiqueta: 'Hilos distintos',
        valor: String(d.hilos_distintos),
        chico: false,
        pie: 'colores y calibres que se llevan',
        punto: COLOR.serie3,
      },
    ];
  });

  /** Los 10 hilos, cada barra contra el que más kilos lleva. */
  readonly top = computed(() => {
    const t = this.datos().top;
    const max = Math.max(0.001, ...t.map((h) => h.kg));
    return t.map((h) => ({
      h,
      hilo: [h.color, h.calibre].filter(Boolean).join(' '),
      ficha: [h.material, h.linea].filter(Boolean).join(' · '),
      ancho: Math.max(1, Math.round((h.kg / max) * 72)),
    }));
  });

  /** Cómo se lo lleva cada cliente, en palabras. */
  como(pctPaquete: number): string {
    if (pctPaquete >= 100) return 'todo en paquete';
    if (pctPaquete <= 0) return 'todo en cono';
    return pctPaquete >= 50 ? `${pctPaquete}% en paquete` : `${100 - pctPaquete}% en cono`;
  }
}
