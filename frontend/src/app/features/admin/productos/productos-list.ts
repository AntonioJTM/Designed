import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { Categoria, Producto } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';
import { ProductoFormModal } from './producto-form-modal';

@Component({
  selector: 'app-productos-list',
  imports: [RouterLink, FormsModule, ProductoFormModal],
  templateUrl: './productos-list.html',
})
export class ProductosList {
  private readonly catalogo = inject(CatalogoService);
  private readonly router = inject(Router);

  readonly productos = signal<Producto[]>([]);
  readonly categorias = signal<Categoria[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  /**
   * Alta y edición viven en un modal sobre el listado: `null` = cerrado,
   * `'nuevo'` = alta, un id = edición de ese producto.
   */
  readonly modal = signal<number | 'nuevo' | null>(null);

  q = '';
  categoriaId: number | '' = '';

  constructor() {
    this.catalogo.listarCategorias().subscribe({
      next: (p) => this.categorias.set(p.items),
      error: () => {},
    });
    this.buscar();
  }

  buscar(): void {
    this.cargando.set(true);
    this.catalogo
      .listarProductos({
        q: this.q.trim() || undefined,
        categoria_id: this.categoriaId || undefined,
        limit: 50,
      })
      .subscribe({
        next: (p) => {
          this.productos.set(p.items);
          this.total.set(p.total);
          this.cargando.set(false);
        },
        error: (e) => {
          this.error.set((e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Error');
          this.cargando.set(false);
        },
      });
  }

  /** Id del producto que edita el modal (`null` cuando es un alta). */
  idModal(): number | null {
    const m = this.modal();
    return typeof m === 'number' ? m : null;
  }

  abrirNuevo(): void {
    this.mensaje.set(null);
    this.modal.set('nuevo');
  }

  abrirEdicion(p: Producto): void {
    this.mensaje.set(null);
    this.modal.set(p.id);
  }

  /** Guardó en el modal: el listado se recarga para reflejarlo. */
  alGuardar(p: Producto): void {
    this.mensaje.set(`Producto "${p.nombre}" guardado.`);
    this.buscar();
  }

  aPresentaciones(id: number): void {
    this.modal.set(null);
    this.router.navigate(['/admin/productos', id, 'presentaciones']);
  }

  eliminar(p: Producto): void {
    if (!confirm(`¿Eliminar el producto "${p.nombre}" y todas sus variantes?`)) return;
    this.catalogo.eliminarProducto(p.id).subscribe({
      next: () => this.buscar(),
      error: (e) =>
        this.error.set((e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Error'),
    });
  }
}
