import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, catchError, of, switchMap } from 'rxjs';
import { RouterLink } from '@angular/router';
import { ReportesService } from '../../../core/services/reportes.service';
import { AuthService } from '../../../core/services/auth.service';
import {
  CorteCaja,
  HiloVentaColor,
  MasVendido,
  PorReabastecer,
  ReporteVentaColor,
  ReporteVentas,
} from '../../../core/models/reportes.models';
import { ApiError } from '../../../core/models/auth.models';
import { Columnas, Columna } from '../../../shared/charts/columnas';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';
import {
  TramoVentas,
  diasEntre,
  esSabado,
  etiquetaCorta,
  etiquetaDia,
  etiquetaDiaMes,
  fecha,
  iso,
  periodos,
  pesos,
  porSemana,
  rangoLegible,
  serieDiaria,
  sumarDias,
} from './periodos';

type Pestana = 'ventas' | 'mas' | 'color' | 'reabastecer' | 'cortes';

/** Cómo se ordena la tabla de "Venta por color". */
type OrdenColor = 'kg' | 'pct_vendido' | 'existencia';

/** Un tramo del reporte de ventas, listo para la tabla y la gráfica. */
interface FilaVentas extends TramoVentas {
  etiqueta: string;
  etiquetaCorta: string;
  fuerte: boolean;
}

/**
 * Con más días que esto la gráfica de "por día" deja de leerse (barras de un
 * pixel): se agrupa por semana, de domingo a sábado como la nómina.
 */
const MAX_DIAS_POR_DIA = 62;

/** "18.4%" · "< 0.1%" · "—": un porcentaje que se lee de un golpe. */
export function pctTexto(p: number | null | undefined): string {
  if (p === null || p === undefined) return '—';
  if (p > 0 && p < 0.1) return '< 0.1%';
  return `${p.toLocaleString('es-MX', { maximumFractionDigits: 1 })}%`;
}

/** Kilos para una cifra grande: "4,447.6 kg". */
function kilos(n: number): string {
  return `${n.toLocaleString('es-MX', { maximumFractionDigits: 1 })} kg`;
}

/**
 * Reportes (rediseño 2026-10): los números del periodo, para revisar o llevarte
 * en un archivo. Cinco pestañas —ventas por día, más vendidos, venta por color,
 * por reabastecer y cortes de caja— y un botón que descarga lo que está a la
 * vista en CSV.
 *
 * Las FECHAS de arriba mueven las ventas, la venta por color y los cortes.
 * "Más vendidos" es el acumulado de siempre (así lo calcula la vista) y "Por
 * reabastecer" es el estado de ahora: sus tarjetas lo dicen para que nadie
 * espere que cambien.
 */
@Component({
  selector: 'app-reportes',
  imports: [FormsModule, RouterLink, Columnas, CantidadPipe, DineroPipe, FechaPipe],
  templateUrl: './reportes.html',
  styleUrl: './reportes.scss',
})
export class Reportes implements OnInit {
  private readonly rep = inject(ReportesService);
  private readonly auth = inject(AuthService);

  readonly pestanas: { clave: Pestana; nombre: string }[] = [
    { clave: 'ventas', nombre: 'Ventas por día' },
    { clave: 'mas', nombre: 'Más vendidos' },
    { clave: 'color', nombre: 'Venta por color' },
    { clave: 'reabastecer', nombre: 'Por reabastecer' },
    { clave: 'cortes', nombre: 'Cortes de caja' },
  ];
  readonly pestana = signal<Pestana>('ventas');

  readonly ventas = signal<ReporteVentas | null>(null);
  readonly masVendidos = signal<MasVendido[]>([]);
  readonly porReabastecer = signal<PorReabastecer[]>([]);
  readonly cortes = signal<CorteCaja[]>([]);
  readonly error = signal<string | null>(null);

  /** Para el enlace a capturar mínimos: no se ofrece a quien no abre Inventario. */
  readonly veInventario = computed(() => this.auth.puede('ver:inventario'));

  /**
   * El rango. Abre en las dos últimas semanas, como el diseño: un solo día no
   * deja ver si hoy fue bueno o malo, y dos semanas ya enseñan los dos sábados.
   * Hoy sigue siendo el último renglón.
   */
  readonly hoy = iso(new Date());
  desde = iso(sumarDias(new Date(), -13));
  hasta = this.hoy;
  /** El rango con que se pidió lo que está en pantalla (no el que se está tecleando). */
  readonly rango = signal({ desde: this.desde, hasta: this.hasta });

