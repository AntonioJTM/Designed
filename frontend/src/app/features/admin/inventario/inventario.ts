import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  Conversion,
  InventarioService,
  ResumenAlmacen,
  ResumenAlmacenes,
  ResumenFila,
} from '../../../core/services/inventario.service';
import { Almacen, StockItem } from '../../../core/models/inventario.models';
import { Variante } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';
import { BarraApilada, StackedBars } from '../../../shared/charts/stacked-bars';
import { DesarmeModal } from './desarme-modal';
import { MovimientoModal } from './movimiento-modal';

/** Un producto (color + calibre) con sus presentaciones juntas. */
interface GrupoColor {
  /** Se agrupa por el producto, NO por el nombre: dos calibres son dos productos. */
  clave: string;
  producto: string;
  calibre?: string | null;
  material?: string | null;
  linea?: string | null;
  filas: ResumenFila[];
  total: number;
}

/**
 * Pantalla de Inventario: es para MIRAR. Las acciones son modales.
 *
 * Está armada para contestar tres preguntas en ese orden, que es como las hace la
 * tienda: cuánto hay en cada almacén (tarjetas), dónde está cada color (gráfica
 * apilada), y el detalle exacto (tabla agrupada por color + buscador).
 */
@Component({
  selector: 'app-inventario',
  imports: [
    FormsModule,
    RouterLink,
    CantidadPipe,
    FechaPipe,
    StackedBars,
    DesarmeModal,
    MovimientoModal,
  ],
  templateUrl: './inventario.html',
})
export class Inventario {
  private readonly inv = inject(InventarioService);

  readonly almacenes = signal<Almacen[]>([]);
  /** Panorama de existencias por almacén (totales + matriz). */
  readonly resumen = signal<ResumenAlmacenes | null>(null);
  readonly soloConStock = signal(true);
  readonly stock = signal<StockItem[]>([]);
  readonly totalAlertas = signal(0);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  /** Qué modal está abierto. */
  readonly modal = signal<'desarme' | 'movimiento' | null>(null);

  // Filtros de la tabla de existencias
  filtroAlmacen: number | '' = '';
  filtroQ = '';
  soloBajo = false;

  /**
   * Datos que consume el modal de desarme. Se cargan aquí y entran por input para
   * que el modal abra armado, sin esperar peticiones ni cambiar de tamaño.
   */
  readonly conos = signal<Variante[]>([]);
  readonly conversiones = signal<Conversion[]>([]);

  /**
   * Colores de la gráfica: los tres primeros slots de la paleta validada. Un
   * cuarto almacén NO recibe color propio —cae en "otros"— porque la paleta solo
   * está validada hasta tres y el cuarto par no pasa las puertas. El detalle
   * exacto de cada almacén está en la tabla de abajo.
   */
  private readonly COLORES = ['var(--viz-series-1)', 'var(--viz-series-2)', 'var(--viz-series-3)'];
  private readonly COLOR_OTROS = 'var(--viz-otros)';

  constructor() {
    this.inv.almacenes().subscribe({
      next: (a) => this.almacenes.set(a),
      error: (e) => this.error.set(this.msg(e)),
    });
    this.cargarStock();
    this.cargarAlertas();
    this.cargarConos();
    this.cargarConversiones();
    this.cargarResumen();
  }

