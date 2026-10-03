import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AnalisisService } from '../../../core/services/analisis.service';
import { ReportesService } from '../../../core/services/reportes.service';
import { AuthService } from '../../../core/services/auth.service';
import { HiloParado, MargenHilo, Tablero as DatosTablero } from '../../../core/models/analisis.models';
import { ReporteVentas } from '../../../core/models/reportes.models';
import { ApiError } from '../../../core/models/auth.models';
import { Barras, Barra } from '../../../shared/charts/barras';
import { Composicion, Tramo } from '../../../shared/charts/composicion';
import { BarrasCero, BarraCero } from '../../../shared/charts/barras-cero';
import { Columnas, Columna } from '../../../shared/charts/columnas';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';
import {
  Periodo,
  comparar,
  etiquetaCorta,
  fecha,
  inicioSemana,
  iso,
  periodoInicial,
  periodos,
  pesos,
  pesosCorto,
  porSemana,
  serieDiaria,
  sumarDias,
} from '../reportes/periodos';

/** Una cifra de arriba: el dato que muchos van a ser lo único que lean. */
interface Kpi {
  etiqueta: string;
  valor: string;
  pie: string;
  punto: string;
}

/** Cuántas semanas se dibujan en "Ventas por semana". */
const SEMANAS = 12;

/**
 * "Cómo va el negocio" (rediseño 2026-10): ventas, ganancia y dinero parado, y
 * debajo a quién cobrarle. Quién dejó de venir se mudó a Clientes → Dejaron de
 * venir (2026-10-03), que es a donde lleva el aviso de la campana.
 *
 * Está pensado para MIRARSE, no para operar. Arriba van las cuatro cifras del
 * periodo; luego las ventas de las últimas 12 semanas (siempre las mismas, para
 * ver la tendencia sin que el selector la mueva); luego qué colores dejan
 * dinero y qué hilo está parado; y al final la cobranza y los clientes que se
 * enfriaron, cada uno con su cifra, su gráfica y su tabla.
 *
 * COSTOS: el margen y la ganancia solo los ve quien tiene «Ver costos y
 * márgenes» (`hacer:ver_costos`). El servidor ni siquiera los manda a quien no
 * lo tiene (llegan en `null`); aquí además se esconden su tarjeta y su cifra.
 * El HILO PARADO sí lo ve todo el que abre el tablero: sin ese permiso llega
 * valorado a PRECIO DE VENTA, que no expone nada (la tienda no lleva el costo
 * desde el 2026-10-03 y el usuario pidió conservarlo así).
 *
 * LOS COLORES ESTÁN VALIDADOS, no elegidos a ojo (ver CLAUDE.md y la guía
 * `dataviz`):
 *  · La antigüedad de la cartera es una escala ORDENADA, así que va con una
 *    rampa de UN tono azul de claro a oscuro: el orden se ve en el color y no
 *    hay que ir a la leyenda para saber cuál es peor. Los cuatro pasos pasan las
 *    puertas ordinales (el más claro llega a 2.11:1 sobre el blanco).
 *  · El margen usa el azul (slot 1) para lo que gana y el naranja (slot 2) para
 *    lo que pierde: el par pasa con ΔE 24.7 en protanopia y 33.6 en visión
 *    normal, y la cifra lleva su signo para que el color no cargue el dato solo.
 *  · Los cuatro colores de semáforo FALLAN como colores de gráfica (amarillo y
 *    naranja quedan a ΔE 13.6, bajo el piso de 15). Por eso el riesgo va en
 *    PÍLDORAS con icono y texto, nunca como color de barra.
 */
@Component({
  selector: 'app-tablero',
  imports: [FormsModule, RouterLink, Barras, Composicion, BarrasCero, Columnas, CantidadPipe, DineroPipe, FechaPipe],
  templateUrl: './tablero.html',
  styleUrl: './tablero.scss',
})
export class Tablero implements OnInit {
  private readonly analisis = inject(AnalisisService);
  private readonly reportes = inject(ReportesService);
  private readonly auth = inject(AuthService);

  /** El margen expone costos. */
  readonly veCostos = computed(() => this.auth.puede('hacer:ver_costos'));
  /** Para no enlazar al expediente a quien no puede abrir Clientes. */
  readonly veClientes = computed(() => this.auth.puede('ver:clientes'));

  // ------------------------------------------------------------ El periodo
  private readonly hoy = new Date();
  readonly periodos = periodos(this.hoy);
  readonly periodoClave = signal<Periodo['clave']>(periodoInicial(this.hoy));
  readonly periodo = computed(
    () => this.periodos.find((p) => p.clave === this.periodoClave()) ?? this.periodos[0]
  );

