import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { TipoCliente } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';

/**
 * Alta y edición de un tipo de cliente, en modal sobre el listado. No pide nada
 * al servidor: el renglón ya trae el tipo completo y entra por el input, así que
 * abre armado y sin velo.
 */
@Component({
  selector: 'app-tipo-cliente-form-modal',
  imports: [ReactiveFormsModule],
  templateUrl: './tipo-cliente-form-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class TipoClienteFormModal implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly catalogo = inject(CatalogoService);

  /** Tipo a editar; `null` = alta. */
  readonly tipo = input<TipoCliente | null>(null);

  readonly cerrado = output<void>();
  readonly guardado = output<TipoCliente>();

  readonly esEdicion = computed(() => this.tipo() !== null);
  /** El público es la lista base: su nombre se edita, pero no se desactiva. */
  readonly esPublico = computed(() => !!this.tipo()?.es_publico);

  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.minLength(1)]],
    orden: [0],
    activo: [true],
  });

  /**
   * El input se lee aquí y NO en el constructor: ahí las señales de input
   * todavía no están asignadas y el modal abriría en blanco.
   */
  ngOnInit(): void {
    const t = this.tipo();
    if (!t) return;
    this.form.reset({ nombre: t.nombre, orden: t.orden, activo: !!t.activo });
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.guardando.set(true);
    this.error.set(null);

    const v = this.form.getRawValue();
    const t = this.tipo();
    const obs = t
      ? this.catalogo.actualizarTipoCliente(t.id, {
          nombre: v.nombre.trim(),
          orden: v.orden,
          // El público no se puede desactivar: sin él no hay precio base.
          activo: this.esPublico() ? true : v.activo,
        })
      : this.catalogo.crearTipoCliente({
          nombre: v.nombre.trim(),
          orden: v.orden,
          activo: v.activo,
        });

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

  cerrar(): void {
    this.cerrado.emit();
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