  cargarResumen(): void {
    this.inv.resumen().subscribe({
      next: (r) => this.resumen.set(r),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  // ---- Totales de arriba ----

  /** Kilos de toda la tienda, para leer cada almacén como proporción. */
  readonly kilosTotales = computed(() =>
    (this.resumen()?.almacenes ?? []).reduce((s, a) => s + Number(a.kilos), 0)
  );

  /** Cuántos productos distintos hay con existencias. */
  readonly coloresConStock = computed(
    () =>
      new Set(
        (this.resumen()?.filas ?? []).filter((f) => f.total > 0).map((f) => this.clave(f))
      ).size
  );

  /** Clave de agrupación: el producto. Cae al nombre si el backend es viejo. */
  private clave(f: ResumenFila): string {
    return String(f.producto_id ?? f.producto);
  }

  /** Cómo se nombra el hilo en la pantalla: el color y su calibre. */
  nombreCompleto(f: { producto: string; calibre?: string | null }): string {
    return f.calibre ? `${f.producto} ${f.calibre}` : f.producto;
  }

  /** Material y línea de procedencia, juntos. */
  clasificacion(f: { material?: string | null; linea?: string | null }): string {
    return [f.material, f.linea].filter(Boolean).join(' · ') || '—';
  }

  /** Qué porcentaje del total está en ese almacén. */
  porcentaje(a: ResumenAlmacen): number {
    const total = this.kilosTotales();
    return total > 0 ? Math.round((Number(a.kilos) / total) * 100) : 0;
  }

  // ---- Gráfica: dónde está cada color ----

  /** Las series de la gráfica: los almacenes que de verdad tienen algo. */
  readonly seriesGrafica = computed(() => {
    const conStock = (this.resumen()?.almacenes ?? []).filter((a) => Number(a.kilos) > 0);
    return conStock.map((a, i) => ({
      almacen_id: a.almacen_id,
      nombre: a.nombre,
      color: i < this.COLORES.length ? this.COLORES[i] : this.COLOR_OTROS,
      // Del cuarto en adelante todos comparten el gris de "otros".
      otros: i >= this.COLORES.length,
    }));
  });

  /**
   * Kilos por COLOR, partidos por almacén. Se suman las presentaciones del mismo
   * color (paquete + cono) porque es el mismo hilo: la pregunta es "cuánto negro
   * hay y dónde", no "cuánto negro enconado".
   */
  readonly grafica = computed<BarraApilada[]>(() => {
    const series = this.seriesGrafica();
    if (series.length === 0) return [];

    // Se agrupa por PRODUCTO: dos calibres del mismo color son dos barras, y sin
    // el calibre en la etiqueta se verían como dos renglones iguales.
    const porColor = new Map<string, { fila: ResumenFila; kilos: Map<number, number> }>();
    for (const f of this.resumen()?.filas ?? []) {
      if (f.total <= 0) continue;
      const k = this.clave(f);
      const dest = porColor.get(k) ?? { fila: f, kilos: new Map<number, number>() };
      for (const s of series) {
        const c = Number(f.existencias[String(s.almacen_id)]?.cantidad ?? 0);
        if (c > 0) dest.kilos.set(s.almacen_id, (dest.kilos.get(s.almacen_id) ?? 0) + c);
      }
      porColor.set(k, dest);
    }

    const barras = [...porColor.values()]
      .map(({ fila, kilos: porAlmacen }) => ({
        label: this.nombreCompleto(fila),
        detalle: this.clasificacion(fila),
        total: Math.round([...porAlmacen.values()].reduce((s, v) => s + v, 0) * 1000) / 1000,
        segmentos: series
          .map((s) => ({
            serie: s.nombre,
            value: Math.round((porAlmacen.get(s.almacen_id) ?? 0) * 1000) / 1000,
            color: s.color,
          }))
          .filter((s) => s.value > 0),
      }))
      .sort((a, b) => b.total - a.total);

    // Más de 10 barras no se leen: el resto se junta en un renglón.
    if (barras.length <= 10) return barras;
    const resto = barras.slice(10);
    const juntas = new Map<string, { serie: string; value: number; color: string }>();
    for (const b of resto) {
      for (const s of b.segmentos) {
        const acc = juntas.get(s.serie) ?? { serie: s.serie, value: 0, color: s.color };
        acc.value = Math.round((acc.value + s.value) * 1000) / 1000;
        juntas.set(s.serie, acc);
      }
    }
    return [
      ...barras.slice(0, 10),
      {
        label: `Otros ${resto.length} hilos`,
        detalle: 'suma de los que no caben en la gráfica',
        total: Math.round(resto.reduce((s, b) => s + b.total, 0) * 1000) / 1000,
        segmentos: [...juntas.values()],
      },
    ];
  });

  // ---- Tabla agrupada por color ----

  /** Renglones del comparativo, opcionalmente solo los que tienen existencias. */
  filasResumen(): ResumenFila[] {
    const filas = this.resumen()?.filas ?? [];
    return this.soloConStock() ? filas.filter((f) => f.total > 0) : filas;
  }

  /**
   * Las presentaciones del mismo color van juntas. Antes cada una era un renglón
   * suelto con el nombre del color repetido, y la tabla parecía tener duplicados
   * ("AMARILLO" dos veces, una de paquete y otra de cono).
   */
  readonly grupos = computed<GrupoColor[]>(() => {
    const filas = this.soloConStock()
      ? (this.resumen()?.filas ?? []).filter((f) => f.total > 0)
      : (this.resumen()?.filas ?? []);

    const porColor = new Map<string, GrupoColor>();
    for (const f of filas) {
      const k = this.clave(f);
      const g =
        porColor.get(k) ??
        ({
          clave: k,
          producto: f.producto,
          calibre: f.calibre,
          material: f.material,
          linea: f.linea,
          filas: [],
          total: 0,
        } as GrupoColor);
      g.filas.push(f);
      g.total = Math.round((g.total + f.total) * 1000) / 1000;
      porColor.set(k, g);
    }
    // El paquete primero y el cono después: es el orden en que pasa en la tienda.
    for (const g of porColor.values()) {
      g.filas.sort((a, b) => (a.tipo_presentacion === 'cono' ? 1 : 0) - (b.tipo_presentacion === 'cono' ? 1 : 0));
    }
    return [...porColor.values()].sort((a, b) => b.total - a.total);
  });

  /** Existencia de una variante en un almacén concreto. */
  celda(f: ResumenFila, almacenId: number): { cantidad: string; bajo_minimo: boolean } | null {
    return f.existencias[String(almacenId)] ?? null;
  }

  /** Cómo se llama la presentación en la tabla. */
  etiquetaPresentacion(f: ResumenFila): string {
    if (f.tipo_presentacion === 'cono') return 'Cono';
    if (f.tipo_presentacion === 'paquete') {
      return Number(f.peso_kg) > 0 ? `Paquete de ${Number(f.peso_kg)} kg` : 'Paquete (sin peso)';
    }
    return f.presentacion || 'Sencilla';
  }

  /**
   * Qué parte de TODO el inventario es ese hilo. Es lo que llena la barra de la
   * columna del total, y va escrito al lado: una barra sin decir contra qué se
   * mide no significa nada (antes se medía contra el hilo más grande, que no se
   * veía en ninguna parte).
   */
  porcentajeDelTotal(total: number): number {
    const t = this.kilosTotales();
    return t > 0 ? Math.round((total / t) * 100) : 0;
  }

  /** Los DECIMAL llegan como string; en la plantilla se comparan como número. */
  num(v: string | number | null | undefined): number {
    return Number(v ?? 0);
  }

  /** Cuántos paquetes representan esos kilos, para leerlo como lo cuenta la tienda. */
  paquetesDe(kilos: string | number, pesoKg: string | number | null | undefined): string {
    const peso = Number(pesoKg ?? 0);
    if (!peso) return '';
    return (Math.round((Number(kilos) / peso) * 100) / 100).toString();
  }

  /** Etiqueta corta del papel que juega el almacén. */
  papel(a: {
    es_matriz: boolean | number;
    es_punto_venta: boolean | number;
    es_tienda_linea: boolean | number;
  }): string {
    const partes: string[] = [];
    if (a.es_matriz) partes.push('matriz');
    partes.push(a.es_punto_venta ? 'tienda' : 'bodega');
    if (a.es_tienda_linea) partes.push('web');
    return partes.join(' · ');
  }

  // ---- Buscador de existencias ----

  /** La columna "Reservada" solo aparece si alguien reservó algo. */
  readonly hayReservas = computed(() =>
    this.stock().some((s) => Number(s.cantidad_reservada) > 0)
  );

  /** Y la de mínimo, solo si hay alguno capturado. */
  readonly hayMinimos = computed(() => this.stock().some((s) => Number(s.stock_minimo) > 0));

  /** Presentación de un renglón de existencias, sin adivinar por el SKU. */
  presentacionStock(s: StockItem): string {
    if (s.tipo_presentacion === 'cono') return 'Cono';
    if (s.tipo_presentacion === 'paquete') {
      return Number(s.peso_kg) > 0 ? `Paquete de ${Number(s.peso_kg)} kg` : 'Paquete';
    }
    return s.presentacion || '—';
  }

  bajoMinimo(s: StockItem): boolean {
    return Number(s.stock_minimo) > 0 && Number(s.disponible) <= Number(s.stock_minimo);
  }

  /** Trae las presentaciones de tipo cono: son las que se pueden desarmar a mano. */
  private cargarConos(): void {
    this.inv.buscarVariantes('').subscribe({
      next: (vs) => this.conos.set(vs.filter((v) => v.tipo_presentacion === 'cono')),
      error: () => {},
    });
  }

  private cargarConversiones(): void {
    this.inv.conversiones().subscribe({
      next: (p) => this.conversiones.set(p.items),
      error: () => {},
    });
  }

  /** Un modal movió existencias: se recarga todo lo que se ve en pantalla. */
  alMover(): void {
    this.cargarStock();
    this.cargarAlertas();
    this.cargarConos();
    this.cargarConversiones();
    this.cargarResumen();
  }

  cargarStock(): void {
    this.cargando.set(true);
    this.inv
      .stock({
        almacen_id: this.filtroAlmacen || undefined,
        q: this.filtroQ.trim() || undefined,
        bajo_stock: this.soloBajo || undefined,
      })
      .subscribe({
        next: (p) => {
          this.stock.set(p.items);
          this.cargando.set(false);
        },
        error: (e) => {
          this.error.set(this.msg(e));
          this.cargando.set(false);
        },
      });
  }

  cargarAlertas(): void {
    this.inv.alertas().subscribe({
      next: (a) => this.totalAlertas.set(a.length),
      error: () => {},
    });
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
