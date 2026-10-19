import { Component, DestroyRef, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, Subscription, forkJoin } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { ClientesService, FiltrosClientes, OrdenClientes } from '../../../../core/services/clientes.service';
import { Cliente, LugaresEntrega } from '../../../../core/models/clientes.models';
import { DineroPipe } from '../../../../shared/dinero.pipe';
import { COLOR, fechaCorta, plural } from '../clientes-ui';

/** Cuántos trae cada vuelta ("Ver más"): lo más que da el servidor. */
const POR_PAGINA = 100;

type Mostrar = 'activos' | 'baja' | 'todos';

/**
 * Pestaña TODOS LOS CLIENTES (2026-10-14: "no sé cuántos clientes tengo y qué
 * clientes tengo, como una lista; no tengo un lugar donde ver todos los
 * clientes"). Es el directorio: cuántos son, y la lista completa con su número,
 * teléfono, lugar de entrega, lista de precios, lo que debe y lo que ha
 * comprado. Se busca por nombre, número o teléfono, se filtra por lugar de
 * entrega y por activos / dados de baja, y se ordena. Es la primera pestaña:
 * Clientes abre aquí.
 *
 * Trae de 100 en 100 con "Ver más", como Ventas. Los filtros se aplican en el
 * servidor (`GET /clientes`), no sobre lo que ya llegó.
 */
@Component({
  selector: 'app-vista-todos',
  imports: [FormsModule, RouterLink, DineroPipe],
  templateUrl: './vista-todos.html',
  host: { class: 'pila' },
  styles: `
    table.grid.todos { min-width: 820px; }
    .numero { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .chico { font-size: 0.75rem; margin-top: 2px; }
    .tel { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .debe { color: var(--alerta-t); font-weight: 600; }
    .mas { display: flex; justify-content: center; padding-top: 16px; }
    .cuenta { margin: 0; font-size: 0.875rem; color: var(--tinta-3); }
  `,
})
export class VistaTodos implements OnInit {
  private readonly clientes = inject(ClientesService);
  private readonly destroyRef = inject(DestroyRef);

  /** Los lugares de entrega, para el filtro, y cuántos activos hay. */
  readonly lugares = input.required<LugaresEntrega>();

  readonly fechaCorta = fechaCorta;
  readonly plural = plural;

  // --- Filtros (campos de ngModel) ---
  q = '';
  mostrar: Mostrar = 'activos';
  /** null = todos los lugares; 'sin' = sin lugar; un id = ese lugar. */
  lugar: number | 'sin' | null = null;
  orden: OrdenClientes = 'numero';

  readonly ORDENES: { valor: OrdenClientes; texto: string }[] = [
    { valor: 'numero', texto: 'Por número (C-0001…)' },
    { valor: 'nombre', texto: 'Por nombre (A-Z)' },
    { valor: 'nuevo', texto: 'Los más nuevos' },
    { valor: 'saldo', texto: 'Quién debe más' },
    { valor: 'compras', texto: 'Quién compra más' },
    { valor: 'reciente', texto: 'Quién vino más reciente' },
  ];

  readonly lista = signal<Cliente[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(true);
  readonly cargandoMas = signal(false);
  readonly error = signal<string | null>(null);
  /** Cuántos están dados de baja (la cifra de arriba). */
  readonly deBaja = signal<number | null>(null);

  private readonly tecleo$ = new Subject<void>();
  private carga?: Subscription;
  /** La última página que se trajo (para "Ver más"). */
  private pagina = 1;

  readonly kpis = computed(() => {
    const l = this.lugares();
    const baja = this.deBaja();
    const conLugar = Math.max(0, l.clientes_activos - l.sin_lugar);
    return [
      {
        etiqueta: 'Clientes activos',
        valor: String(l.clientes_activos),
        pie: 'los que salen en la caja y en las pestañas',
        punto: COLOR.serie1,
      },
      {
        etiqueta: 'Con lugar de entrega',
        valor: `${conLugar} de ${l.clientes_activos}`,
        pie: l.sin_lugar ? `${l.sin_lugar} todavía sin lugar` : 'todos tienen su lugar',
        punto: l.sin_lugar ? COLOR.ambar : COLOR.serie1,
      },
      {
        etiqueta: 'Dados de baja',
        valor: baja === null ? '—' : String(baja),
        pie: 'ya no salen en la caja; se reactivan en Editar',
        punto: COLOR.otros,
      },
    ];
  });

  constructor() {
    // Cada vez que la pantalla vuelve a pedir los lugares (al abrir, después de
    // dar de alta un cliente o con un aviso en vivo) se vuelve a pedir la lista
    // con los filtros de ahora: la primera vez desde el principio; después, las
    // páginas que ya se ven, sin regresar a la primera.
    effect(() => {
      this.lugares();
      untracked(() => {
        if (this.yaCargo) this.refrescar();
        else this.buscar();
        this.clientes.listar({ activo: false, limit: 1 }).subscribe({
          next: (r) => this.deBaja.set(r.total),
          error: () => this.deBaja.set(null),
        });
      });
    });
  }

  ngOnInit(): void {
    // Al teclear se busca con una pausa corta: cada tecla sería una consulta.
    this.tecleo$.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.buscar());
  }

