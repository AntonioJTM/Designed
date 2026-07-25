import { Injectable, computed, signal } from '@angular/core';

export interface CartItem {
  variante_id: number;
  producto: string;
  sku: string;
  presentacion?: string | null;
  precio: number;
  imagen?: string | null;
  /** Unidad de peso en que se vende (kg, g, t). El precio es por esa unidad. */
  unidad?: string;
  /** Cantidad en la unidad de peso del producto; admite decimales (2.5 kg). */
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

  /** La venta es por peso: admite decimales, con 3 como en DECIMAL(12,3). */
  cambiarCantidad(variante_id: number, cantidad: number): void {
    const n = Number(cantidad);
    if (!Number.isFinite(n) || n <= 0) return this.quitar(variante_id);
    const redondeada = Math.round(n * 1000) / 1000;
    this.items.update((arr) =>
      arr.map((i) => (i.variante_id === variante_id ? { ...i, cantidad: redondeada } : i))
    );
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
