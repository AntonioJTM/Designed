import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AnalisisService } from '../../../core/services/analisis.service';
import { Tablero as DatosTablero } from '../../../core/models/analisis.models';
import { ApiError } from '../../../core/models/auth.models';
import { Barras, Barra } from '../../../shared/charts/barras';
import { Composicion, Tramo } from '../../../shared/charts/composicion';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';

/**
 * El tablero del negocio: las cuatro preguntas que la tienda se hacía de memoria.
 *
 * Está pensado para MIRARSE, no para operar: quien lo abre quiere saber a quién
 * cobrar, quién dejó de venir, qué hilo está parado y qué colores dejan dinero.
 * Cada bloque abre con la cifra grande —lo único que muchos van a leer— y debajo
 * la gráfica y la tabla para quien quiera el detalle.
 *
 * LOS COLORES ESTÁN VALIDADOS, no elegidos a ojo (ver CLAUDE.md y la guía
 * `dataviz`):
 *  · La antigüedad de la cartera es una escala ORDENADA, así que va con una
 *    rampa de UN tono azul de claro a oscuro: el orden se ve en el color y no
 *    hay que ir a la leyenda para saber cuál es peor. Los cuatro pasos pasan las
 *    puertas ordinales (el más claro llega a 2.11:1 sobre el blanco).
 *  · El margen usa azul para lo que gana y rojo para lo que pierde: el par pasa
 *    con ΔE 23.8 en protanopia y 31.6 en visión normal.
 *  · Los cuatro colores de semáforo FALLAN como colores de gráfica (amarillo y
 *    naranja quedan a ΔE 13.6, bajo el piso de 15). Por eso el riesgo va en
 *    PÍLDORAS con icono y texto, nunca como color de barra.
 */
@Component({
  selector: 'app-tablero',
  imports: [FormsModule, RouterLink, Barras, Composicion, CantidadPipe, FechaPipe],
  templateUrl: './tablero.html',
})
export class Tablero implements OnInit {
  private readonly analisis = inject(AnalisisService);

  readonly datos = signal<DatosTablero | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  // --- Filtros. Se aplican al pedir de nuevo, no al teclear. ---
  diasAviso = 30;
  diasSinVenir = 60;

  /**
   * La rampa ORDINAL de la antigüedad: un solo tono, de claro a oscuro. El orden
   * de los cuatro pasos ES el mensaje, así que no se reordenan ni se cambian por
   * colores distintos sin volver a correr el validador.
   */
  private readonly RAMPA_ANTIGUEDAD = ['#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set(null);
    this.analisis
      .tablero({
        dias_aviso: this.diasAviso,
        dias: this.diasSinVenir,
        limite: 15,
      })
      .subscribe({
        next: (d) => {
          this.datos.set(d);
          this.cargando.set(false);
        },
        error: (e) => {
          const api = (e as { error?: { error?: ApiError } })?.error?.error;
          this.error.set(api?.message ?? 'No se pudo cargar el tablero.');
          this.cargando.set(false);
        },
      });
  }

  // ------------------------------------------------------------- 1. Cobranza

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

  // --------------------------------------------------- 2. Clientes enfriados

  /**
   * Los que dejaron de venir, ordenados por lo que compraban. La barra mide lo
   * que GASTABAN —el tamaño de lo que está en juego— y los días sin venir van
   * como detalle: dos medidas distintas no comparten una gráfica, y meter los
   * días en un segundo eje sería el error clásico.
   */
  readonly barrasEnfriados = computed<Barra[]>(() => {
    const c = this.datos()?.clientes_enfriados;
    if (!c) return [];
    return [...c.clientes]
      .sort((a, b) => Number(b.total_comprado) - Number(a.total_comprado))
      .slice(0, 10)
      .map((x) => ({
      label: x.nombre_comercial || x.nombre,
      value: Number(x.total_comprado),
      detalle:
        `${x.dias_sin_venir} días sin venir` +
        (x.veces_su_ritmo ? ` · ${x.veces_su_ritmo}× su ritmo` : ''),
      title: `${x.nombre} · ${x.num_compras} compras`,
    }));
  });

  // --------------------------------------------------------- 3. Hilo muerto

  readonly barrasHiloMuerto = computed<Barra[]>(() => {
    const h = this.datos()?.hilo_muerto;
    if (!h) return [];
    return h.hilos.slice(0, 12).map((x) => ({
      // El cono es otro renglón del MISMO hilo: sin decirlo, "BLANCO 2/30"
      // salía dos veces y parecía un duplicado.
      label: `${x.color}${x.calibre ? ' ' + x.calibre : ''}${x.tipo_presentacion === 'cono' ? ' · cono' : ''}`,
      value: Number(x.dinero_parado),
      detalle:
        `${Number(x.kilos).toLocaleString('es-MX', { maximumFractionDigits: 1 })} kg · ` +
        (x.nunca_vendido ? 'nunca se ha vendido' : `${x.dias_parado} días sin venderse`),
      title: `${x.color} ${x.calibre ?? ''} · ${x.presentacion ?? x.sku}`,
    }));
  });

  // -------------------------------------------------------------- 4. Margen

  /**
   * La ganancia por hilo. Lo que PIERDE va en rojo y con su etiqueta: el color
   * llama la atención, pero el texto es el que dice qué pasa.
   */
  readonly barrasMargen = computed<Barra[]>(() => {
    const m = this.datos()?.margen;
    if (!m) return [];
    return m.hilos.slice(0, 12).map((x) => {
      const ganancia = Number(x.ganancia);
      return {
        label: `${x.color}${x.calibre ? ' ' + x.calibre : ''}`,
        value: ganancia,
        detalle:
          (x.margen_pct !== null ? `${Number(x.margen_pct).toFixed(1)}% de margen` : 'sin margen') +
          (ganancia < 0 ? ' · pierde' : ''),
        // Rojo solo cuando de verdad pierde dinero. El resto, el slot 1.
        color: ganancia < 0 ? '#d03b3b' : undefined,
        title: `${x.color} ${x.calibre ?? ''} · vendió $${Number(x.venta).toFixed(2)}, costó $${Number(x.costo).toFixed(2)}`,
      };
    });
  });

  /** Cuánta venta quedó fuera del margen, en porcentaje. Para el aviso. */
  readonly pctSinCosto = computed(() => {
    const m = this.datos()?.margen;
    if (!m) return 0;
    const total = m.venta_analizada + m.sin_costo_venta;
    return total > 0 ? Math.round((m.sin_costo_venta / total) * 100) : 0;
  });

  /**
   * `Number()` no existe en las plantillas de Angular, así que se expone aquí.
   * Los DECIMAL de MySQL llegan como string y hay que compararlos como números:
   * `'−250.00' < 0` es false en JavaScript porque compara texto.
   */
  num(v: unknown): number {
    return Number(v ?? 0);
  }

  /** Formatea dinero para las cifras grandes. */
  dinero(v: number | string | null | undefined): string {
    const n = Number(v ?? 0);
    return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
  }

  /** Un número compacto para las cifras grandes: 1,284 · 12.9K · 4.2M. */
  compacto(v: number | string | null | undefined): string {
    const n = Number(v ?? 0);
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (Math.abs(n) >= 10_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return n.toLocaleString('es-MX', { maximumFractionDigits: 0 });
  }
}
