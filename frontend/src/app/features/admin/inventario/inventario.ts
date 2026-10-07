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
import { AuthService } from '../../../core/services/auth.service';
import { Almacen, StockItem } from '../../../core/models/inventario.models';
import { Variante } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { CuandoPipe } from './cuando.pipe';
import { DesarmeModal } from './desarme-modal';
import { MovimientoModal } from './movimiento-modal';
import { MinimoModal } from './minimo-modal';
import { HiloModal } from './hilo-modal';
import { FolioPipe } from '../../../shared/folio.pipe';

/** Un hilo (color + calibre) con sus renglones de existencias juntos. */
interface GrupoHilo {
  /** Se agrupa por el producto, NO por el nombre: dos calibres son dos productos. */
  clave: string;
  /** Para abrir su detalle (lotes y paquetes). Falta solo con un backend viejo. */
  producto_id?: number;
  producto: string;
  calibre?: string | null;
  material?: string | null;
  linea?: string | null;
  filas: StockItem[];
  total: number;
}

/** Un tramo de la barra de un hilo: lo que hay de él en un almacén. */
interface Segmento {
  serie: string;
  value: number;
  color: string;
}

/** Una barra de "Dónde está cada hilo". */
interface BarraHilo {
  label: string;
  /** Material y línea: con el color solo no se sabe qué hilo es. */
  detalle: string;
  total: number;
  segmentos: Segmento[];
  /**
   * Largo de la barra, de 0 a 1, contra el hilo que más kilos tiene (el primero,
   * que está a la vista: así se sabe contra qué se mide).
   */
  ancho: number;
}

/** Lo que dice la tarjeta de un almacén. */
interface TarjetaAlmacen {
  almacen_id: number;
  nombre: string;
  tipo: string;
  kilos: number;
  /** Su parte de TODO el inventario. */
  parte: number;
  kgPaquete: number;
  kgCono: number;
  /** Partes de la barra: paquete y ya enconado, sobre los kilos del almacén. */
  pctPaquete: number;
  pctCono: number;
  desglose: string;
  hilos: number;
  alertas: number;
}

/** Qué renglones se ven en el detalle. */
type Vista = 'todo' | 'minimo' | 'apartado';

/** Cuántos hilos caben en la gráfica sin que deje de leerse. */
const HILOS_EN_GRAFICA = 8;
/** Renglones por página del detalle (el tope del API). */
const POR_PAGINA = 100;

/**
 * Pantalla de Inventario: es para MIRAR. Las acciones son modales.
 *
 * Está armada para contestar tres preguntas en ese orden, que es como las hace la
 * tienda: cuánto hay en cada almacén (tarjetas), dónde está cada hilo (barras
 * partidas por almacén), y el detalle exacto (tabla agrupada por hilo, con
 * buscador y filtros).
 *
 * Las barras van hechas con cajas y no con `shared/charts/stacked-bars`: así las
 * pidió el diseño aprobado (2026-10), con la etiqueta del hilo a la izquierda y
 * su total al final, y conservan las reglas de la guía de gráficas (hueco de 2 px
 * entre tramos, redondeo solo en el extremo del dato, leyenda, el total como
 * única etiqueta y el resto en el tooltip).
 */
@Component({
  selector: 'app-inventario',
  imports: [FolioPipe, FormsModule, RouterLink, CantidadPipe, CuandoPipe, DesarmeModal, MovimientoModal, MinimoModal, HiloModal],
  templateUrl: './inventario.html',
  styleUrl: './inventario.scss',
})
export class Inventario {
  private readonly inv = inject(InventarioService);
  private readonly auth = inject(AuthService);

  readonly almacenes = signal<Almacen[]>([]);
  /** Panorama de existencias por almacén (totales + matriz). */
  readonly resumen = signal<ResumenAlmacenes | null>(null);
  readonly stock = signal<StockItem[]>([]);
  readonly totalStock = signal(0);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  /**
   * Oculta los renglones en cero que no dicen nada. Uno en cero CON mínimo sí se
   * ve: es justo el que hay que surtir.
   */
  readonly soloConStock = signal(true);

  /** Qué modal está abierto. */
  readonly modal = signal<'desarme' | 'movimiento' | 'minimo' | null>(null);
  /** El renglón cuyo mínimo se está fijando. */
  readonly filaMinimo = signal<StockItem | null>(null);
  /** El hilo cuyo detalle (lotes y paquetes) está abierto. */
  readonly hiloAbierto = signal<GrupoHilo | null>(null);

  // Lo que el puesto puede hacer aquí. El servidor también lo rechaza (403);
  // esconderlo es para no ofrecer lo que va a fallar.
  readonly puedeBajarConos = computed(() => this.auth.puede('hacer:bajar_conos'));
  readonly puedeAjustar = computed(() => this.auth.puede('hacer:ajuste_merma'));
  readonly veKardex = computed(() => this.auth.puede('ver:kardex'));

