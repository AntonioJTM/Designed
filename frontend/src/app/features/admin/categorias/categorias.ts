import { Component, inject, signal } from '@angular/core';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { Categoria } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';
import { MaterialFormModal } from './material-form-modal';

@Component({
  selector: 'app-categorias',
  imports: [MaterialFormModal],
  templateUrl: './categorias.html',
})
export class Categorias {
  private readonly catalogo = inject(CatalogoService);

  readonly categorias = signal<Categoria[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  /**
   * Alta y edición viven en un modal sobre el listado, igual que en productos:
   * `null` = cerrado, `'nuevo'` = alta, un material = edición de ese renglón.
   * Se guarda el objeto y no el id porque el listado ya trae todos sus datos y
   * así el modal abre sin pedir nada al servidor.
   */
  readonly modal = signal<Categoria | 'nuevo' | null>(null);

  constructor() {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.catalogo.listarCategorias().subscribe({
      next: (p) => {
        this.categorias.set(p.items);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  /** Material que edita el modal (`null` cuando es un alta). */
  materialModal(): Categoria | null {
    const m = this.modal();
    return m === 'nuevo' || m === null ? null : m;
  }

  abrirNuevo(): void {
    this.mensaje.set(null);
    this.modal.set('nuevo');
  }

  abrirEdicion(c: Categoria): void {
    this.mensaje.set(null);
    this.modal.set(c);
  }

  alGuardar(c: Categoria): void {
    this.mensaje.set(`Material "${c.nombre}" guardado.`);
    this.cargar();
  }

  eliminar(c: Categoria): void {
    if (!confirm(`¿Eliminar el material "${c.nombre}"?`)) return;
    this.mensaje.set(null);
    this.catalogo.eliminarCategoria(c.id).subscribe({
      next: () => this.cargar(),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
