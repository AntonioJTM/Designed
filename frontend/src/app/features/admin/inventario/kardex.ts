import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { InventarioService } from '../../../core/services/inventario.service';
import { Almacen, Movimiento, TraspasoDetalle } from '../../../core/models/inventario.models';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';

@Component({
  selector: 'app-kardex',
  imports: [FormsModule, RouterLink, CantidadPipe, FechaPipe],
  templateUrl: './kardex.html',
})
export class Kardex {
  private readonly inv = inject(InventarioService);

  readonly almacenes = signal<Almacen[]>([]);
  readonly movimientos = signal<Movimiento[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  /** Movimiento cuyo documento se está viendo, y su contenido. */
  readonly abierto = signal<number | null>(null);
  readonly traspaso = signal<TraspasoDetalle | null>(null);

  filtroAlmacen: number | '' = '';
  filtroConcepto = '';

  /** Agrupaciones del kardex en lenguaje de tienda. */
  readonly conceptos = [
    { valor: '', etiqueta: 'Todos los movimientos' },
    { valor: 'ventas', etiqueta: 'Ventas' },
    { valor: 'traspasos', etiqueta: 'Traspasos entre almacenes' },
    { valor: 'desarmes', etiqueta: 'Desarmes de paquete' },
    { valor: 'entradas', etiqueta: 'Entradas de mercancía' },
    { valor: 'ajustes', etiqueta: 'Ajustes de inventario' },
    { valor: 'mermas', etiqueta: 'Mermas' },
  ];

  constructor() {
    this.inv.almacenes().subscribe({ next: (a) => this.almacenes.set(a), error: () => {} });
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.abierto.set(null);
    this.inv
      .movimientos(this.filtroAlmacen || undefined, undefined, this.filtroConcepto || undefined)
      .subscribe({
        next: (p) => {
          this.movimientos.set(p.items);
          this.total.set(p.total);
          this.cargando.set(false);
        },
        error: (e) => {
          this.error.set((e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Error');
          this.cargando.set(false);
        },
      });
  }

  /** Abre el traspaso que originó el movimiento para ver qué se mandó. */
  verDetalle(m: Movimiento): void {
    if (this.abierto() === m.id) {
      this.abierto.set(null);
      return;
    }
    this.abierto.set(m.id);
    this.traspaso.set(null);
    if (m.detalle_tipo === 'traspaso' && m.detalle_id) {
      this.inv.traspaso(m.detalle_id).subscribe({
        next: (t) => this.traspaso.set(t),
        error: (e) =>
          this.error.set(
            (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Error'
          ),
      });
    }
  }

  /** Solo los traspasos tienen contenido que valga la pena desplegar. */
  tieneDetalle(m: Movimiento): boolean {
    return m.detalle_tipo === 'traspaso';
  }

  /** Cuántos paquetes representan esos kilos, como los cuenta la tienda. */
  paquetesDe(m: Movimiento): string {
    const peso = Number(m.peso_kg ?? 0);
    if (!peso) return '';
    return String(Math.round((Math.abs(Number(m.cantidad)) / peso) * 100) / 100);
  }

  esEntrada(m: Movimiento): boolean {
    return Number(m.cantidad) >= 0;
  }
}
