import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CatalogoService } from '../../core/services/catalogo.service';
import { CartService } from '../../core/services/cart.service';
import { ProductoDetalle, Variante } from '../../core/models/catalogo.models';
import { ApiError } from '../../core/models/auth.models';

@Component({
  selector: 'app-producto-detalle-tienda',
  imports: [RouterLink],
  templateUrl: './producto-detalle.html',
})
export class ProductoDetalleTienda {
  private readonly catalogo = inject(CatalogoService);
  private readonly route = inject(ActivatedRoute);
  readonly cart = inject(CartService);

  readonly producto = signal<ProductoDetalle | null>(null);
  readonly seleccion = signal<Variante | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly agregado = signal(false);

  constructor() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.catalogo.obtenerProducto(id).subscribe({
      next: (p) => {
        this.producto.set(p);
        // Preselecciona la primera variante activa.
        const activas = p.variantes.filter((v) => v.activo);
        this.seleccion.set(activas[0] ?? null);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set((e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Error');
        this.cargando.set(false);
      },
    });
  }

  precio(v: Variante): number {
    return Number(v.precio_oferta ?? v.precio);
  }

  imagenPrincipal(): string | null {
    const p = this.producto();
    if (!p) return null;
    const principal = p.imagenes.find((i) => i.es_principal) ?? p.imagenes[0];
    return principal?.url ?? null;
  }

  agregar(): void {
    const p = this.producto();
    const v = this.seleccion();
    if (!p || !v) return;
    this.cart.agregar({
      variante_id: v.id,
      producto: p.nombre,
      sku: v.sku,
      presentacion: v.presentacion,
      precio: this.precio(v),
      imagen: this.imagenPrincipal(),
    });
    this.agregado.set(true);
    setTimeout(() => this.agregado.set(false), 2500);
  }
}
