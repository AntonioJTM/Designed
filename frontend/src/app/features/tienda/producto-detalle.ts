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
        // Preselecciona la primera variante activa CON existencias; si todas
        // están agotadas, cae a la primera activa para que igual se vea.
        const activas = p.variantes.filter((v) => v.activo);
        this.seleccion.set(activas.find((v) => this.disponible(v) > 0) ?? activas[0] ?? null);
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

  /** Existencias vendibles en línea de la variante. */
  disponible(v: Variante): number {
    return Number(v.disponible ?? 0);
  }

  /** Unidades de esa variante que el cliente ya lleva en el carrito. */
  enCarrito(v: Variante): number {
    return this.cart.items().find((i) => i.variante_id === v.id)?.cantidad ?? 0;
  }

  /** Lo que todavía puede agregar sin pasarse de las existencias. */
  restante(v: Variante): number {
    return Math.max(0, this.disponible(v) - this.enCarrito(v));
  }

  /** Motivo por el que no se puede agregar, o null si sí se puede. */
  bloqueo(): string | null {
    const v = this.seleccion();
    if (!v) return 'Elige una presentación.';
    if (this.disponible(v) <= 0) return 'Esta presentación no tiene existencias.';
    if (this.restante(v) <= 0) {
      return `Ya tienes en el carrito las ${this.disponible(v)} unidades disponibles.`;
    }
    return null;
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
    if (!p || !v || this.bloqueo()) return;
    this.cart.agregar({
      variante_id: v.id,
      producto: p.nombre,
      sku: v.sku,
      presentacion: v.presentacion,
      precio: this.precio(v),
      unidad: p.unidad,
      imagen: this.imagenPrincipal(),
    });
    this.agregado.set(true);
    setTimeout(() => this.agregado.set(false), 2500);
  }
}
