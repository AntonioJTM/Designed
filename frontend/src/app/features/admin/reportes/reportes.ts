import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ReportesService } from '../../../core/services/reportes.service';
import { AuthService } from '../../../core/services/auth.service';
import {
  CorteCaja,
  MasVendido,
  PorReabastecer,
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
  pesos,
  porSemana,
  rangoLegible,
  serieDiaria,
  sumarDias,
} from './periodos';

type Pestana = 'ventas' | 'mas' | 'reabastecer' | 'cortes';

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

/**
 * Reportes (rediseño 2026-10): los números del periodo, para revisar o llevarte
 * en un archivo. Cuatro pestañas —ventas por día, más vendidos, por reabastecer
 * y cortes de caja— y un botón que descarga lo que está a la vista en CSV.
 *
 * Las FECHAS de arriba mueven las ventas y los cortes. "Más vendidos" es el
 * acumulado de siempre (así lo calcula la vista) y "Por reabastecer" es el
 * estado de ahora: sus tarjetas lo dicen para que nadie espere que cambien.
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
