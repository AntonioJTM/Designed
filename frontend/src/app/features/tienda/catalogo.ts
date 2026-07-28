import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CatalogoService } from '../../core/services/catalogo.service';
import { Categoria, Producto } from '../../core/models/catalogo.models';
import { ApiError } from '../../core/models/auth.models';

@Component({
  selector: 'app-catalogo',
  imports: [FormsModule, RouterLink],
  templateUrl: './catalogo.html',
})
export class Catalogo {
  private readonly catalogo = inject(CatalogoService);

  readonly productos = signal<Producto[]>([]);
  readonly categorias = signal<Categoria[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  q = '';
  categoriaId: number | '' = '';

  /** Un producto está agotado si ninguna de sus variantes tiene existencias. */
  agotado(p: Producto): boolean {
    return Number(p.disponible ?? 0) <= 0;
  }

  constructor() {
    this.catalogo.listarCategorias().subscribe({
      next: (p) => this.categorias.set(p.items.filter((c) => c.activo)),
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
        activo: true,
        limit: 60,
      })
      .subscribe({
        next: (p) => {
          this.productos.set(p.items);
          this.cargando.set(false);
        },
        error: (e) => {
          this.error.set((e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Error');
          this.cargando.set(false);
        },
      });
  }
}