  // Filtros del detalle
  filtroAlmacen: number | '' = '';
  filtroQ = '';
  vista: Vista = 'todo';
  private pagina = 1;
  private temporizador: ReturnType<typeof setTimeout> | null = null;

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
      next: (a) => this.almacenes.set(a.filter((x) => x.activo)),
      error: (e) => this.error.set(this.msg(e)),
    });
    this.cargarStock();
    this.cargarResumen();
    if (this.puedeBajarConos()) {
      this.cargarConos();
      this.cargarConversiones();
    }
  }

  cargarResumen(): void {
    this.inv.resumen().subscribe({
      next: (r) => this.resumen.set(r),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  // ---- 1 · Cuánto hay en cada almacén ----

  /** Kilos de toda la tienda, para leer cada almacén como proporción. */
  readonly kilosTotales = computed(() =>
    (this.resumen()?.almacenes ?? []).reduce((s, a) => s + Number(a.kilos), 0)
  );

  /** Clave de agrupación: el producto. Cae al nombre + calibre si el backend es viejo. */
  private clave(f: { producto_id?: number; producto: string; calibre?: string | null }): string {
    return f.producto_id != null ? String(f.producto_id) : `${f.producto}|${f.calibre ?? ''}`;
  }

  /** Cómo se nombra el hilo en la pantalla: el color y su calibre. */
  nombreCompleto(f: { producto: string; calibre?: string | null }): string {
    return f.calibre ? `${f.producto} ${f.calibre}` : f.producto;
  }

  /** Material y línea de procedencia, juntos. */
  clasificacion(f: { material?: string | null; linea?: string | null }): string {
    return [f.material, f.linea].filter(Boolean).join(' · ') || 'sin material ni línea';
  }

  /** Qué porcentaje del total está en ese almacén. */
  porcentaje(a: ResumenAlmacen): number {
    const total = this.kilosTotales();
    return total > 0 ? Math.round((Number(a.kilos) / total) * 100) : 0;
  }

  /**
   * Qué papel juega el almacén, en palabras de la tienda. Una sucursal es un
   * almacén con mostrador; la matriz es la que surte a las demás.
   */
  papel(a: { es_matriz: boolean | number; es_punto_venta: boolean | number }): string {
    // TIENDA EN LÍNEA APAGADA (2026-10): antes se agregaba "· web" al almacén con
    // `es_tienda_linea`. La bandera sigue en la base; para volver a mostrarla,
    // recibe `es_tienda_linea` aquí y agrega la palabra.
    if (a.es_matriz) return a.es_punto_venta ? 'Matriz · con mostrador' : 'Matriz · bodega';
    return a.es_punto_venta ? 'Sucursal con mostrador' : 'Bodega';
  }

  readonly tarjetas = computed<TarjetaAlmacen[]>(() => {
    const r = this.resumen();
    if (!r) return [];
    return r.almacenes.map((a) => {
      const kilos = Number(a.kilos);
      const kgCono = Number(a.kilos_cono ?? 0);
      const kgPaquete = a.kilos_paquete != null ? Number(a.kilos_paquete) : kilos - kgCono;
      const pctCono = kilos > 0 ? Math.round((kgCono / kilos) * 100) : 0;
      const pctPaquete = kilos > 0 ? 100 - pctCono : 0;
      // Hilos (productos), no presentaciones: el paquete y el cono son el mismo hilo.
      const hilos = new Set(
        r.filas
          .filter((f) => Number(f.existencias[String(a.almacen_id)]?.cantidad ?? 0) > 0)
          .map((f) => this.clave(f))
      ).size;
      let desglose = '';
      if (kilos > 0) {
        if (kgCono <= 0) desglose = 'Todo en paquete';
        else if (kgPaquete <= 0) desglose = 'Todo enconado';
        else desglose = `${pctPaquete}% paquete · ${pctCono}% enconado`;
      }
      return {
        almacen_id: a.almacen_id,
        nombre: a.nombre,
        tipo: this.papel(a),
        kilos,
        parte: this.porcentaje(a),
        kgPaquete,
        kgCono,
        pctPaquete,
        pctCono,
        desglose,
        hilos,
        alertas: Number(a.alertas ?? 0),
      };
    });
  });

  // ---- 2 · Dónde está cada hilo ----

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

  /** La leyenda: un renglón por color. Los almacenes grises se juntan en "otros". */
  readonly leyenda = computed(() => {
    const series = this.seriesGrafica();
    const propias = series.filter((s) => !s.otros).map((s) => ({ nombre: s.nombre, color: s.color }));
    return series.some((s) => s.otros)
      ? [...propias, { nombre: 'Otros almacenes', color: this.COLOR_OTROS }]
      : propias;
  });

  /**
   * Kilos por HILO, partidos por almacén y ordenados de mayor a menor. Se suman
   * las presentaciones del mismo hilo (paquete + cono) porque es el mismo hilo: la
   * pregunta es "cuánto negro hay y dónde", no "cuánto negro enconado".
   */
  private readonly barrasTodas = computed<Omit<BarraHilo, 'ancho'>[]>(() => {
    const series = this.seriesGrafica();
    if (series.length === 0) return [];

    // Se agrupa por PRODUCTO: dos calibres del mismo color son dos barras, y sin
    // el calibre en la etiqueta se verían como dos renglones iguales.
    const porHilo = new Map<string, { fila: ResumenFila; kilos: Map<number, number> }>();
    for (const f of this.resumen()?.filas ?? []) {
      if (f.total <= 0) continue;
      const k = this.clave(f);
      const dest = porHilo.get(k) ?? { fila: f, kilos: new Map<number, number>() };
      for (const s of series) {
        const c = Number(f.existencias[String(s.almacen_id)]?.cantidad ?? 0);
        if (c > 0) dest.kilos.set(s.almacen_id, (dest.kilos.get(s.almacen_id) ?? 0) + c);
      }
      porHilo.set(k, dest);
    }

    return [...porHilo.values()]
      .map(({ fila, kilos: porAlmacen }) => ({
        label: this.nombreCompleto(fila),
        detalle: this.clasificacion(fila),
        total: this.r3([...porAlmacen.values()].reduce((s, v) => s + v, 0)),
        segmentos: series
          .map((s) => ({ serie: s.nombre, value: this.r3(porAlmacen.get(s.almacen_id) ?? 0), color: s.color }))
          .filter((s) => s.value > 0),
      }))
      .filter((b) => b.total > 0)
      .sort((a, b) => b.total - a.total);
  });

  /**
   * Los hilos con más kilos; más de ocho barras ya no se leen. El largo se mide
   * contra el primero, que es el que más tiene y está a la vista.
   */
  readonly grafica = computed<BarraHilo[]>(() => {
    const todas = this.barrasTodas();
    const max = todas[0]?.total ?? 0;
    return todas.slice(0, HILOS_EN_GRAFICA).map((b) => ({
      ...b,
      ancho: max > 0 ? Math.round((b.total / max) * 1000) / 1000 : 0,
    }));
  });

  /** Lo que no cupo en la gráfica: se dice cuántos son y cuánto suman. */
  readonly restoGrafica = computed(() => {
    const resto = this.barrasTodas().slice(HILOS_EN_GRAFICA);
    return { hilos: resto.length, kilos: this.r3(resto.reduce((s, b) => s + b.total, 0)) };
  });

  /** Lo que explica un tramo al pasar el cursor: el hilo, el almacén y sus kilos. */
  tooltip(b: BarraHilo, s: Segmento): string {
    return `${b.label} · ${b.detalle} · ${s.serie}: ${s.value.toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg`;
  }

  /** Lo mismo para un lector de pantalla, la barra completa en una frase. */
  descripcionBarra(b: BarraHilo): string {
    const partes = b.segmentos.map(
      (s) => `${s.serie} ${s.value.toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg`
    );
    return `${b.label}: ${b.total.toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg. ${partes.join(', ')}.`;
  }

  // ---- 3 · El detalle exacto ----

  /** Orden de los almacenes en el detalle: el del panorama (la matriz primero). */
  private readonly ordenAlmacen = computed(() => {
    const m = new Map<number, number>();
    (this.resumen()?.almacenes ?? []).forEach((a, i) => m.set(a.almacen_id, i));
    return m;
  });

  /** ¿Se ve este renglón con el filtro "ocultar lo que está en cero"? */
  private seVe(s: StockItem): boolean {
    if (!this.soloConStock()) return true;
    return (
      Number(s.cantidad) > 0 || Number(s.stock_minimo) > 0 || Number(s.cantidad_reservada) > 0
    );
  }

  /**
   * Las presentaciones del mismo hilo van juntas, con el nombre una sola vez.
   * Antes cada una era un renglón suelto con el nombre del color repetido, y la
   * tabla parecía tener duplicados ("AMARILLO" dos veces, una de paquete y otra
   * de cono).
   */
  readonly grupos = computed<GrupoHilo[]>(() => {
    const porHilo = new Map<string, GrupoHilo>();
    for (const s of this.stock()) {
      if (!this.seVe(s)) continue;
      const k = this.clave(s);
      const g =
        porHilo.get(k) ??
        ({
          clave: k,
          producto_id: s.producto_id,
          producto: s.producto,
          calibre: s.calibre,
          material: s.material,
          linea: s.linea,
          filas: [],
          total: 0,
        } as GrupoHilo);
      g.filas.push(s);
      g.total = this.r3(g.total + Number(s.cantidad));
      porHilo.set(k, g);
    }
    // El paquete primero y el cono después (es el orden en que pasa en la
    // tienda), y dentro de cada uno, los almacenes en el orden de las tarjetas.
    const orden = this.ordenAlmacen();
    const peso = (t?: string | null) => (t === 'cono' ? 2 : t === 'paquete' ? 0 : 1);
    for (const g of porHilo.values()) {
      g.filas.sort(
        (a, b) =>
          peso(a.tipo_presentacion) - peso(b.tipo_presentacion) ||
          (orden.get(a.almacen_id) ?? 99) - (orden.get(b.almacen_id) ?? 99)
      );
    }
    return [...porHilo.values()].sort((a, b) => b.total - a.total);
  });

  /** Cómo se llama la presentación en la tabla. */
  etiquetaPresentacion(f: { tipo_presentacion?: string | null; presentacion?: string | null }): string {
    if (f.tipo_presentacion === 'cono') return 'Cono';
    if (f.tipo_presentacion === 'paquete') return 'Paquete';
    return f.presentacion || 'Sencilla';
  }

  /**
   * Qué parte de TODO el inventario es ese hilo. Va escrito junto a su total:
   * un número sin decir contra qué se mide no significa nada.
   */
  porcentajeDelTotal(total: number): number {
    const t = this.kilosTotales();
    return t > 0 ? Math.round((total / t) * 100) : 0;
  }

  /** Los DECIMAL llegan como string; en la plantilla se comparan como número. */
  num(v: string | number | null | undefined): number {
    return Number(v ?? 0);
  }

  /**
   * A cuántas piezas equivalen esos kilos, para leerlo como lo cuenta la tienda:
   * paquetes para el paquete, conos para el cono. Con el peso de la presentación,
   * así que es aproximado (los bultos pesan distinto) y va con "≈".
   */
  equivalencia(s: StockItem): string {
    const peso = Number(s.peso_kg ?? 0);
    const kg = Number(s.cantidad);
    if (!peso || kg <= 0) return '';
    const n = Math.round((kg / peso) * 10) / 10;
    const texto = n.toLocaleString('es-MX', { maximumFractionDigits: 1 });
    if (s.tipo_presentacion === 'paquete') return `≈ ${texto} ${n === 1 ? 'paquete' : 'paquetes'}`;
    if (s.tipo_presentacion === 'cono') return `≈ ${texto} ${n === 1 ? 'cono' : 'conos'}`;
    return '';
  }

  bajoMinimo(s: StockItem): boolean {
    return Number(s.stock_minimo) > 0 && Number(s.disponible) <= Number(s.stock_minimo);
  }

  /** Hay más renglones en el servidor que los que se trajeron. */
  readonly hayMas = computed(() => this.stock().length < this.totalStock());

  /** Abre el modal del mínimo para ese renglón (presentación + almacén). */
  abrirMinimo(s: StockItem): void {
    this.filaMinimo.set(s);
    this.modal.set('minimo');
  }

  /** Abre el detalle del hilo: dónde está, sus lotes y los paquetes de cada uno. */
  abrirHilo(g: GrupoHilo): void {
    if (g.producto_id != null) this.hiloAbierto.set(g);
  }

  cerrarMinimo(): void {
    this.modal.set(null);
    this.filaMinimo.set(null);
  }

  /** El buscador espera a que se deje de teclear; Enter busca de inmediato. */
  alTeclear(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.cargarStock(), 350);
  }

  buscarYa(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.cargarStock();
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
    this.cargarResumen();
    if (this.puedeBajarConos()) {
      this.cargarConos();
      this.cargarConversiones();
    }
  }

  /** Vuelve a la primera página con los filtros de ahora. */
  cargarStock(): void {
    this.pagina = 1;
    this.pedirStock(false);
  }

  /** Trae la página siguiente y la junta con lo que ya hay. */
  cargarMas(): void {
    this.pagina++;
    this.pedirStock(true);
  }

  private pedirStock(juntar: boolean): void {
    this.cargando.set(true);
    this.inv
      .stock({
        almacen_id: this.filtroAlmacen || undefined,
        q: this.filtroQ.trim() || undefined,
        bajo_stock: this.vista === 'minimo' || undefined,
        apartado: this.vista === 'apartado' || undefined,
        ultimo_movimiento: true,
        page: this.pagina,
        limit: POR_PAGINA,
      })
      .subscribe({
        next: (p) => {
          this.stock.set(juntar ? [...this.stock(), ...p.items] : p.items);
          this.totalStock.set(p.total);
          this.cargando.set(false);
        },
        error: (e) => {
          this.error.set(this.msg(e));
          this.cargando.set(false);
        },
      });
  }

  private r3(n: number): number {
    return Math.round(n * 1000) / 1000;
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
