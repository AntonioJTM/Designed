import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { Categoria } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';

/**
 * Alta y edición del material EN UN MODAL, igual que el producto. Antes el
 * formulario vivía siempre abierto arriba del listado y "Editar" lo llenaba sin
 * moverse de sitio: no quedaba claro que se estaba editando y el listado se iba
 * hacia abajo.
 *
 * A diferencia del modal de producto, aquí NO se pide nada al servidor: el
 * renglón del listado ya trae el material completo y entra por el input, así que
 * abre armado y no hace falta velo de carga.
 */
@Component({
  selector: 'app-material-form-modal',
  imports: [ReactiveFormsModule],
  templateUrl: './material-form-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class MaterialFormModal implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly catalogo = inject(CatalogoService);

  /** Material a editar; `null` = alta. */
  readonly material = input<Categoria | null>(null);

  readonly cerrado = output<void>();
  /** Se guardó: el listado se recarga. */
  readonly guardado = output<Categoria>();
  /** Se eliminó (lleva el nombre, para que el listado lo diga). */
  readonly eliminado = output<string>();

  readonly esEdicion = computed(() => this.material() !== null);

  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  /**
   * Pidió eliminar y el modal pregunta antes. Vive aquí y no en el renglón del
   * listado, igual que en productos: junto a "Editar" estaba a un clic distraído.
   */
  readonly confirmandoBorrado = signal(false);

  readonly form = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.minLength(1)]],
    descripcion: [''],
    calibres: [''],
    activo: [true],
  });

  /**
   * El input se lee aquí y NO en el constructor: los inputs de señal todavía no
   * están asignados cuando corre el constructor (ya pasó con el modal del
   * producto, que abría la edición en blanco).
   */
  ngOnInit(): void {
    const m = this.material();
    if (!m) return;
    this.form.reset({
      nombre: m.nombre,
      descripcion: m.descripcion ?? '',
      calibres: m.calibres ?? '',
      activo: !!m.activo,
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
    const body: Partial<Categoria> = {
      nombre: v.nombre,
      descripcion: v.descripcion.trim() || undefined,
      calibres: v.calibres.trim() || null,
      activo: v.activo,
    };

    const m = this.material();
    const obs = m
      ? this.catalogo.actualizarCategoria(m.id, body)
      : this.catalogo.crearCategoria(body);

    obs.subscribe({
      next: (c) => {
        this.guardando.set(false);
        this.guardado.emit(c);
        this.cerrar();
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.guardando.set(false);
      },
    });
  }

  /**
   * El servidor no deja borrar un material que todavía tiene productos (409
   * `CATEGORIA_EN_USO`) y su mensaje dice cuántos: se muestra tal cual.
   */
  eliminar(): void {
    const m = this.material();
    if (!m) return;
    this.guardando.set(true);
    this.error.set(null);
    this.catalogo.eliminarCategoria(m.id).subscribe({
      next: () => {
        this.guardando.set(false);
        this.eliminado.emit(m.nombre);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.guardando.set(false);
        this.confirmandoBorrado.set(false);
      },
    });
  }

  cerrar(): void {
    this.cerrado.emit();
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