  constructor() {
    // Si se teclea rápido o se cambian las fechas, solo cuenta la ÚLTIMA
    // respuesta: una vieja que llegara tarde pintaría otro rango u otro color.
    this.pedirColor
      .pipe(
        switchMap((p) =>
          this.rep.ventaPorColor(p.desde, p.hasta, p.q).pipe(
            catchError((e) => {
              this.colorPedido = '';
              this.err(e);
              return of(null);
            })
          )
        ),
        takeUntilDestroyed()
      )
      .subscribe((r) => {
        this.cargandoColor.set(false);
        if (r) this.ventaColor.set(r);
      });
    inject(DestroyRef).onDestroy(() => {
      if (this.temporizadorColor) clearTimeout(this.temporizadorColor);
    });
  }

  ngOnInit(): void {
    this.cargar();
    this.rep.masVendidos(20).subscribe({ next: (m) => this.masVendidos.set(m), error: (e) => this.err(e) });
    this.rep.porReabastecer().subscribe({ next: (p) => this.porReabastecer.set(p), error: (e) => this.err(e) });
  }

  /** Ventas y cortes del rango. Se llama al cambiar cualquiera de las dos fechas. */
  cargar(): void {
    // Un rango al revés se voltea en vez de regresar un reporte vacío.
    if (this.desde && this.hasta && this.desde > this.hasta) {
      [this.desde, this.hasta] = [this.hasta, this.desde];
    }
    const d = this.desde || this.hoy;
    const h = this.hasta || d;
    this.rango.set({ desde: d, hasta: h });
    this.error.set(null);
    this.rep.ventas(d, h).subscribe({ next: (v) => this.ventas.set(v), error: (e) => this.err(e) });
    this.rep.cortesCaja(d, h).subscribe({ next: (c) => this.cortes.set(c.cortes), error: (e) => this.err(e) });
    // La venta por color se pide solo si está a la vista; si no, al abrir su pestaña.
    if (this.pestana() === 'color') this.cargarColor();
  }

  /** Cambia de pestaña. "Venta por color" se pide hasta que se abre. */
  elegir(t: Pestana): void {
    this.pestana.set(t);
    if (t === 'color') this.cargarColor();
  }

  // ---------------------------------------------------------------- Ventas

  /** "Del 19 de septiembre al 2 de octubre". */
  readonly rangoTexto = computed(() => rangoLegible(this.rango().desde, this.rango().hasta));

  readonly porSemanas = computed(() => diasEntre(this.rango().desde, this.rango().hasta) > MAX_DIAS_POR_DIA);

  /** Todos los días (o semanas) del rango, también los que no tuvieron ventas. */
  readonly filas = computed<FilaVentas[]>(() => {
    const v = this.ventas();
    if (!v) return [];
    const diaria = serieDiaria(this.rango().desde, this.rango().hasta, v.porDia);
    if (this.porSemanas()) {
      return porSemana(diaria).map((s) => ({
        ...s,
        etiqueta: `${etiquetaCorta(fecha(s.desde))} al ${etiquetaCorta(fecha(s.hasta))}`,
        etiquetaCorta: etiquetaCorta(fecha(s.desde)),
        fuerte: false,
      }));
    }
    return diaria.map((d) => ({
      ...d,
      etiqueta: etiquetaDiaMes(fecha(d.desde)),
      etiquetaCorta: etiquetaDia(fecha(d.desde)),
      // Los sábados son el día fuerte de la tienda: se marcan para compararlos.
      fuerte: esSabado(fecha(d.desde)),
    }));
  });

  readonly columnas = computed<Columna[]>(() =>
    this.filas().map((f) => ({
      etiqueta: f.etiquetaCorta,
      valor: f.total,
      fuerte: f.fuerte,
      titulo: `${f.etiqueta}: ${pesos(f.total)} en ${f.ventas} ${f.ventas === 1 ? 'venta' : 'ventas'}`,
    }))
  );

  readonly resumenGrafica = computed(() => {
    const f = this.filas();
    if (f.length === 0) return '';
    const mayor = f.reduce((a, b) => (b.total > a.total ? b : a));
    return `Ventas ${this.porSemanas() ? 'por semana' : 'por día'}, ${this.rangoTexto().toLowerCase()}; ` +
      `el ${this.porSemanas() ? 'tramo' : 'día'} más fuerte fue ${mayor.etiqueta}, con ${pesos(mayor.total)}`;
  });

