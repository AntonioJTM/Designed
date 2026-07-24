import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { InventarioService } from '../../../core/services/inventario.service';
import { Almacen, Movimiento } from '../../../core/models/inventario.models';
import { ApiError } from '../../../core/models/auth.models';

@Component({
  selector: 'app-kardex',
  imports: [FormsModule, RouterLink],
  templateUrl: './kardex.html',
})
export class Kardex {
  private readonly inv = inject(InventarioService);

  readonly almacenes = signal<Almacen[]>([]);
  readonly movimientos = signal<Movimiento[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  filtroAlmacen: number | '' = '';

  constructor() {
    this.inv.almacenes().subscribe({ next: (a) => this.almacenes.set(a), error: () => {} });
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.inv.movimientos(this.filtroAlmacen || undefined).subscribe({
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
}
