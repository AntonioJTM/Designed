import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { InventarioService } from '../../../core/services/inventario.service';
import { Almacen, StockItem, TipoMovimiento } from '../../../core/models/inventario.models';
import { Variante } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';

@Component({
  selector: 'app-inventario',
  imports: [FormsModule, RouterLink],
  templateUrl: './inventario.html',
})
export class Inventario {
  private readonly inv = inject(InventarioService);

  readonly almacenes = signal<Almacen[]>([]);
  readonly stock = signal<StockItem[]>([]);
  readonly totalAlertas = signal(0);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  // Filtros de la tabla de existencias
  filtroAlmacen: number | '' = '';
  filtroQ = '';
  soloBajo = false;

  // Selector de variante compartido por los formularios
  qVar = '';
  resultadosVar = signal<Variante[]>([]);
  varianteSel: number | '' = '';

  readonly tipos: TipoMovimiento[] = ['entrada', 'salida', 'ajuste', 'devolucion', 'merma'];

  // Formulario de movimiento
  mov = { tipo: 'entrada' as TipoMovimiento, almacen_id: '' as number | '', cantidad: null as number | null, costo_unitario: null as number | null, motivo: '' };

  // Formulario de transferencia
  transf = { origen: '' as number | '', destino: '' as number | '', cantidad: null as number | null, motivo: '' };

  readonly esAjuste = computed(() => this.mov.tipo === 'ajuste');

  constructor() {
    this.inv.almacenes().subscribe({
      next: (a) => {
        this.almacenes.set(a);
        if (a[0]) {
          this.mov.almacen_id = a[0].id;
          this.transf.origen = a[0].id;
          this.transf.destino = a[1]?.id ?? a[0].id;
        }
      },
      error: (e) => this.error.set(this.msg(e)),
    });
    this.cargarStock();
    this.cargarAlertas();
  }

  cargarStock(): void {
    this.cargando.set(true);
    this.inv
      .stock({
        almacen_id: this.filtroAlmacen || undefined,
        q: this.filtroQ.trim() || undefined,
        bajo_stock: this.soloBajo || undefined,
      })
      .subscribe({
        next: (p) => {
          this.stock.set(p.items);
          this.cargando.set(false);
        },
        error: (e) => {
          this.error.set(this.msg(e));
          this.cargando.set(false);
        },
      });
  }

  cargarAlertas(): void {
    this.inv.alertas().subscribe({
      next: (a) => this.totalAlertas.set(a.length),
      error: () => {},
    });
  }

  buscarVariantes(): void {
    const q = this.qVar.trim();
    if (!q) return;
    this.error.set(null);
    this.inv.buscarVariantes(q).subscribe({
      next: (v) => {
        this.resultadosVar.set(v);
        if (v.length === 1) {
          // Coincidencia única (típico al escanear un código): se autoselecciona.
          this.varianteSel = v[0].id;
          this.mensaje.set(`Variante: ${v[0].sku} · ${v[0].producto}`);
        } else if (v.length === 0) {
          this.mensaje.set(null);
          this.error.set('No se encontró ninguna variante con ese código.');
        }
      },
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  registrarMovimiento(): void {
    this.error.set(null);
    this.mensaje.set(null);
    if (!this.varianteSel || !this.mov.almacen_id || this.mov.cantidad == null) {
      this.error.set('Elige variante, almacén y cantidad.');
      return;
    }
    this.inv
      .registrarMovimiento({
        variante_id: Number(this.varianteSel),
        almacen_id: Number(this.mov.almacen_id),
        tipo: this.mov.tipo,
        cantidad: this.mov.cantidad,
        costo_unitario: this.mov.costo_unitario,
        motivo: this.mov.motivo.trim() || undefined,
      })
      .subscribe({
        next: (r) => {
          this.mensaje.set(`Movimiento registrado. Saldo: ${r.saldo_anterior} → ${r.saldo_nuevo}.`);
          this.mov.cantidad = null;
          this.mov.motivo = '';
          this.cargarStock();
          this.cargarAlertas();
        },
        error: (e) => this.error.set(this.msg(e)),
      });
  }

  transferir(): void {
    this.error.set(null);
    this.mensaje.set(null);
    if (!this.varianteSel || !this.transf.origen || !this.transf.destino || this.transf.cantidad == null) {
      this.error.set('Elige variante, almacenes origen/destino y cantidad.');
      return;
    }
    this.inv
      .transferir({
        variante_id: Number(this.varianteSel),
        almacen_origen_id: Number(this.transf.origen),
        almacen_destino_id: Number(this.transf.destino),
        cantidad: this.transf.cantidad,
        motivo: this.transf.motivo.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.mensaje.set('Transferencia realizada.');
          this.transf.cantidad = null;
          this.transf.motivo = '';
          this.cargarStock();
          this.cargarAlertas();
        },
        error: (e) => this.error.set(this.msg(e)),
      });
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
