import { Injectable, computed, signal } from '@angular/core';

export interface CartItem {
  variante_id: number;
  producto: string;
  sku: string;
  presentacion?: string | null;
  precio: number;
  imagen?: string | null;
  cantidad: number;
}

const KEY = 'th_cart';

/**
 * Carrito de la tienda en línea. Estado local persistido en localStorage.
 * Es independiente del backend hasta el checkout.
 */
@Injectable({ providedIn: 'root' })
export class CartService {
  readonly items = signal<CartItem[]>(this.leer());

  readonly cantidadTotal = computed(() => this.items().reduce((s, i) => s + i.cantidad, 0));
  readonly subtotal = computed(() => this.items().reduce((s, i) => s + i.precio * i.cantidad, 0));

  agregar(item: Omit<CartItem, 'cantidad'>, cantidad = 1): void {
    this.items.update((arr) => {
      const existe = arr.find((i) => i.variante_id === item.variante_id);
      const next = existe
        ? arr.map((i) => (i.variante_id === item.variante_id ? { ...i, cantidad: i.cantidad + cantidad } : i))
        : [...arr, { ...item, cantidad }];
      return next;
    });
    this.guardar();
  }

  cambiarCantidad(variante_id: number, cantidad: number): void {
    if (cantidad <= 0) return this.quitar(variante_id);
    this.items.update((arr) => arr.map((i) => (i.variante_id === variante_id ? { ...i, cantidad } : i)));
    this.guardar();
  }

  quitar(variante_id: number): void {
    this.items.update((arr) => arr.filter((i) => i.variante_id !== variante_id));
    this.guardar();
  }

  vaciar(): void {
    this.items.set([]);
    this.guardar();
  }

  private leer(): CartItem[] {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '[]');
    } catch {
      return [];
    }
  }

  private guardar(): void {
    localStorage.setItem(KEY, JSON.stringify(this.items()));
  }
}
