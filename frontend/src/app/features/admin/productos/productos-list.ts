import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { Categoria, Producto } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';

@Component({
  selector: 'app-productos-list',
  imports: [RouterLink, FormsModule],
  templateUrl: './productos-list.html',
})
export class ProductosList {
  private readonly catalogo = inject(CatalogoService);

  readonly productos = signal<Producto[]>([]);
  readonly categorias = signal<Categoria[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

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

  eliminar(p: Producto): void {
    if (!confirm(`¿Eliminar el producto "${p.nombre}" y todas sus variantes?`)) return;
    this.catalogo.eliminarProducto(p.id).subscribe({
      next: () => this.buscar(),
      error: (e) =>
        this.error.set((e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Error'),
    });
  }
}
