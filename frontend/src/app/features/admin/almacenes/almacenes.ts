import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { InventarioService } from '../../../core/services/inventario.service';
import { VentasService } from '../../../core/services/ventas.service';
import { Almacen } from '../../../core/models/inventario.models';
import { Caja } from '../../../core/models/ventas.models';
import { ApiError } from '../../../core/models/auth.models';

/**
 * Administración de almacenes (sucursales y bodegas). Cada almacén lleva su
 * propio inventario: las cajas descuentan del suyo y la tienda en línea del
 * que esté marcado como `es_tienda_linea`.
 */
@Component({
  selector: 'app-almacenes',
  imports: [ReactiveFormsModule],
  templateUrl: './almacenes.html',
})
export class Almacenes {
  private readonly fb = inject(FormBuilder);
  private readonly inv = inject(InventarioService);
  private readonly ventas = inject(VentasService);

  readonly almacenes = signal<Almacen[]>([]);
  readonly cajas = signal<Caja[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  readonly editandoId = signal<number | null>(null);

  /** Almacén que hoy surte la tienda en línea, para avisarlo en la pantalla. */
  readonly surteTienda = computed(() => this.almacenes().find((a) => a.es_tienda_linea) ?? null);

  /** Matriz: la que surte a las demás sucursales. */
  readonly matriz = computed(() => this.almacenes().find((a) => a.es_matriz) ?? null);

  readonly form = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.minLength(2)]],
    direccion: [''],
    es_punto_venta: [true],
    es_tienda_linea: [false],
    es_matriz: [false],
    activo: [true],
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
    // Se muestran junto a su almacén para que se vea qué caja descuenta de dónde.
    this.ventas.cajas().subscribe({ next: (c) => this.cajas.set(c), error: () => {} });
  }

  /** Cajas asignadas a un almacén. */
  cajasDe(almacenId: number): Caja[] {
    return this.cajas().filter((c) => c.almacen_id === almacenId);
  }

  nuevo(): void {
    this.editandoId.set(null);
    this.mensaje.set(null);
    this.form.reset({
      nombre: '',
      direccion: '',
      es_punto_venta: true,
      es_tienda_linea: false,
      es_matriz: false,
      activo: true,
    });
  }

  editar(a: Almacen): void {
    this.editandoId.set(a.id);
    this.mensaje.set(null);
    this.form.reset({
      nombre: a.nombre,
      direccion: a.direccion ?? '',
      es_punto_venta: !!a.es_punto_venta,
      es_tienda_linea: !!a.es_tienda_linea,
      es_matriz: !!a.es_matriz,
      activo: !!a.activo,
    });
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    this.mensaje.set(null);

    const v = this.form.getRawValue();
    const body = {
      nombre: v.nombre.trim(),
      direccion: v.direccion.trim() || null,
      es_punto_venta: v.es_punto_venta,
      es_tienda_linea: v.es_tienda_linea,
      es_matriz: v.es_matriz,
      activo: v.activo,
    };
    const id = this.editandoId();
    const obs = id ? this.inv.actualizarAlmacen(id, body) : this.inv.crearAlmacen(body);

    obs.subscribe({
      next: (a) => {
        this.guardando.set(false);
        this.mensaje.set(
          id ? `Almacén "${a.nombre}" actualizado.` : `Almacén "${a.nombre}" dado de alta.`
        );
        this.nuevo();
        this.cargar();
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.guardando.set(false);
      },
    });
  }

  eliminar(a: Almacen): void {
    if (!confirm(`¿Eliminar el almacén "${a.nombre}"?`)) return;
    this.error.set(null);
    this.inv.eliminarAlmacen(a.id).subscribe({
      next: () => {
        this.mensaje.set(`Almacén "${a.nombre}" eliminado.`);
        this.cargar();
      },
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  /** Atajo para mover la marca de tienda en línea sin abrir el formulario. */
  marcarTiendaLinea(a: Almacen): void {
    if (a.es_tienda_linea) return;
    this.error.set(null);
    this.inv.actualizarAlmacen(a.id, { es_tienda_linea: true }).subscribe({
      next: () => {
        this.mensaje.set(`La tienda en línea ahora surte de "${a.nombre}".`);
        this.cargar();
      },
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  /** Atajo para mover la matriz sin abrir el formulario. */
  marcarMatriz(a: Almacen): void {
    if (a.es_matriz) return;
    this.error.set(null);
    this.inv.actualizarAlmacen(a.id, { es_matriz: true }).subscribe({
      next: () => {
        this.mensaje.set(`"${a.nombre}" es ahora la matriz que surte a las sucursales.`);
        this.cargar();
      },
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