  /** Las cuatro cifras de arriba. */
  readonly kpis = computed(() => {
    const v = this.ventas();
    if (!v) return [];
    const total = Number(v.resumen.total);
    const n = Number(v.resumen.num_pedidos);
    const kilos = Number(v.resumen.kilos ?? 0);
    const kilosPaquete = Number(v.resumen.kilos_paquete ?? 0);
    const dias = diasEntre(this.rango().desde, this.rango().hasta);
    const conVentas = v.porDia.filter((d) => Number(d.num_pedidos) > 0).length;
    const lista = [
      {
        etiqueta: 'Vendido',
        valor: pesos(total),
        pie: dias === 1
          ? (conVentas ? 'en el día' : 'sin ventas ese día')
          : `en ${dias} días · ${conVentas} con ventas`,
        punto: '#2457C5',
      },
      {
        etiqueta: 'Ventas',
        valor: n.toLocaleString('es-MX'),
        pie: conVentas > 1 ? `unas ${Math.round(n / conVentas)} por día con ventas` : 'en el periodo',
        punto: '#2a78d6',
      },
      {
        etiqueta: 'Por venta',
        valor: n > 0 ? pesos(total / n) : '—',
        pie: 'en promedio',
        punto: '#1baf7a',
      },
    ];
    // Los kilos los da el reporte desde 2026-10; con un servidor viejo no se inventan.
    if (v.resumen.kilos !== undefined) {
      lista.push({
        etiqueta: 'Kilos vendidos',
        valor: `${kilos.toLocaleString('es-MX', { maximumFractionDigits: 0 })} kg`,
        pie: kilos > 0 ? `${Math.round((kilosPaquete / kilos) * 100)}% en paquete` : 'sin kilos en el periodo',
        punto: '#eb6834',
      });
    }
    return lista;
  });

  /** Los totales del pie de la tabla. */
  readonly totales = computed(() => {
    const f = this.filas();
    const ventas = f.reduce((s, x) => s + x.ventas, 0);
    const total = f.reduce((s, x) => s + x.total, 0);
    const kilos = f.reduce((s, x) => s + x.kilos, 0);
    return { ventas, total, kilos, porVenta: ventas > 0 ? total / ventas : null };
  });

  // ------------------------------------------------------------ Más vendidos

  /**
   * Contra el que más ha vendido: la barra más larga es él, y la tarjeta lo
   * dice. Llega al 80% del carril y no al 100%, para que los kilos que van a su
   * lado quepan sin salirse.
   */
  readonly barrasMas = computed(() => {
    const m = this.masVendidos();
    const max = Math.max(0, ...m.map((x) => Number(x.unidades_vendidas)));
    return m.map((x) => ({
      ...x,
      nombre: this.nombreHilo(x),
      pct: max > 0 ? Math.max(1, (Number(x.unidades_vendidas) / max) * 80) : 0,
    }));
  });

  /** Cómo se nombra el hilo: color, calibre y, si es cono, que lo es. */
  nombreHilo(m: { producto: string; calibre?: string | null; tipo_presentacion?: string | null }): string {
    return `${m.producto}${m.calibre ? ' ' + m.calibre : ''}${m.tipo_presentacion === 'cono' ? ' · cono' : ''}`;
  }

  /** Cuánto le falta para llegar a su mínimo. */
  faltan(p: PorReabastecer): number {
    return Math.max(0, Number(p.stock_minimo) - Number(p.disponible));
  }

  // --------------------------------------------------------- Venta por color

  /**
   * "En cierto rango de tiempo cuántos kg se han vendido de cierto color y qué
   * porcentaje lo representa, y qué porcentaje del color ya se vendió y cuánto
   * queda en inventario." Un renglón por HILO (color + calibre), con el paquete
   * y el cono sumados. Lo vendido es lo que SALIÓ del inventario: un apartado
   * sin entregar no cuenta (sigue en la bodega).
   */
  readonly ventaColor = signal<ReporteVentaColor | null>(null);
  readonly cargandoColor = signal(false);
  /** Lo que se busca: color, calibre, material o línea. Señal, porque la tabla la lee. */
  readonly buscaColor = signal('');
  readonly ordenColor = signal<OrdenColor>('kg');
  /** Los atajos de periodo, los mismos de "Cómo va el negocio". */
  readonly periodosRapidos = periodos(new Date());
  private readonly pedirColor = new Subject<{ desde: string; hasta: string; q: string }>();
  /** Rango y búsqueda de lo que está en pantalla (o en camino), para no pedirlo dos veces. */
  private colorPedido = '';
  private temporizadorColor: ReturnType<typeof setTimeout> | null = null;

