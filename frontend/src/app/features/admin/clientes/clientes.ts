import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, Subject, Subscription, forkJoin, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, shareReplay, switchMap } from 'rxjs/operators';
import { ClientesService } from '../../../core/services/clientes.service';
import { RedisenoService } from '../../../core/services/rediseno.service';
import { Cliente, ClienteParaVenta } from '../../../core/models/clientes.models';
import {
  Cuando,
  Deuda,
  DeudorCartera,
  Frecuencia,
  Gasto,
  PeriodoClientes,
  QueCompra,
  VistaClientes,
} from '../../../core/models/rediseno.models';
import { ApiError } from '../../../core/models/auth.models';
import { ClienteFormModal } from './cliente-form-modal';
import { AbonoModal } from './abono-modal';
import { PERIODOS, esPeriodo, pesos, plural } from './clientes-ui';
import { VistaFrecuencia } from './vistas/vista-frecuencia';
import { VistaDeuda } from './vistas/vista-deuda';
import { VistaQueCompra } from './vistas/vista-que-compra';
import { VistaCuando } from './vistas/vista-cuando';
import { VistaGasto } from './vistas/vista-gasto';
import { CORTES_SIN_VENIR, CorteSinVenir, VistaDejaron } from './vistas/vista-dejaron';
import { ClientesEnfriados } from '../../../core/models/analisis.models';

