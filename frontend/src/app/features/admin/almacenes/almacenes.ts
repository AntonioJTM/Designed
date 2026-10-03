import { Component, computed, inject, signal } from '@angular/core';
import { InventarioService, ResumenAlmacenes } from '../../../core/services/inventario.service';
import { VentasService } from '../../../core/services/ventas.service';
import { Almacen } from '../../../core/models/inventario.models';
import { Caja } from '../../../core/models/ventas.models';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { AlmacenFormModal } from './almacen-form-modal';

/** Lo que dice la tarjeta de un almacén. */
interface TarjetaAlmacen {
  almacen: Almacen;
  /** Kilos en existencia; `null` si el panorama no llegó (o el almacén está inactivo). */
  kilos: number | null;
  /** Hilos distintos (por `producto_id`) con existencia; `null` si no se pudo contar. */
  hilos: number | null;
  /** Presentaciones con existencia: respaldo cuando no se pueden contar los hilos. */
  presentaciones: number | null;
  cajas: Caja[];
}

/**
 * Almacenes: las bodegas y las sucursales (rediseño 2026-10). Para el sistema
 * son lo mismo —un lugar que guarda existencias—; una sucursal es un almacén con
 * mostrador (`es_punto_venta`) y su caja. Cada uno lleva su propio inventario:
 * las cajas descuentan del suyo y la matriz (`es_matriz`) surte a las demás.
 *
 * Una tarjeta por almacén con cuánto tiene y qué cajas cuelgan de él, que es lo
 * que se pregunta al abrir una sucursal nueva. El alta y la edición son un modal.
 *
 * TIENDA EN LÍNEA APAGADA (2026-10): la marca `es_tienda_linea` ya no se muestra
 * ni se ofrece aquí (ver la plantilla y el modal). El backend la sigue cuidando:
 * el almacén que la tenga la conserva, porque el formulario ya no la manda.
 */
@Component({
  selector: 'app-almacenes',
  imports: [CantidadPipe, AlmacenFormModal],
  templateUrl: './almacenes.html',
  styles: `
    .tarjetas { display: flex; flex-wrap: wrap; gap: 20px; }
    /* margin-bottom 0: la .card global trae margen fuera de .pagina/.fila y aquí duplicaba el gap. */
    .tarjeta { flex: 1 1 320px; min-width: 0; display: flex; flex-direction: column; gap: 14px; margin-bottom: 0; }
    .tarjeta.inactiva { background: var(--superficie-2); }
    .tarjeta-cabeza { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
    .tarjeta-cabeza > div { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .tarjeta-cabeza h2 { margin: 0; font-size: 17px; font-weight: 600; }
    .direccion { font-size: 13px; color: var(--tinta-3); }
    .etiquetas { display: flex; flex-wrap: wrap; gap: 6px; }
    .cifra { display: flex; align-items: baseline; flex-wrap: wrap; gap: 10px; }
    .cifra b { font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .cifra span { font-size: 13px; color: var(--tinta-3); }
    .cajas { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--borde-suave); padding-top: 12px; }
    .cajas > span:first-child { font-size: 13px; color: var(--tinta-3); }
    .cajas > span { font-size: 14px; }
  `,
})
export class Almacenes {
  private readonly inv = inject(InventarioService);
  private readonly ventas = inject(VentasService);

  readonly almacenes = signal<Almacen[]>([]);
  readonly resumen = signal<ResumenAlmacenes | null>(null);
  readonly cajas = signal<Caja[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  /** `null` = cerrado, `'nuevo'` = alta, un almacén = edición de esa tarjeta. */
  readonly modal = signal<Almacen | 'nuevo' | null>(null);

  /** Matriz: la que surte a las demás sucursales. */
  readonly matriz = computed(() => this.almacenes().find((a) => a.es_matriz) ?? null);

  /*
   * TIENDA EN LÍNEA APAGADA (2026-10). Avisaba qué almacén surte la tienda en
   * línea y alertaba si ninguno. Para regresarlo, descomentar esto y su bloque
   * en la plantilla.
   *
   * readonly surteTienda = computed(() => this.almacenes().find((a) => a.es_tienda_linea) ?? null);
   */

  /**
   * Una tarjeta por almacén: la matriz primero (es de donde sale todo), luego
   * los activos y al final los dados de baja, que se conservan por su historial.
   */
  readonly tarjetas = computed<TarjetaAlmacen[]>(() => {
    const r = this.resumen();
    const cajas = this.cajas();
    const orden = (a: Almacen) => (a.es_matriz ? 0 : a.activo ? 1 : 2);
    return [...this.almacenes()]
      .sort((a, b) => orden(a) - orden(b) || a.nombre.localeCompare(b.nombre))
      .map((a) => {
        const tot = r?.almacenes.find((x) => x.almacen_id === a.id) ?? null;
        return {
          almacen: a,
          kilos: tot ? Number(tot.kilos) : null,
          hilos: tot && r && !r.truncado ? this.hilosEn(r, a.id) : null,
          presentaciones: tot ? Number(tot.skus) : null,
          cajas: cajas.filter((c) => c.almacen_id === a.id),
        };
      });
  });

  constructor() {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.inv.almacenes().subscribe({
      next: (a) => {
        this.almacenes.set(a);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
    // Cuánto tiene cada uno. Si no llega, la tarjeta se dibuja igual, sin la cifra.
    this.inv.resumen().subscribe({ next: (r) => this.resumen.set(r), error: () => {} });
    // Se muestran junto a su almacén para que se vea qué caja descuenta de dónde.
    this.ventas.cajas().subscribe({ next: (c) => this.cajas.set(c), error: () => {} });
  }

  /**
   * Hilos distintos con existencia en el almacén. Se cuentan por `producto_id`
   * y no por renglón: el paquete y el cono del mismo hilo son UN hilo, y el
   * mismo color en dos calibres son dos.
   */
  private hilosEn(r: ResumenAlmacenes, almacenId: number): number {
    const ids = new Set<number | string>();
    for (const f of r.filas) {
      const e = f.existencias[String(almacenId)];
      if (e && Number(e.cantidad) > 0) ids.add(f.producto_id ?? `v${f.variante_id}`);
    }
    return ids.size;
  }

  /** "Caja Cuautepec · abierta": con el turno se sabe si hoy está vendiendo. */
  estadoCaja(c: Caja): string {
    if (!c.activo) return 'dada de baja';
    return c.turno_id ? 'abierta' : 'cerrada';
  }

  /** Almacén que edita el modal (`null` cuando es un alta). */
  almacenModal(): Almacen | null {
    const m = this.modal();
    return m === 'nuevo' || m === null ? null : m;
  }

  abrirNuevo(): void {
    this.mensaje.set(null);
    this.error.set(null);
    this.modal.set('nuevo');
  }

  abrirEdicion(a: Almacen): void {
    this.mensaje.set(null);
    this.error.set(null);
    this.modal.set(a);
  }

  guardado(a: Almacen, eraAlta: boolean): void {
    this.mensaje.set(eraAlta ? `Almacén "${a.nombre}" dado de alta.` : `Almacén "${a.nombre}" actualizado.`);
    this.cargar();
  }

  eliminado(a: Almacen): void {
    this.mensaje.set(`Almacén "${a.nombre}" eliminado.`);
    this.cargar();
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
