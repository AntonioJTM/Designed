import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { combineLatest } from 'rxjs';
import { RotacionService } from '../../../core/services/rotacion.service';
import { TiempoRealService } from '../../../core/services/tiempo-real.service';
import { AuthService } from '../../../core/services/auth.service';
import { ApiError } from '../../../core/models/auth.models';
import {
  HiloDetalle,
  QuePedirRotacion,
  ResumenRotacion,
  TemporadasRotacion,
} from '../../../core/models/rotacion.models';
import { guardarArchivo } from '../../../shared/descargar';
import { VistaResumen } from './vistas/vista-resumen';
import { VistaTemporadas } from './vistas/vista-temporadas';
import { VistaHilo } from './vistas/vista-hilo';
import { VistaQuePedir } from './vistas/vista-que-pedir';
import { ComoSeCalculaModal } from './como-se-calcula-modal';
import { AjustesModal } from './ajustes-modal';
import { VentasAnterioresModal } from './ventas-anteriores-modal';
import { MESES, alcanzaHasta, csv, estadoTexto, fechaLarga } from './rotacion-ui';

export type VistaRotacion = 'resumen' | 'temporadas' | 'hilo' | 'que-pedir';

const PESTANAS: { vista: VistaRotacion; etiqueta: string; ruta: string }[] = [
  { vista: 'resumen', etiqueta: 'Resumen', ruta: '/admin/rotacion/resumen' },
  { vista: 'temporadas', etiqueta: 'Temporadas', ruta: '/admin/rotacion/temporadas' },
  { vista: 'hilo', etiqueta: 'Por hilo', ruta: '/admin/rotacion/hilo' },
  { vista: 'que-pedir', etiqueta: 'Qué pedir', ruta: '/admin/rotacion/que-pedir' },
];

/**
 * ROTACIÓN DE INVENTARIO (2026-10-22, Documentos/rotacion-inventario): cuánto
 * hilo se vende, en qué meses y cuándo conviene pedirlo. SOLO KILOS. Cuatro
 * pestañas, cada una su ruta (`data.vista`); los filtros van en la dirección
 * (?almacen=, ?hilo=, ?tienda=, ?anio=) para que un enlace abra lo mismo.
 *
 * Junta todas las tiendas: la ve quien las ve todas (`data.todasLasTiendas`).
 * Se calcula al momento con lo que hay; con poca historia, lo dice en lugar de
 * adivinar. Se pone al día sola cuando hay ventas o cambia el inventario.
 */
