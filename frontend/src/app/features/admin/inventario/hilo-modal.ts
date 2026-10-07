import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  BultoLote,
  DetalleHilo,
  InventarioService,
  LoteHilo,
} from '../../../core/services/inventario.service';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';
import { FolioPipe } from '../../../shared/folio.pipe';
import { CuandoPipe } from './cuando.pipe';

/** Lo que el listado ya sabe del hilo: con eso el modal abre con su nombre puesto. */
export interface HiloElegido {
  producto_id: number;
  producto: string;
  calibre?: string | null;
  material?: string | null;
  linea?: string | null;
}

/** Qué bultos del lote se ven. */
type FiltroEstado = 'disponible' | 'apartado' | 'desarmado' | 'vendido' | 'todos';

/**
 * EL DETALLE DE UN HILO (2026-10-06): "cuando doy clic en cualquier hilo, que me
 * diga los bultos que están y su lote; selecciono el lote y me da las
 * presentaciones que tiene cada uno" (usuario).
 *
 * Dos vistas en el mismo modal, de lo general a lo exacto:
 *   · el HILO: cuánto hay por presentación y almacén (los saldos, que son la
 *     verdad) con los paquetes que se cree que están ahí, y sus LOTES con lo que
 *     queda en paquete, lo que ya se bajó a conos o se vendió, y en qué carga
 *     llegaron;
 *   · un LOTE: lo mismo en cifras y sus paquetes uno por uno (código, peso real,
 *     conos, dónde está o qué pasó con él), con filtro por estado, almacén y
 *     código.
 *
 * Solo MIRA: no mueve nada. El cono no se lleva por lote (su saldo es uno por
 * almacén), así que del lote se dice cuántos paquetes se bajaron a conos, no
 * cuántos conos de ese lote quedan.
 */
@Component({
  selector: 'app-hilo-modal',
  imports: [FormsModule, CantidadPipe, FechaPipe, FolioPipe, CuandoPipe],
  templateUrl: './hilo-modal.html',
  styleUrl: './hilo-modal.scss',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class HiloModal implements OnInit {
  private readonly inv = inject(InventarioService);

  readonly hilo = input.required<HiloElegido>();
  /** El almacén que se estaba mirando en la tabla: los bultos abren filtrados a él. */
  readonly almacenId = input<number | null>(null);

  readonly cerrado = output<void>();

  readonly detalle = signal<DetalleHilo | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  /** El lote que se está viendo; `null` = la vista del hilo. */
  readonly loteSel = signal<LoteHilo | null>(null);
  readonly bultos = signal<BultoLote[]>([]);
  readonly cargandoBultos = signal(false);
  readonly errorBultos = signal<string | null>(null);

  readonly estado = signal<FiltroEstado>('disponible');
  readonly almacenFiltro = signal<number | ''>('');
  readonly buscar = signal('');

  /** El input se lee aquí y no en el constructor: ahí todavía no está puesto. */
  ngOnInit(): void {
    const a = this.almacenId();
    if (a) this.almacenFiltro.set(a);
    this.inv.detalleHilo(this.hilo().producto_id).subscribe({
      next: (d) => {
        this.detalle.set(d);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  // ---- La vista del hilo ----

  nombre(): string {
    const h = this.detalle()?.hilo ?? this.hilo();
    return h.calibre ? `${h.producto} ${h.calibre}` : h.producto;
  }

  clasificacion(): string {
    const h = this.detalle()?.hilo ?? this.hilo();
    return [h.material, h.linea].filter(Boolean).join(' · ');
  }

  readonly kgTotal = computed(() =>
    this.r3((this.detalle()?.presentaciones ?? []).reduce((s, p) => s + p.total, 0))
  );
  readonly kgCono = computed(() =>
    this.r3(
      (this.detalle()?.presentaciones ?? [])
        .filter((p) => p.tipo_presentacion === 'cono')
        .reduce((s, p) => s + p.total, 0)
    )
  );

  /** "Dónde está": un renglón por presentación y almacén, el paquete primero. */
  readonly donde = computed(() =>
    (this.detalle()?.presentaciones ?? []).flatMap((p) =>
      p.existencias.map((e) => ({ ...e, tipo: p.tipo_presentacion, sku: p.sku }))
    )
  );

  presentacion(tipo: string | null | undefined): string {
    if (tipo === 'cono') return 'Cono';
    if (tipo === 'paquete') return 'Paquete';
    return 'Sencilla';
  }

  /**
   * ¿Los bultos ubicados en ese almacén suman distinto que su saldo? Pasa cuando
   * se vende o se ajusta sin escanear, o cuando un paquete se movió sin pasar por
   * el lector. El saldo es la verdad; esto solo avisa (medio kilo de tolerancia).
   */
  noCuadra(e: { cantidad: number; kg_en_bultos: number | null }): boolean {
    return e.kg_en_bultos !== null && Math.abs(e.cantidad - e.kg_en_bultos) > 0.5;
  }

  etiquetaLote(lote: string | null): string {
    return lote ?? 'Sin lote';
  }

  paquetes(n: number): string {
    return `${n.toLocaleString('es-MX')} ${n === 1 ? 'paquete' : 'paquetes'}`;
  }

  // ---- La vista de un lote ----

  abrirLote(l: LoteHilo): void {
    this.loteSel.set(l);
    // Si ya no le quedan paquetes, se enseña su historia completa.
    this.estado.set(l.disponibles.bultos > 0 ? 'disponible' : 'todos');
    this.buscar.set('');
    this.bultos.set([]);
    this.errorBultos.set(null);
    this.cargandoBultos.set(true);
    this.inv.bultosDeLote(this.hilo().producto_id, l.lote).subscribe({
      next: (b) => {
        this.bultos.set(b);
        this.cargandoBultos.set(false);
        // El almacén de la tabla solo filtra si en ese almacén hay bultos del lote.
        const a = this.almacenFiltro();
        if (a && !b.some((x) => x.almacen_id === a)) this.almacenFiltro.set('');
      },
      error: (e) => {
        this.errorBultos.set(this.msg(e));
        this.cargandoBultos.set(false);
      },
    });
  }

  volver(): void {
    this.loteSel.set(null);
    this.bultos.set([]);
  }

  /** Cuántos bultos del lote hay en cada estado (para los botones del filtro). */
  readonly conteo = computed(() => {
    const c = { disponible: 0, apartado: 0, desarmado: 0, vendido: 0, todos: 0 };
    for (const b of this.bultos()) {
      c[b.estado]++;
      c.todos++;
    }
    return c;
  });

  /** Los almacenes donde hay (o hubo) bultos del lote. */
  readonly almacenesLote = computed(() => {
    const m = new Map<number, string>();
    for (const b of this.bultos()) if (b.almacen_id) m.set(b.almacen_id, b.almacen ?? '');
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  readonly bultosVistos = computed(() => {
    const est = this.estado();
    const alm = this.almacenFiltro();
    const q = this.buscar().trim().toLowerCase();
    return this.bultos().filter(
      (b) =>
        (est === 'todos' || b.estado === est) &&
        (!alm || b.almacen_id === alm) &&
        (!q || b.codigo.toLowerCase().includes(q))
    );
  });

  readonly kgVistos = computed(() => this.r3(this.bultosVistos().reduce((s, b) => s + (b.peso_kg ?? 0), 0)));

  // ---- Varios ----

  cerrar(): void {
    this.cerrado.emit();
  }

  private r3(n: number): number {
    return Math.round(n * 1000) / 1000;
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