/** Las pestañas, con su icono (trazos del diseño). */
const PESTANAS: { vista: VistaClientes; etiqueta: string; d: string }[] = [
  { vista: 'frecuencia', etiqueta: 'Frecuencia de compra', d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2' },
  // Los mismos del aviso de la campana "N clientes dejaron de venir" (2026-10-03).
  { vista: 'dejaron', etiqueta: 'Dejaron de venir', d: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20c.6-3.5 3.3-5.5 6.5-5.5 1.6 0 3 .5 4.1 1.3 M16 14l5 5 M21 14l-5 5' },
  { vista: 'deuda', etiqueta: 'Cuánto debe', d: 'M3 7h18v11H3z M3 11h18 M7 15h4' },
  { vista: 'que-compra', etiqueta: 'Qué compra', d: 'M7 3h10 M7 21h10 M8.5 3v18 M15.5 3v18 M8.5 8l7 3 M8.5 12l7 3 M8.5 16l7 3' },
  { vista: 'cuando', etiqueta: 'Cuándo compra', d: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4' },
  { vista: 'gasto', etiqueta: 'Cuánto gasta', d: 'M4 20V11 M10 20V5 M16 20v-6 M3 20h18' },
];

/**
 * CLIENTES (rediseño 2026-10). La sección que el usuario más pidió: "un nuevo
 * apartado que se llame clientes y que en los tabs diga frecuencia de compra,
 * cuánto debe, qué compra, cuándo compra, cuánto gasta".
 *
 * Cada pestaña es su propia ruta (`/admin/clientes/<vista>`, con `data.vista`),
 * así un enlace o la campana abren directo la que importa. El periodo viaja en
 * `?dias=` y las pestañas lo conservan al cambiar de una a otra.
 *
 * Reemplaza al listado viejo: la búsqueda vive en la cabecera (nombre, apodo o
 * teléfono, y lleva al expediente), "quién me debe más" es Cuánto debe, y
 * "quién compra más" y el directorio completo son Cuánto gasta.
 *
 * La pantalla es para MIRAR: el alta y el abono son modales.
 */
@Component({
  selector: 'app-clientes',
  imports: [
    FormsModule, RouterLink, ClienteFormModal, AbonoModal,
    VistaFrecuencia, VistaDejaron, VistaDeuda, VistaQueCompra, VistaCuando, VistaGasto,
  ],
  templateUrl: './clientes.html',
  styles: `
    .cabecera { display: flex; flex-direction: column; gap: 20px; }
    .cabecera > .page-head { margin-bottom: 0; }
    .busqueda { position: relative; flex: 0 1 300px; width: 300px; max-width: 100%; }
    .resultados {
      position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 20;
      margin: 0; padding: 6px; list-style: none; background: var(--superficie);
      border: 1px solid var(--borde); border-radius: 10px; box-shadow: 0 12px 30px rgba(18, 22, 31, 0.12);
      max-height: 360px; overflow-y: auto; min-width: 300px;
    }
    .resultados button {
      display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 8px 10px;
      border: 0; border-radius: 8px; background: none; font: inherit; text-align: left; cursor: pointer; color: var(--tinta);
    }
    .resultados button:hover, .resultados li.activo button { background: var(--acento-suave); }
    .resultados .avatar { width: 32px; height: 32px; font-size: 12px; }
    .resultados .quien { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .resultados .quien b { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .resultados .quien span { font-size: 12px; color: var(--tinta-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .resultados .nada { padding: 10px; font-size: 13px; color: var(--tinta-3); }
    .tabs-fila {
      display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between;
      gap: 12px; border-bottom: 1px solid #DDE1E7;
    }
    .tabs-fila .tabs { border-bottom: 0; }
    .periodo { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--tinta-3); padding-bottom: 8px; }
    .periodo select {
      min-height: 36px; padding: 0 10px; border: 1px solid var(--borde-campo); border-radius: 8px;
      background: #fff; font: inherit; font-size: 14px; color: var(--tinta);
    }
  `,
})
export class ClientesPantalla implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(RedisenoService);
  private readonly clientes = inject(ClientesService);

  readonly PESTANAS = PESTANAS;
  readonly PERIODOS = PERIODOS;

  readonly vista = signal<VistaClientes>('frecuencia');
  readonly dias = signal<PeriodoClientes>(90);

  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  readonly frecuencia = signal<Frecuencia | null>(null);
  readonly deuda = signal<Deuda | null>(null);
  readonly queCompra = signal<QueCompra | null>(null);
  readonly cuando = signal<Cuando | null>(null);
  readonly gasto = signal<Gasto | null>(null);
  readonly dejaron = signal<ClientesEnfriados | null>(null);
  /** El corte de "dejaron de venir"; 60 es el del aviso de la campana. Va en `?sin_venir=`. */
  readonly sinVenir = signal<CorteSinVenir>(60);

  /** Lo de la línea de abajo del título: cuántos son, cuántos compraron y cuántos deben. */
  private readonly cuenta = signal<{ activos: number; compraron: number; deben: number } | null>(null);

  /**
   * Cuánto debe no depende del periodo (el saldo es el de hoy), ni Dejaron de
   * venir, que lleva su propio corte de días sin venir.
   */
  readonly conPeriodo = computed(() => this.vista() !== 'deuda' && this.vista() !== 'dejaron');

  readonly resumen = computed(() => {
    const c = this.cuenta();
    if (!c) return 'Quién te compra, cada cuánto, qué se lleva y cuánto te debe.';
    const dias = this.dias();
    const compraron =
      dias >= 3650 ? 'te han comprado alguna vez'
      : dias === 365 ? 'compraron en el último año'
      : `compraron en los últimos ${dias} días`;
    return [
      plural(c.activos, 'cliente', 'clientes'),
      `${c.compraron} ${compraron}`,
      c.deben === 0 ? 'nadie te debe' : `${c.deben} te ${c.deben === 1 ? 'debe' : 'deben'}`,
    ].join(' · ');
  });

  // --- Modales ---
  readonly nuevoAbierto = signal(false);
  readonly abonando = signal<DeudorCartera | null>(null);

  // --- Búsqueda ---
  q = '';
  private readonly busca$ = new Subject<string>();
  readonly resultados = signal<ClienteParaVenta[] | null>(null);
  readonly buscando = signal(false);
  readonly activo = signal(0);

  private carga?: Subscription;

  ngOnInit(): void {
    this.vista.set((this.route.snapshot.data['vista'] as VistaClientes) ?? 'frecuencia');

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((q) => {
      const d = Number(q.get('dias'));
      this.dias.set(esPeriodo(d) ? d : 90);
      const sv = Number(q.get('sin_venir'));
      this.sinVenir.set((CORTES_SIN_VENIR as readonly number[]).includes(sv) ? (sv as CorteSinVenir) : 60);
      this.cargar();
    });

    // Se busca al teclear, con una pausa corta: cada tecla sería una consulta.
    this.busca$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => {
          // Menos de dos letras devuelve media tienda: el backend ni lo intenta.
          if (q.trim().length < 2) return of(null);
          this.buscando.set(true);
          return this.clientes.buscar(q.trim()).pipe(catchError(() => of([] as ClienteParaVenta[])));
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((r) => {
        this.buscando.set(false);
        this.resultados.set(r);
        this.activo.set(0);
      });
  }

  /**
   * Pide la pestaña y lo de la cabecera. La cabecera sale de Cuánto gasta
   * (todos los activos y quién compró) y Cuánto debe; cuando la pestaña es una
   * de esas dos, se reusa la MISMA respuesta en vez de pedirla dos veces.
   */
  cargar(): void {
    this.carga?.unsubscribe();
    const dias = this.dias();
    const vista = this.vista();
    this.cargando.set(true);
    this.error.set(null);

    const gasto$ = this.api.gasto(dias).pipe(shareReplay(1));
    const deuda$ = this.api.deuda(dias).pipe(shareReplay(1));
    // Solo se arma la de la pestaña que se ve.
    const pedidos: Record<VistaClientes, () => Observable<unknown>> = {
      frecuencia: () => this.api.frecuencia(dias),
      dejaron: () => this.api.dejaron(this.sinVenir()),
      deuda: () => deuda$,
      'que-compra': () => this.api.queCompra(dias),
      cuando: () => this.api.cuando(dias),
      gasto: () => gasto$,
    };

    this.carga = new Subscription();
    this.carga.add(
      pedidos[vista]().subscribe({
        next: (d) => {
          if (vista === 'frecuencia') this.frecuencia.set(d as Frecuencia);
          if (vista === 'dejaron') this.dejaron.set(d as ClientesEnfriados);
          if (vista === 'deuda') this.deuda.set(d as Deuda);
          if (vista === 'que-compra') this.queCompra.set(d as QueCompra);
          if (vista === 'cuando') this.cuando.set(d as Cuando);
          if (vista === 'gasto') this.gasto.set(d as Gasto);
          this.cargando.set(false);
        },
        error: (e) => {
          this.error.set(this.msg(e));
          this.cargando.set(false);
        },
      })
    );
    // Si la cabecera falla, la pestaña igual sirve: solo se queda el texto genérico.
    this.carga.add(
      forkJoin([gasto$.pipe(catchError(() => of(null))), deuda$.pipe(catchError(() => of(null)))]).subscribe(([g, d]) => {
        if (!g || !d) return;
        this.cuenta.set({
          activos: g.clientes.length,
          compraron: g.clientes.filter((c) => c.compras > 0).length,
          deben: d.num_clientes,
        });
      })
    );
  }

  cambiarPeriodo(dias: number): void {
    // El periodo va en la dirección: así se conserva al cambiar de pestaña y al
    // volver del expediente con el botón de atrás.
    this.router.navigate([], { relativeTo: this.route, queryParams: { dias }, queryParamsHandling: 'merge' });
  }

  /** El corte de "dejaron de venir" va en la dirección, como el periodo. */
  cambiarSinVenir(dias: CorteSinVenir): void {
    this.router.navigate([], { relativeTo: this.route, queryParams: { sin_venir: dias }, queryParamsHandling: 'merge' });
  }

  // ------------------------------------------------------------ búsqueda

  teclear(q: string): void {
    this.q = q;
    if (q.trim().length < 2) this.resultados.set(null);
    this.busca$.next(q);
  }

  teclaBusqueda(ev: KeyboardEvent): void {
    const r = this.resultados() ?? [];
    if (ev.key === 'ArrowDown' && r.length) {
      ev.preventDefault();
      this.activo.set((this.activo() + 1) % r.length);
    } else if (ev.key === 'ArrowUp' && r.length) {
      ev.preventDefault();
      this.activo.set((this.activo() - 1 + r.length) % r.length);
    } else if (ev.key === 'Enter' && r.length) {
      ev.preventDefault();
      this.irA(r[this.activo()] ?? r[0]);
    } else if (ev.key === 'Escape') {
      this.resultados.set(null);
    }
  }

  /** Al salir del buscador se cierra la lista; el clic en un resultado ya ocurrió (mousedown). */
  cerrarResultados(): void {
    setTimeout(() => this.resultados.set(null), 150);
  }

  irA(c: ClienteParaVenta): void {
    this.resultados.set(null);
    this.router.navigate(['/admin/clientes', c.id]);
  }

  saldo(c: ClienteParaVenta): number {
    return Number(c.saldo ?? 0);
  }

  /** Los DECIMAL llegan como texto. */
  num(v: unknown): number {
    return Number(v ?? 0);
  }

  pesos = pesos;

  // ------------------------------------------------------------ modales

  abrirNuevo(): void {
    this.mensaje.set(null);
    this.nuevoAbierto.set(true);
  }

  clienteGuardado(c: Cliente): void {
    this.mensaje.set(`Se guardó a ${c.nombre_comercial || c.nombre}.`);
    this.cargar();
  }

  irAExpediente(id: number): void {
    this.nuevoAbierto.set(false);
    this.router.navigate(['/admin/clientes', id]);
  }

  abonoRegistrado(r: { saldo_nuevo: number }): void {
    const c = this.abonando();
    this.mensaje.set(
      `Abono registrado${c ? ' a ' + c.nombre : ''}. ` +
        (r.saldo_nuevo > 0 ? `Le quedan ${pesos(r.saldo_nuevo)} por pagar.` : 'Quedó al día.')
    );
    this.cargar();
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'No se pudo cargar esta pestaña.';
  }
}