  readonly pctTexto = pctTexto;

  private cargarColor(): void {
    const { desde, hasta } = this.rango();
    const q = this.buscaColor().trim();
    const clave = `${desde}|${hasta}|${q}`;
    if (clave === this.colorPedido) return;
    this.colorPedido = clave;
    this.cargandoColor.set(true);
    this.pedirColor.next({ desde, hasta, q });
  }

  /** El buscador espera a que se deje de teclear; Enter busca de inmediato. */
  buscarColor(texto: string): void {
    this.buscaColor.set(texto);
    if (this.temporizadorColor) clearTimeout(this.temporizadorColor);
    this.temporizadorColor = setTimeout(() => this.cargarColor(), 300);
  }

  buscarColorYa(): void {
    if (this.temporizadorColor) clearTimeout(this.temporizadorColor);
    this.cargarColor();
  }

  /** El atajo que corresponde a las fechas de arriba, o '' si son otras. */
  readonly periodoActual = computed(() => {
    const { desde, hasta } = this.rango();
    return this.periodosRapidos.find((p) => p.desde === desde && p.hasta === hasta)?.clave ?? '';
  });

  /** Un atajo mueve las fechas de arriba: el rango es uno para toda la pantalla. */
  usarPeriodo(clave: string): void {
    const p = this.periodosRapidos.find((x) => x.clave === clave);
    if (!p) return;
    this.desde = p.desde;
    this.hasta = p.hasta;
    this.cargar();
  }

  /** Los renglones en el orden elegido. El servidor los manda del que más vendió al que menos. */
  readonly filasColor = computed<HiloVentaColor[]>(() => {
    const filas = [...(this.ventaColor()?.hilos ?? [])];
    switch (this.ordenColor()) {
      case 'pct_vendido':
        // Sin nada contra qué medir (null) va al final.
        filas.sort((a, b) => (b.pct_vendido ?? -1) - (a.pct_vendido ?? -1) || b.kg_vendidos - a.kg_vendidos);
        break;
      case 'existencia':
        filas.sort((a, b) => b.existencia - a.existencia || b.kg_vendidos - a.kg_vendidos);
        break;
    }
    return filas;
  });

  /** Las cuatro cifras de arriba de la pestaña. */
  readonly kpisColor = computed(() => {
    const r = this.ventaColor();
    if (!r) return [];
    const t = r.totales;
    const sinVenta = t.num_hilos - t.num_con_venta;
    return [
      {
        etiqueta: 'Kilos vendidos',
        valor: kilos(t.kg_vendidos),
        // Con una búsqueda, la pregunta es qué parte de la venta fue ese color.
        pie: r.q
          ? (t.pct_del_periodo === null ? 'sin ventas en el periodo' : `${pctTexto(t.pct_del_periodo)} de todo lo vendido`)
          : `en ${t.num_con_venta} ${t.num_con_venta === 1 ? 'hilo' : 'hilos'}`,
        punto: '#eb6834',
      },
      { etiqueta: 'Importe', valor: pesos(t.importe), pie: 'lo cobrado por esos kilos, sin IVA', punto: '#2457C5' },
      {
        etiqueta: 'Queda en inventario',
        valor: kilos(t.existencia),
        pie: t.pct_vendido === null ? 'sin ventas ni existencias' : `ya se vendió el ${pctTexto(t.pct_vendido)}`,
        punto: '#1baf7a',
      },
      {
        etiqueta: 'Hilos',
        valor: t.num_hilos.toLocaleString('es-MX'),
        pie: `${t.num_con_venta} con ventas · ${sinVenta} sin vender en el periodo`,
        punto: '#2a78d6',
      },
    ];
  });

  /** "ACRILAN · Turco": lo que distingue al hilo además del color. */
  detalleHilo(h: HiloVentaColor): string {
    return [h.material, h.linea].filter(Boolean).join(' · ');
  }

