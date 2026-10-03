import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { TipoCliente } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';
import type { ListaPrecio } from './tipos-cliente';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';

/**
 * Alta, edición y baja de un tipo de cliente, en modal sobre el listado. No pide
 * nada al servidor: el renglón ya trae el tipo completo y entra por el input,
 * así que abre armado y sin velo.
 *
 * Eliminar vive aquí y no en el renglón (rediseño 2026-10): la tabla es para
 * mirar, y borrar una lista es una decisión que se toma viendo cuánto se usa.
 */
@Component({
  selector: 'app-tipo-cliente-form-modal',
  imports: [ReactiveFormsModule],
  templateUrl: './tipo-cliente-form-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class TipoClienteFormModal implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly confirmacion = inject(ConfirmacionService);
  private readonly catalogo = inject(CatalogoService);

  /** Tipo a editar; `null` = alta. */
  readonly tipo = input<ListaPrecio | null>(null);

  readonly cerrado = output<void>();
  readonly guardado = output<TipoCliente>();
  readonly eliminado = output<TipoCliente>();

  readonly esEdicion = computed(() => this.tipo() !== null);
  /** El público es la lista base: su nombre se edita, pero no se desactiva ni se borra. */
  readonly esPublico = computed(() => !!this.tipo()?.es_publico);

  /** Cuánto se usa, para decidir antes de apagarla o borrarla (`null` si no se sabe). */
  readonly uso = computed(() => {
    const t = this.tipo();
    if (!t || t.es_publico || t.num_clientes === undefined || t.num_precios === undefined) return null;
    return { clientes: Number(t.num_clientes), precios: Number(t.num_precios) };
  });

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

  /**
   * El público no se ofrece (es la lista base). El backend también rechaza
   * borrar una lista con precios capturados o con pedidos vendidos con ella,
   * con un mensaje que ya explica qué hacer —apagarla en vez de borrarla—: se
   * muestra tal cual.
   */
  async eliminar(): Promise<void> {
    const t = this.tipo();
    if (!t || this.esPublico()) return;
    const si = await this.confirmacion.pedir({
      titulo: `¿Eliminar la lista «${t.nombre}»?`,
      mensaje: 'Solo se puede si no tiene precios capturados ni ventas. Si ya los tiene, apágala en vez de borrarla.',
      aceptar: 'Eliminar',
      peligro: true,
    });
    if (!si) return;
    this.guardando.set(true);
    this.error.set(null);
    this.catalogo.eliminarTipoCliente(t.id).subscribe({
      next: () => {
        this.guardando.set(false);
        this.eliminado.emit(t);
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