  // ------------------------------------------------------------ Los datos
  readonly datos = signal<DatosTablero | null>(null);
  readonly ventas = signal<ReporteVentas | null>(null);
  readonly ventasAntes = signal<ReporteVentas | null>(null);
  readonly ventasSemanas = signal<ReporteVentas | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly errorVentas = signal<string | null>(null);

  /**
   * Cada petición lleva su número: si se cambia de periodo dos veces seguidas,
   * la respuesta vieja que llegue tarde se descarta en vez de pisar a la nueva.
   */
  private turnoTablero = 0;
  private turnoVentas = 0;

  // --- Lo que se despliega. ---
  readonly verTablaMargen = signal(false);
  readonly verTodoParado = signal(false);

  /**
   * La rampa ORDINAL de la antigüedad: un solo tono, de claro a oscuro. El orden
   * de los cuatro pasos ES el mensaje, así que no se reordenan ni se cambian por
   * colores distintos sin volver a correr el validador.
   */
  private readonly RAMPA_ANTIGUEDAD = ['#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];

  /** Desde qué domingo arrancan las 12 semanas: la última es la que va en curso. */
  private readonly desdeSemanas = iso(sumarDias(inicioSemana(this.hoy), -7 * (SEMANAS - 1)));
  private readonly hoyIso = iso(this.hoy);

  ngOnInit(): void {
    this.cargar();
  }

  /** Todo de nuevo (botón "Actualizar"). */
  cargar(): void {
    this.cargarTablero();
    this.cargarVentas();
    this.reportes.ventas(this.desdeSemanas, this.hoyIso).subscribe({
      next: (v) => this.ventasSemanas.set(v),
      error: (e) => this.errorVentas.set(this.msg(e, 'No se pudieron consultar las ventas.')),
    });
  }

  elegirPeriodo(clave: Periodo['clave']): void {
    this.periodoClave.set(clave);
    // El periodo mueve lo vendido y el margen; la cobranza y los clientes no
    // dependen de él, pero vienen en el mismo viaje que el margen.
    this.cargarTablero();
    this.cargarVentas();
  }

  /** Cobranza, hilo parado y margen: un solo viaje (los enfriados ya no se pintan aquí). */
  cargarTablero(): void {
    const turno = ++this.turnoTablero;
    const p = this.periodo();
    this.cargando.set(true);
    this.error.set(null);
    this.analisis
      .tablero({
        dias_aviso: 30,
        // El servidor recorta la LISTA, no las cifras. Se piden de sobra para que
        // los hilos que pierden dinero —que vienen al final— no se queden fuera.
        limite: 50,
        desde: p.desde,
        hasta: p.hasta,
      })
      .subscribe({
        next: (d) => {
          if (turno !== this.turnoTablero) return;
          this.datos.set(d);
          this.cargando.set(false);
        },
        error: (e) => {
          if (turno !== this.turnoTablero) return;
          this.error.set(this.msg(e, 'No se pudo cargar el tablero.'));
          this.cargando.set(false);
        },
      });
  }

  /** Lo vendido en el periodo y en el anterior del mismo tamaño, para comparar. */
  private cargarVentas(): void {
    const turno = ++this.turnoVentas;
    const p = this.periodo();
    this.ventas.set(null);
    this.ventasAntes.set(null);
    this.errorVentas.set(null);
    forkJoin([
      this.reportes.ventas(p.desde, p.hasta),
      this.reportes.ventas(p.antes.desde, p.antes.hasta),
    ]).subscribe({
      next: ([v, a]) => {
        if (turno !== this.turnoVentas) return;
        this.ventas.set(v);
        this.ventasAntes.set(a);
      },
      error: (e) => {
        if (turno !== this.turnoVentas) return;
        this.errorVentas.set(this.msg(e, 'No se pudieron consultar las ventas.'));
      },
    });
  }

  // ------------------------------------------------------------- Cifras

  readonly kpis = computed<Kpi[]>(() => {
    const p = this.periodo();
    const v = this.ventas();
    const a = this.ventasAntes();
    const d = this.datos();
    const lista: Kpi[] = [];

    lista.push({
      etiqueta: p.vendidoEn,
      valor: v ? pesos(v.resumen.total) : '—',
      pie: v && a
        ? comparar(Number(v.resumen.total), Number(a.resumen.total), p.antes.nombre)
        : this.errorVentas() ? 'no se pudo consultar' : 'consultando…',
      punto: '#2457C5',
    });

    if (this.veCostos()) {
      const m = d?.margen;
      lista.push({
        etiqueta: 'Ganancia',
        valor: m && m.venta_analizada > 0 ? pesos(m.ganancia) : '—',
        pie: !m ? '…'
          : m.venta_analizada > 0
            ? `margen de ${this.pct(m.margen_pct)} sobre la venta`
            : 'falta capturar el precio de compra en las remesas',
        punto: '#1baf7a',
      });
    }

    // El hilo parado, a quien le llegue (sin costos, a precio de venta).
    const h = d?.hilo_muerto;
    if (h || !d) {
      lista.push({
        etiqueta: 'Dinero en hilo parado',
        valor: h ? pesos(h.dinero_parado) : '—',
        pie: !h ? '…'
          : h.num_hilos === 0
            ? 'todo el hilo se está moviendo'
            : `${h.num_hilos} ${h.num_hilos === 1 ? 'hilo lleva' : 'hilos llevan'} ${h.dias} días o más sin venderse`,
        punto: '#eb6834',
      });
    }

    const c = d?.cobranza;
    lista.push({
      etiqueta: 'Por cobrar',
      valor: c ? pesos(c.total_por_cobrar) : '—',
      pie: !c ? '…'
        : c.num_clientes === 0
          ? 'nadie te debe ahora mismo'
          : `${c.num_clientes} ${c.num_clientes === 1 ? 'cliente' : 'clientes'}` +
            (c.num_vencidos > 0 ? ` · ${c.num_vencidos} con más de ${c.dias_aviso} días sin abonar` : ''),
      punto: '#C2410C',
    });
    return lista;
  });

  // ----------------------------------------------------- Ventas por semana

  private readonly serieSemanas = computed(() => {
    const v = this.ventasSemanas();
    return v ? porSemana(serieDiaria(this.desdeSemanas, this.hoyIso, v.porDia)) : [];
  });

  /** Una columna por semana; la última —la que va en curso— en el paso fuerte. */
  readonly columnasSemanas = computed<Columna[]>(() => {
    const serie = this.serieSemanas();
    return serie.map((s, i) => {
      const ultima = i === serie.length - 1;
      return {
        etiqueta: etiquetaCorta(fecha(s.desde)),
        valor: s.total,
        rotulo: pesosCorto(s.total),
        fuerte: ultima,
        titulo:
          `Del ${etiquetaCorta(fecha(s.desde))} al ${etiquetaCorta(fecha(s.hasta))}` +
          `${ultima ? ' (va en curso)' : ''}: ${pesos(s.total)} en ${s.ventas} ${s.ventas === 1 ? 'venta' : 'ventas'}`,
      };
    });
  });

  /** Lo que dice la gráfica en una frase, para el lector de pantalla. */
  readonly resumenSemanas = computed(() => {
    const serie = this.serieSemanas();
    if (serie.length === 0) return '';
    const totales = serie.map((s) => s.total);
    return `Ventas por semana entre ${pesos(Math.min(...totales))} y ${pesos(Math.max(...totales))}; ` +
      `la última, que va en curso, ${pesos(totales[totales.length - 1])}`;
  });

  // ---------------------------------------------------------------- Margen

  /**
   * Los que más dejan y, al final, los que se vendieron perdiendo. El servidor
   * los manda de la mayor ganancia a la menor, así que los que pierden vienen al
   * final: se toman los diez primeros y los cinco que más pierden, para que una
   * lista larga de hilos que ganan no los saque de la gráfica, que es justo lo
   * que más importa ver.
   */
  readonly barrasMargen = computed<BarraCero[]>(() => {
    const m = this.datos()?.margen;
    if (!m) return [];
    const ganan = m.hilos.filter((h) => Number(h.ganancia) >= 0).slice(0, 10);
    const pierden = m.hilos.filter((h) => Number(h.ganancia) < 0).slice(-5);
    return [...ganan, ...pierden].map((h) => ({
      etiqueta: this.nombreHilo(h),
      valor: Number(h.ganancia),
      rotulo: `${pesos(h.ganancia)} · ${this.pct(h.margen_pct)}`,
      titulo:
        `${this.nombreHilo(h)}${h.material ? ' · ' + h.material : ''}${h.linea ? ' · ' + h.linea : ''}: ` +
        `vendió ${pesos(h.venta)}, costó ${pesos(h.costo)}` +
        (Number(h.ganancia) < 0 ? ' · se vendió perdiendo' : ''),
    }));
  });

  readonly hayPerdidas = computed(() => this.barrasMargen().some((b) => b.valor < 0));

  /** Cuánta venta quedó fuera del margen, en porcentaje. Para el aviso. */
  readonly pctSinCosto = computed(() => {
    const m = this.datos()?.margen;
    if (!m) return 0;
    const total = m.venta_analizada + m.sin_costo_venta;
    return total > 0 ? Math.round((m.sin_costo_venta / total) * 100) : 0;
  });

  // ----------------------------------------------------------- Hilo parado

  readonly paradoVisible = computed<HiloParado[]>(() => {
    const h = this.datos()?.hilo_muerto?.hilos ?? [];
    return this.verTodoParado() ? h : h.slice(0, 8);
  });

  /** "Paquete", "Cono" o el nombre de la presentación. */
  presentacion(h: HiloParado): string {
    if (h.tipo_presentacion === 'paquete') return 'Paquete';
    if (h.tipo_presentacion === 'cono') return 'Cono';
    return h.presentacion || h.sku;
  }

  // ------------------------------------------------------------- Cobranza

  /** La cartera partida por antigüedad, para la barra de composición. */
  readonly tramosCartera = computed<Tramo[]>(() => {
    const c = this.datos()?.cobranza;
    if (!c) return [];
    return c.por_antiguedad.map((t, i) => ({
      etiqueta: t.etiqueta,
      valor: t.monto,
      color: this.RAMPA_ANTIGUEDAD[Math.min(i, this.RAMPA_ANTIGUEDAD.length - 1)],
      detalle: `${t.clientes} ${t.clientes === 1 ? 'cliente' : 'clientes'}`,
    }));
  });

  /**
   * Quién debe más. Una sola serie: todas del mismo color.
   *
   * Se ORDENA POR MONTO aquí, aunque el backend las manda por antigüedad (que
   * es el orden correcto para la tabla, donde importa a quién llamar primero).
   * En una gráfica de barras el ojo lee la longitud y espera que la más larga
   * esté arriba: con la de $22,000 en medio, la gráfica parecía desordenada y
   * costaba encontrar al que más debe, que es justo lo que promete el título.
   */
  readonly barrasDeudores = computed<Barra[]>(() => {
    const c = this.datos()?.cobranza;
    if (!c) return [];
    return [...c.clientes]
      .sort((a, b) => Number(b.saldo) - Number(a.saldo))
      .slice(0, 10)
      .map((x) => ({
        label: x.nombre_comercial || x.nombre,
        value: Number(x.saldo),
        detalle: `${x.dias_sin_abonar} días sin abonar`,
        title: `${x.nombre}${x.telefono ? ' · ' + x.telefono : ''}`,
      }));
  });

  /**
   * El riesgo de un saldo, como PÍLDORA. Devuelve la clave del estado; la
   * plantilla le pone el icono y el texto, porque el color no puede cargar el
   * significado solo (los cuatro colores de semáforo no se distinguen bien
   * entre sí y el validador lo confirmó).
   */
  riesgo(dias: number): 'al-dia' | 'aviso' | 'serio' | 'critico' {
    if (dias <= 30) return 'al-dia';
    if (dias <= 60) return 'aviso';
    if (dias <= 90) return 'serio';
    return 'critico';
  }

  /** La píldora del sistema de diseño que le toca a cada riesgo. */
  claseRiesgo(dias: number): string {
    const r = this.riesgo(dias);
    return r === 'al-dia' ? 'pill verde' : r === 'aviso' ? 'pill ambar' : r === 'serio' ? 'pill naranja' : 'pill rojo';
  }

  etiquetaRiesgo(dias: number): string {
    const r = this.riesgo(dias);
    return r === 'al-dia' ? 'Al día'
      : r === 'aviso' ? 'Por cobrar'
      : r === 'serio' ? 'Atrasado'
      : 'Muy atrasado';
  }

  iconoRiesgo(dias: number): string {
    const r = this.riesgo(dias);
    return r === 'al-dia' ? '✓' : r === 'aviso' ? '!' : r === 'serio' ? '!!' : '✕';
  }

  // ---------------------------------------------------------- Utilidades

  /** El hilo con su calibre: "ROJO 2/30". El mismo color en dos calibres son dos hilos. */
  nombreHilo(h: Pick<MargenHilo, 'color' | 'calibre'>): string {
    return `${h.color}${h.calibre ? ' ' + h.calibre : ''}`;
  }

  /** "31%" · "-6%" · "12.5%" · "—" si no se pudo calcular. */
  pct(v: number | string | null | undefined): string {
    if (v === null || v === undefined || v === '') return '—';
    return `${Number(v).toLocaleString('es-MX', { maximumFractionDigits: 1 })}%`;
  }

  /**
   * `Number()` no existe en las plantillas de Angular, así que se expone aquí.
   * Los DECIMAL de MySQL llegan como string y hay que compararlos como números:
   * `'−250.00' < 0` es false en JavaScript porque compara texto.
   */
  num(v: unknown): number {
    return Number(v ?? 0);
  }

  /** Pesos sin centavos para las cifras grandes; en las tablas va el pipe `dinero`. */
  pesos(v: number | string | null | undefined): string {
    return pesos(v);
  }

  private msg(e: unknown, porOmision: string): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? porOmision;
  }
}