  private filtros(page: number): FiltrosClientes {
    const f: FiltrosClientes = { orden: this.orden, page, limit: POR_PAGINA };
    if (this.q.trim()) f.q = this.q.trim();
    if (this.mostrar !== 'todos') f.activo = this.mostrar === 'activos';
    if (this.lugar === 'sin') f.sin_lugar = true;
    else if (this.lugar) f.lugar_entrega_id = this.lugar;
    return f;
  }

  alTeclear(): void {
    this.tecleo$.next();
  }

  /** Ya se trajo la lista una vez (de ahí en adelante se refresca sin regresar arriba). */
  private yaCargo = false;
  /** Sube con cada búsqueda o "Ver más": un refresco que llega tarde se tira. */
  private vuelta = 0;

  /** Con los filtros de ahora, desde la primera página. */
  buscar(): void {
    this.carga?.unsubscribe();
    this.vuelta += 1;
    this.pagina = 1;
    this.cargando.set(true);
    this.error.set(null);
    this.carga = this.clientes.listar(this.filtros(1)).subscribe({
      next: (r) => {
        this.yaCargo = true;
        this.lista.set(r.items);
        this.total.set(r.total);
        this.cargando.set(false);
      },
      error: () => {
        this.error.set('No se pudo traer la lista de clientes.');
        this.cargando.set(false);
      },
    });
  }

  /** Las páginas que ya se ven, otra vez y juntas; si se está pidiendo algo, se deja. */
  private refrescar(): void {
    if (this.cargando() || this.cargandoMas()) return;
    const vuelta = this.vuelta;
    const pedidas = Array.from({ length: this.pagina }, (_, i) => this.clientes.listar(this.filtros(i + 1)));
    forkJoin(pedidas).subscribe({
      next: (rs) => {
        if (vuelta !== this.vuelta || this.cargando() || this.cargandoMas()) return;
        this.lista.set(rs.flatMap((r) => r.items));
        this.total.set(rs[rs.length - 1]?.total ?? 0);
      },
      error: () => {},
    });
  }

  verMas(): void {
    this.vuelta += 1;
    const pagina = this.pagina + 1;
    this.cargandoMas.set(true);
    this.clientes.listar(this.filtros(pagina)).subscribe({
      next: (r) => {
        this.pagina = pagina;
        this.lista.set([...this.lista(), ...r.items]);
        this.total.set(r.total);
        this.cargandoMas.set(false);
      },
      error: () => this.cargandoMas.set(false),
    });
  }

  /** "48 clientes activos" / "3 de 48 con «rojo»": lo que dice arriba de la tabla. */
  cuenta(): string {
    const n = this.total();
    const quien = this.mostrar === 'activos' ? ['cliente activo', 'clientes activos']
      : this.mostrar === 'baja' ? ['dado de baja', 'dados de baja'] : ['cliente', 'clientes'];
    const base = plural(n, quien[0], quien[1]);
    const lugar = this.lugar === 'sin' ? ' sin lugar de entrega'
      : this.lugar ? ` en ${this.lugares().lugares.find((l) => l.id === this.lugar)?.nombre ?? 'ese lugar'}` : '';
    const busca = this.q.trim() ? ` con «${this.q.trim()}»` : '';
    return base + lugar + busca;
  }

  lugarDe(c: Cliente): string {
    return c.lugar_entrega ? `${c.lugar_entrega}, ${c.lugar_entrega_estado}` : '';
  }

  num(v: unknown): number {
    return Number(v ?? 0);
  }
}