  /** La barra se llena con el MISMO porcentaje que dice el número (contra 100%). */
  barra(p: number | null): number {
    return p === null ? 0 : Math.min(100, Math.max(0, p));
  }

  // ------------------------------------------------------------ Cortes

  /** El estado de la diferencia, con palabra: el color de la píldora no basta. */
  diferencia(c: CorteCaja): { clase: string; texto: string } | null {
    if (c.diferencia === null || c.diferencia === undefined) return null;
    const d = Number(c.diferencia);
    if (d === 0) return { clase: 'pill verde', texto: 'Cuadró' };
    const monto = Math.abs(d).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
    return d < 0
      ? { clase: 'pill rojo', texto: `Faltaron ${monto}` }
      : { clase: 'pill ambar', texto: `Sobraron ${monto}` };
  }

  readonly conDiferencia = computed(() => this.cortes().filter((c) => Number(c.diferencia ?? 0) !== 0).length);

  // ----------------------------------------------------------- Descargar

  /**
   * Lo que está a la vista, en un CSV que abre Excel. Los números van SIN
   * separador de miles ni símbolo, para que la hoja los pueda sumar; el BOM del
   * principio hace que Excel lea bien los acentos.
   */
  descargar(): void {
    const { desde, hasta } = this.rango();
    const r = (x: unknown) => String(x ?? '');
    let nombre = '';
    let filas: (string | number)[][] = [];

    switch (this.pestana()) {
      case 'ventas':
        nombre = `ventas_${desde}_a_${hasta}`;
        filas = [
          [this.porSemanas() ? 'Semana' : 'Día', 'Ventas', 'Kilos', 'Total', 'Por venta'],
          ...this.filas().map((f) => [
            this.porSemanas() ? `${f.desde} a ${f.hasta}` : f.desde,
            f.ventas,
            f.kilos.toFixed(3),
            f.total.toFixed(2),
            f.ventas > 0 ? (f.total / f.ventas).toFixed(2) : '',
          ]),
        ];
        break;
      case 'mas':
        nombre = `mas-vendidos_${this.hoy}`;
        filas = [
          ['Hilo', 'SKU', 'Kilos', 'Ingresos'],
          ...this.masVendidos().map((m) => [this.nombreHilo(m), m.sku, r(m.unidades_vendidas), r(m.ingresos)]),
        ];
        break;
      case 'color': {
        nombre = `venta-por-color_${desde}_a_${hasta}`;
        const p = (x: number | null) => (x === null ? '' : x.toFixed(2));
        filas = [
          ['Hilo', 'Material', 'Línea', 'Kg vendidos', '% del periodo', 'Importe',
           'Vendido desde siempre (kg)', 'Queda en inventario (kg)', '% ya vendido', 'Última venta'],
          ...this.filasColor().map((h) => [
            `${h.color}${h.calibre ? ' ' + h.calibre : ''}`, r(h.material), r(h.linea),
            h.kg_vendidos.toFixed(3), p(h.pct_del_periodo), h.importe.toFixed(2),
            h.vendido_total.toFixed(3), h.existencia.toFixed(3), p(h.pct_vendido), r(h.ultima_venta),
          ]),
        ];
        break;
      }
      case 'reabastecer':
        nombre = `por-reabastecer_${this.hoy}`;
        filas = [
          ['Hilo', 'SKU', 'Almacén', 'Disponible (kg)', 'Mínimo (kg)', 'Faltan (kg)'],
          ...this.porReabastecer().map((p) => [
            this.nombreHilo(p), p.sku, p.almacen, r(p.disponible), r(p.stock_minimo), this.faltan(p).toFixed(3),
          ]),
        ];
        break;
      case 'cortes':
        nombre = `cortes-de-caja_${desde}_a_${hasta}`;
        filas = [
          ['Caja', 'Cajero', 'Estado', 'Abrió', 'Cerró', 'Inicial', 'Ventas en efectivo', 'Esperado', 'Contado', 'Diferencia'],
          ...this.cortes().map((c) => [
            c.caja, c.usuario, c.estado, r(c.fecha_apertura), r(c.fecha_cierre), r(c.monto_inicial),
            r(c.ventas_efectivo), r(c.monto_esperado), r(c.monto_final), r(c.diferencia),
          ]),
        ];
        break;
    }

    const celda = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = '﻿' + filas.map((f) => f.map(celda).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nombre}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private err(e: unknown): void {
    this.error.set((e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Error al cargar reportes');
  }
}
