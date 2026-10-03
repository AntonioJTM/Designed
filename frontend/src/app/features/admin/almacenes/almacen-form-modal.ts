import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { InventarioService } from '../../../core/services/inventario.service';
import { Almacen, AlmacenInput } from '../../../core/models/inventario.models';
import { ApiError } from '../../../core/models/auth.models';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';

/**
 * Alta y edición de un almacén, en modal sobre las tarjetas. No pide nada al
 * servidor: la tarjeta ya trae el almacén completo y entra por el input, así que
 * abre armado y sin velo.
 *
 * Las dos marcas únicas (matriz y tienda en línea) se mueven desde aquí: al
 * encenderla en un almacén, el backend se la quita a los demás.
 */
@Component({
  selector: 'app-almacen-form-modal',
  imports: [ReactiveFormsModule],
  templateUrl: './almacen-form-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class AlmacenFormModal implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly confirmacion = inject(ConfirmacionService);
  private readonly inv = inject(InventarioService);

  /** Almacén a editar; `null` = alta. */
  readonly almacen = input<Almacen | null>(null);

  readonly cerrado = output<void>();
  readonly guardado = output<Almacen>();
  readonly eliminado = output<Almacen>();

  readonly esEdicion = computed(() => this.almacen() !== null);

  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.minLength(2)]],
    direccion: [''],
    es_punto_venta: [true],
    // TIENDA EN LÍNEA APAGADA (2026-10): la casilla "Surte la tienda en línea"
    // se quitó del formulario. Para regresarla, descomentar este control, su
    // casilla en la plantilla y la línea `es_tienda_linea` de `guardar()`.
    // es_tienda_linea: [false],
    es_matriz: [false],
    activo: [true],
  });

  /**
   * El input se lee aquí y NO en el constructor: ahí las señales de input
   * todavía no están asignadas y el modal abriría en blanco.
   */
  ngOnInit(): void {
    const a = this.almacen();
    if (!a) return;
    this.form.reset({
      nombre: a.nombre,
      direccion: a.direccion ?? '',
      es_punto_venta: !!a.es_punto_venta,
      // es_tienda_linea: !!a.es_tienda_linea,
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

    const v = this.form.getRawValue();
    // `es_tienda_linea` NO se manda: así el almacén que hoy la tenga la conserva
    // (el backend no deja quitarla sin designar otro, y ya no hay dónde).
    const body: AlmacenInput = {
      nombre: v.nombre.trim(),
      direccion: v.direccion.trim() || null,
      es_punto_venta: v.es_punto_venta,
      // es_tienda_linea: v.es_tienda_linea,
      es_matriz: v.es_matriz,
      activo: v.activo,
    };
    const a = this.almacen();
    const obs = a ? this.inv.actualizarAlmacen(a.id, body) : this.inv.crearAlmacen(body);

    obs.subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.guardado.emit(r);
        this.cerrar();
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.guardando.set(false);
      },
    });
  }

  /**
   * Solo se puede si no tiene nada colgando (existencias, kardex, cajas,
   * pedidos). El backend lo dice con un mensaje que ya explica qué hacer
   * —desactivarlo en vez de borrarlo— y se muestra tal cual.
   */
  async eliminar(): Promise<void> {
    const a = this.almacen();
    if (!a) return;
    const si = await this.confirmacion.pedir({
      titulo: `¿Eliminar el almacén «${a.nombre}»?`,
      mensaje: 'Solo se puede si no tiene existencias, movimientos, cajas ni pedidos. Si ya los tiene, desactívalo en vez de borrarlo.',
      aceptar: 'Eliminar',
      peligro: true,
    });
    if (!si) return;
    this.guardando.set(true);
    this.error.set(null);
    this.inv.eliminarAlmacen(a.id).subscribe({
      next: () => {
        this.guardando.set(false);
        this.eliminado.emit(a);
        this.cerrar();
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.guardando.set(false);
      },
    });
  }

  cerrar(): void {
    this.cerrado.emit();
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