@Component({
  selector: 'app-rotacion',
  imports: [FormsModule, RouterLink, VistaResumen, VistaTemporadas, VistaHilo, VistaQuePedir,
    ComoSeCalculaModal, AjustesModal, VentasAnterioresModal],
  templateUrl: './rotacion.html',
  styleUrl: './rotacion.scss',
})
export class Rotacion {
  private readonly api = inject(RotacionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly PESTANAS = PESTANAS;

  readonly vista = signal<VistaRotacion>('resumen');
  readonly productoId = signal<number | null>(null);
  // Filtros (de la dirección).
  readonly almacen = signal<number | null>(null);
  readonly hiloFiltro = signal<number | null>(null);
  readonly tienda = signal<number | null>(null);
  readonly anio = signal<number | 'promedio' | null>(null);

  readonly resumen = signal<ResumenRotacion | null>(null);
  readonly temporadas = signal<TemporadasRotacion | null>(null);
  readonly hilo = signal<HiloDetalle | null>(null);
  readonly quePedir = signal<QuePedirRotacion | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  // Ventanas.
  readonly comoSeCalcula = signal(false);
  readonly ajustes = signal(false);
  readonly anteriores = signal(false);

  readonly puedeCargarAnteriores = computed(() => this.auth.puede('hacer:cargar_ventas_anteriores'));
  readonly puedeCambiarTiempos = computed(() => this.auth.puede('hacer:ajustes_rotacion'));

  /** Cuántos hilos hay que pedir ya: la cápsula naranja «N ya» de la pestaña. */
  readonly numYa = computed(() => this.quePedir()?.totales.ya.hilos ?? 0);

  /** La pestaña Por hilo: "Se vende en paquete y en cono. Los paquetes que hay pesan 16.4 kg en promedio." */
  readonly subHilo = computed(() => {
    const h = this.hilo()?.hilo;
    if (!h) return '';
    const p = h.presentaciones;
    const como = p.length === 2 ? 'Se vende en paquete y en cono.' : p[0] === 'cono' ? 'Se vende en cono.' : p[0] === 'paquete' ? 'Se vende en paquete.' : '';
    const peso = h.hay.peso_paquete ? ` Los paquetes ${h.hay.paquetes ? 'que hay pesan' : 'pesan'} ${h.hay.peso_paquete.toLocaleString('es-MX')} kg en promedio.` : '';
    return (como + peso).trim();
  });

  constructor() {
    combineLatest([this.route.data, this.route.paramMap, this.route.queryParamMap])
      .pipe(takeUntilDestroyed())
      .subscribe(([data, params, q]) => {
        this.vista.set((data['vista'] as VistaRotacion) ?? 'resumen');
        this.productoId.set(params.get('productoId') ? Number(params.get('productoId')) : null);
        this.almacen.set(q.get('almacen') ? Number(q.get('almacen')) : null);
        this.hiloFiltro.set(q.get('hilo') ? Number(q.get('hilo')) : null);
        this.tienda.set(q.get('tienda') ? Number(q.get('tienda')) : null);
        const a = q.get('anio');
        this.anio.set(a === 'promedio' ? 'promedio' : a ? Number(a) : null);
        this.cargar();
      });
    // EN VIVO: con una venta o un cambio de inventario se recalcula, callada.
    inject(TiempoRealService)
      .cambios(['ventas', 'inventario', 'rotacion'], 3000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.cargar(true));
  }

  /** Pide lo de la pestaña (y lo de «Qué pedir», para la cápsula «N ya»). */
  cargar(callado = false): void {
    if (!callado) {
      this.cargando.set(true);
      this.error.set(null);
    }
    const listo = () => this.cargando.set(false);
    const fallo = (e: unknown) => {
      if (!callado) this.error.set(this.msg(e));
      listo();
    };
    const vista = this.vista();
    // «Qué pedir» siempre: es la cápsula de su pestaña.
    this.api.quePedir().subscribe({
      next: (q) => {
        this.quePedir.set(q);
        if (vista === 'que-pedir') listo();
      },
      error: (e) => { if (vista === 'que-pedir') fallo(e); },
    });
    if (vista === 'resumen') {
      this.api.resumen(this.almacen(), this.hiloFiltro()).subscribe({ next: (r) => { this.resumen.set(r); listo(); }, error: fallo });
    } else if (vista === 'temporadas') {
      this.api.temporadas(this.tienda(), this.anio()).subscribe({ next: (r) => { this.temporadas.set(r); listo(); }, error: fallo });
    } else if (vista === 'hilo') {
      const id = this.productoId();
      this.api.hilo(id).subscribe({
        next: (r) => {
          this.hilo.set(r);
          listo();
          // Sin id abrió el que más se vende: la dirección lo dice.
          if (!id) this.router.navigate(['/admin/rotacion/hilo', r.hilo.producto_id], { replaceUrl: true });
        },
        error: fallo,
      });
    }
  }

  /** Cambia un filtro (va a la dirección: se puede compartir el enlace). */
  filtrar(cambios: Record<string, string | number | null>): void {
    this.router.navigate([], { relativeTo: this.route, queryParams: cambios, queryParamsHandling: 'merge' });
  }

  otroHilo(id: number): void {
    this.router.navigate(['/admin/rotacion/hilo', id]);
  }

  /** Lo de la pestaña, en un CSV que abre Excel. */
  descargar(): void {
    const hoy = this.resumen()?.hoy ?? this.temporadas()?.hoy ?? this.hilo()?.hoy ?? this.quePedir()?.hoy ?? '';
    const vista = this.vista();
    let filas: unknown[][] = [];
    if (vista === 'resumen' && this.resumen()) {
      filas = [
        ['Hilo', 'Kilos vendidos en 12 meses', '% del total', 'Rotación (veces al año)', 'Se renueva cada (días)', 'Se mueve', 'Contra el año pasado (%)', 'Su temporada', 'Hay hoy (kg)'],
        ...this.resumen()!.ranking.map((h) => [
          h.hilo, h.vendido_12m, h.pct_del_total ?? '', h.rotacion?.veces ?? '', h.rotacion?.cada_dias ?? '', h.rotacion?.se_mueve ?? '',
          h.contra_anio_pasado == null ? '' : Math.round((h.contra_anio_pasado - 1) * 100), h.temporada ?? '', Math.round(h.hay.kg),
        ]),
      ];
    } else if (vista === 'temporadas' && this.temporadas()) {
      const t = this.temporadas()!;
      filas = [
        ['Hilo', ...MESES, 'Al año (kg)', 'Su temporada'],
        ...t.hilos.map((h) => [h.hilo, ...h.meses.map((m) => m.kg ?? ''), h.total, h.temporada ?? '']),
      ];
    } else if (vista === 'hilo' && this.hilo()) {
      const m = this.hilo()!.meses;
      filas = [
        ['Mes', `${m.anio_anterior} (kg)`, `${m.anio_actual} (kg)`, 'Nota'],
        ...m.actual.map((x, i) => [MESES[i], m.anterior[i].kg ?? '', x.kg ?? '',
          x.origen === 'en_curso' ? 'Va en curso' : x.origen === 'pronostico' ? 'Lo que se espera vender' : '']),
      ];
    } else if (vista === 'que-pedir' && this.quePedir()) {
      filas = [
        ['Hilo', 'Calibre', 'Material', 'Hay hoy (kg)', 'Se vende por semana (kg)', 'Le alcanza hasta', 'Pedir a más tardar', 'Kilos a pedir', 'Paquetes aprox.', 'Estado'],
        ...this.quePedir()!.hilos.map((h) => [
          h.color, h.calibre, h.material ?? '', Math.round(h.hay.kg), h.se_vende_semana ?? '', alcanzaHasta(h.se_acaba, hoy),
          h.pedir ? fechaLarga(h.pedir, hoy) : '', h.pedido?.kg ?? '', h.pedido?.paquetes ?? '', estadoTexto(h.estado, h.pedir).texto,
        ]),
      ];
    }
    if (filas.length) guardarArchivo(csv(filas), `rotacion-${vista}-${hoy}.csv`);
  }

  /** Se guardaron los ajustes: se recalcula todo. */
  ajustesGuardados(): void {
    this.ajustes.set(false);
    this.cargar(true);
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'No se pudo calcular. Intenta de nuevo.';
  }
}
