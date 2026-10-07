import { Component, ElementRef, OnInit, afterNextRender, input, output, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CantidadPipe } from '../../../shared/cantidad.pipe';

/** Lo que se va a pesar: una presentación del hilo, con lo que hay en esta caja. */
export interface HiloAPesar {
  id: number;
  sku: string;
  producto: string;
  presentacion?: string | null;
  tipo?: string | null;
  precio: number;
  unidad?: string;
  aqui?: { cantidad: number; paquetes: number | null };
}

/**
 * PESAR antes de agregar (2026-10-06). "La gente solo dice 'vengo por 6 conos de
 * tal color': se pesan los conos y se calcula el precio con los precios por
 * kilo" (usuario). Antes "Agregar" metía 1 kg y había que corregirlo a mano;
 * ahora pregunta lo que marcó la báscula y, si son conos, cuántos eran.
 *
 * Se cobra y se descuenta en KILOS; los conos son solo para que la venta diga
 * "6 conos". El paquete COMPLETO no pasa por aquí: se escanea y se cobra lo que
 * pesa ese paquete.
 */
@Component({
  selector: 'app-pesar-modal',
  imports: [FormsModule, CantidadPipe],
  templateUrl: './pesar-modal.html',
  styleUrl: './pesar-modal.scss',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class PesarModal implements OnInit {
  readonly hilo = input.required<HiloAPesar>();

  readonly cerrado = output<void>();
  readonly agregado = output<{ kg: number; piezas?: number }>();

  private readonly campoPeso = viewChild<ElementRef<HTMLInputElement>>('peso');

  kg: number | null = null;
  piezas: number | null = null;
  esCono = false;

  constructor() {
    // Va directo a lo que marcó la báscula: se teclea el peso y Enter.
    afterNextRender(() => this.campoPeso()?.nativeElement.focus());
  }

  /** El input se lee aquí y no en el constructor: ahí todavía no está puesto. */
  ngOnInit(): void {
    this.esCono = this.hilo().tipo === 'cono';
  }

  /** Lo que hay de esta presentación en el almacén de la caja, si se sabe. */
  hay(): number | null {
    const a = this.hilo().aqui;
    return a ? Number(a.cantidad) : null;
  }

  /** ¿Pesó más de lo que hay? El servidor no lo va a dejar cobrar: se avisa antes. */
  noAlcanza(): boolean {
    const hay = this.hay();
    return hay !== null && (this.kg ?? 0) > hay + 0.0001;
  }

  puedeAgregar(): boolean {
    return (this.kg ?? 0) > 0;
  }

  agregar(): void {
    if (!this.puedeAgregar()) return;
    const kg = Math.round(Number(this.kg) * 1000) / 1000;
    const piezas = this.esCono && this.piezas && this.piezas > 0 ? Math.round(this.piezas) : undefined;
    this.agregado.emit({ kg, piezas });
  }

  cerrar(): void {
    this.cerrado.emit();
  }
}
