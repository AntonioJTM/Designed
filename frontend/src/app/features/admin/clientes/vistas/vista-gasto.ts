import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Gasto } from '../../../../core/models/rediseno.models';
import { Cliente } from '../../../../core/models/clientes.models';
import { ClientesService } from '../../../../core/services/clientes.service';
import { DineroPipe } from '../../../../shared/dinero.pipe';
import { COLOR, contraAnterior, enPeriodo, fechaCorta, pesos } from '../clientes-ui';

type Orden = 'gasto' | 'nombre' | 'nuevo';

/** Cuántos renglones lleva el ranking de barras; la tabla trae a todos. */
const TOPE_RANKING = 12;

/**
 * Pestaña CUÁNTO GASTA: quién gasta más, por lista de precio, si compran más o
 * menos que antes, y la tabla de TODOS los clientes activos, que también es el
 * directorio: desde aquí se abre el expediente de cualquiera, compre o no.
 *
 * Lo cancelado y lo devuelto no cuenta (preguntar "cuánto me compra" e incluir
 * lo que devolvió sería mentir); los apartados sí, porque la venta se cuenta el
 * día que se aparta. Lo calcula `clientes/analisis.js → gasto()`.
 *
 * Abajo van los clientes DADOS DE BAJA, que la tabla no trae (solo activos):
 * sin eso no habría desde dónde abrir su expediente para reactivarlos.
 */
@Component({
  selector: 'app-vista-gasto',
  imports: [FormsModule, RouterLink, DineroPipe],
  templateUrl: './vista-gasto.html',
  host: { class: 'pila' },
  styles: `
    .reparto { display: flex; flex-direction: column; gap: 6px; }
    .reparto .linea { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
    .reparto .linea > span:last-child { color: var(--tinta-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .contra { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .contra > div { display: flex; flex-direction: column; gap: 2px; padding: 12px; border-radius: 8px; }
    .contra b { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .contra span { font-size: 13px; }
    .cambio { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .cambio.sube { color: var(--info-t); }
    .cambio.baja { color: var(--alerta-t); }
    .filtros-tabla { display: flex; flex-wrap: wrap; gap: 12px; }
    .filtros-tabla label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--tinta-3); }
    .filtros-tabla select { min-height: 36px; padding: 0 10px; border: 1px solid var(--borde-campo); border-radius: 8px; background: #fff; font: inherit; font-size: 14px; color: var(--tinta); }
    .pos-num { color: var(--tinta-3); font-variant-numeric: tabular-nums; }
  `,
})
export class VistaGasto implements OnInit {
  private readonly clientes = inject(ClientesService);

  readonly datos = input.required<Gasto>();
  readonly dias = input.required<number>();

  readonly enPeriodo = enPeriodo;
  readonly contraAnterior = contraAnterior;
  readonly pesos = pesos;
  readonly fechaCorta = fechaCorta;

  readonly lista = signal<string>('');
  readonly orden = signal<Orden>('gasto');
  readonly bajas = signal<Cliente[]>([]);
  readonly totalBajas = signal(0);

  /** "Desde siempre" no tiene un periodo anterior contra el cual medir. */
  readonly hayAnterior = computed(() => this.dias() < 3650);

  ngOnInit(): void {
    this.clientes.listar({ activo: false, orden: 'nombre', limit: 100 }).subscribe({
      next: (p) => {
        this.bajas.set(p.items);
        this.totalBajas.set(p.total);
      },
      error: () => this.bajas.set([]),
    });
  }

  readonly kpis = computed(() => {
    const d = this.datos();
    return [
      {
        etiqueta: 'Te compraron',
        valor: pesos(d.total_clientes),
        pie:
          d.pct_de_ventas === null
            ? `los clientes identificados, ${enPeriodo(d.dias)}`
            : `${d.pct_de_ventas}% de lo vendido ${enPeriodo(d.dias)}; el resto, a quien pasa`,
        punto: COLOR.acento,
      },
      { etiqueta: 'Por compra', valor: d.ticket === null ? '—' : pesos(d.ticket), pie: 'lo que deja en promedio cada visita', punto: COLOR.serie1 },
      { etiqueta: 'Al mes', valor: d.gasto_mes === null ? '—' : pesos(d.gasto_mes), pie: 'lo que gasta en promedio cada cliente', punto: COLOR.serie3 },
      {
        etiqueta: 'Tus 10 mejores',
        valor: d.pct_top10 === null ? '—' : `${d.pct_top10}%`,
        pie: 'de lo que te compran los clientes',
        punto: COLOR.serie2,
      },
    ];
  });

  /** Los que más gastan, con cuánto de la venta suman hasta ese renglón. */
  readonly ranking = computed(() => {
    const filas = this.datos().clientes.filter((c) => c.compras > 0).slice(0, TOPE_RANKING);
    const max = Math.max(1, ...filas.map((c) => c.total));
    return filas.map((c) => ({ c, ancho: Math.max(1, Math.round((c.total / max) * 80)) }));
  });

  readonly listas = computed(() => {
    const nombres = new Set(this.datos().clientes.map((c) => c.lista || 'Público'));
    return [...nombres].sort((a, b) => a.localeCompare(b, 'es'));
  });

  readonly tabla = computed(() => {
    const l = this.lista();
    let filas = this.datos().clientes.filter((c) => !l || (c.lista || 'Público') === l);
    if (this.orden() === 'nombre') filas = [...filas].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    // El id crece con cada alta: el más alto es el último que se capturó.
    if (this.orden() === 'nuevo') filas = [...filas].sort((a, b) => b.cliente_id - a.cliente_id);
    return filas;
  });
}
