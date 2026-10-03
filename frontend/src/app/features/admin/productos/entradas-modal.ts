import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InventarioService, Remesa } from '../../../core/services/inventario.service';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';
import { FolioPipe } from '../../../shared/folio.pipe';
import { guardarArchivo, mensajeDeError, nombreArchivo } from '../../../shared/descargar';

/**
 * Reporte de entradas de UN hilo, en PDF y cuando se necesite: todas sus cargas
 * (con periodo opcional) o el comprobante de una sola. Las entradas son las
 * Cargas de producto —la lista de empaque del proveedor—; un traspaso o un
 * desarme no son mercancía nueva.
 *
 * No se cierra al tocar el fondo; sale con la ✕, "Cerrar" o Escape (lo atiende
 * la pantalla de presentaciones, que es la que lo abre).
 */
@Component({
  selector: 'app-entradas-modal',
  imports: [FormsModule, CantidadPipe, FechaPipe, FolioPipe],
  templateUrl: './entradas-modal.html',
  styles: `
    .bloque { display: flex; flex-direction: column; gap: 12px; }
    .bloque + .bloque { margin-top: 22px; padding-top: 20px; border-top: 1px solid var(--borde-suave); }
    .bloque h3 { margin: 0; font-size: 15px; font-weight: 600; }
    .bloque > p { margin: 0; font-size: 13px; color: var(--tinta-3); }
    .periodo { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; }
    .periodo .field { flex: 1 1 160px; }
    .lista { max-height: 320px; overflow-y: auto; }
  `,
})
export class EntradasModal implements OnInit {
  private readonly inv = inject(InventarioService);

  readonly productoId = input.required<number>();
  /** "ROSA MEXICANO 2/30": para el nombre del archivo. */
  readonly hilo = input.required<string>();
  readonly cerrado = output<void>();

  readonly cargas = signal<Remesa[] | null>(null);
  readonly error = signal<string | null>(null);
  /** 'todo' o el id de la carga cuyo PDF se está generando. */
  readonly generando = signal<'todo' | number | null>(null);

  desde = '';
  hasta = '';

  /** El input se lee aquí y no en el constructor: ahí todavía no está puesto. */
  ngOnInit(): void {
    this.inv.remesas(100, this.productoId()).subscribe({
      next: (p) => this.cargas.set(p.items),
      error: () => this.cargas.set([]),
    });
  }

  pdfTodo(): void {
    if (this.desde && this.hasta && this.desde > this.hasta) {
      this.error.set('La fecha "Desde" va antes que "Hasta".');
      return;
    }
    this.error.set(null);
    this.generando.set('todo');
    this.inv.pdfEntradasProducto(this.productoId(), this.desde || undefined, this.hasta || undefined).subscribe({
      next: (blob) => {
        this.generando.set(null);
        guardarArchivo(blob, nombreArchivo(`Entradas ${this.hilo()}`) + '.pdf');
      },
      error: async (e) => {
        this.generando.set(null);
        this.error.set(await mensajeDeError(e));
      },
    });
  }

  pdfCarga(c: Remesa): void {
    this.error.set(null);
    this.generando.set(c.id);
    this.inv.pdfCarga(c.id).subscribe({
      next: (blob) => {
        this.generando.set(null);
        guardarArchivo(blob, `Carga ${c.folio}.pdf`);
      },
      error: async (e) => {
        this.generando.set(null);
        this.error.set(await mensajeDeError(e));
      },
    });
  }

  cerrar(): void {
    this.cerrado.emit();
  }
}
