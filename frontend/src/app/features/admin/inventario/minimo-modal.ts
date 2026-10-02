import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EquivalenciaPaquetes, InventarioService } from '../../../core/services/inventario.service';
import { StockItem } from '../../../core/models/inventario.models';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';

/**
 * STOCK MÍNIMO de una presentación en un almacén. Es lo que enciende la alerta
 * de la campana y "Por reabastecer": sin mínimo capturado no se avisa de nada
 * (`stock_minimo = 0` significa "no configurado"), y hasta ahora no había dónde
 * capturarlo, así que para los hilos reales la alerta nunca sonaba.
 *
 * El mínimo se guarda en KILOS, pero la tienda piensa en paquetes ("avísame
 * cuando queden 3"): para las presentaciones `paquete` se puede capturar en
 * paquetes y se traduce con el peso promedio REAL de los bultos que hay en ese
 * almacén, igual que en Ajuste / merma.
 *
 * El renglón entra por input, así que el modal abre armado. Solo la
 * equivalencia de paquetes se pide al servidor; mientras llega se usa el peso
 * nominal de la presentación, y el modal no cambia de tamaño.
 */
@Component({
  selector: 'app-minimo-modal',
  imports: [FormsModule, CantidadPipe],
  templateUrl: './minimo-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class MinimoModal implements OnInit {
  private readonly inv = inject(InventarioService);

  readonly fila = input.required<StockItem>();

  readonly cerrado = output<void>();
  /** Se guardó: el listado recarga existencias y alertas. */
  readonly guardado = output<void>();

  readonly error = signal<string | null>(null);
  readonly guardando = signal(false);
  readonly equivalencia = signal<EquivalenciaPaquetes | null>(null);

  unidad: 'kg' | 'paq' = 'kg';
  cantidad: number | null = null;

  /** El input se lee aquí, no en el constructor: ahí todavía no está puesto. */
  ngOnInit(): void {
    const f = this.fila();
    const actual = Number(f.stock_minimo);
    if (actual > 0) {
      // Se muestra el mínimo tal como está guardado, sin redondear a paquetes.
      this.cantidad = actual;
    } else if (this.esPaquete() && this.pesoRef()) {
      this.unidad = 'paq';
    }
    if (this.esPaquete()) {
      this.inv.equivalenciaPaquetes(f.variante_id, f.almacen_id).subscribe({
        next: (e) => this.equivalencia.set(e),
        error: () => this.equivalencia.set(null),
      });
    }
  }

  esPaquete(): boolean {
    return this.fila().tipo_presentacion === 'paquete';
  }

  minimoActual(): number {
    return Number(this.fila().stock_minimo);
  }

  /** Peso de un paquete: el promedio real de los bultos de aquí, o el nominal. */
  pesoRef(): number {
    const real = Number(this.equivalencia()?.peso_referencia ?? 0);
    return real || Number(this.fila().peso_kg ?? 0);
  }

  /** True mientras la traducción use el peso nominal y no el de los bultos. */
  pesoEsNominal(): boolean {
    const e = this.equivalencia();
    return !e || e.referencia_nominal;
  }

  /**
   * Los kilos que se van a guardar. Es un MÉTODO y no un `computed` porque los
   * campos son `ngModel` normales: un `computed` se quedaría con el primer valor.
   */
  kilos(): number | null {
    const n = this.cantidad;
    if (n == null || isNaN(Number(n)) || Number(n) < 0) return null;
    if (this.unidad === 'kg') return Math.round(Number(n) * 1000) / 1000;
    const peso = this.pesoRef();
    if (!peso) return null;
    return Math.round(Number(n) * peso * 1000) / 1000;
  }

  /** Cuántos paquetes son unos kilos. Vacío si no es paquete o no se sabe el peso. */
  enPaquetes(kg: number | null): number | null {
    const peso = this.pesoRef();
    if (kg == null || !this.esPaquete() || !peso) return null;
    return Math.round((kg / peso) * 100) / 100;
  }

  disponible(): number {
    return Number(this.fila().disponible);
  }

  /** Con lo que hay hoy, ¿ya quedaría bajo el mínimo? Se avisa antes de guardar. */
  quedaBajo(): boolean {
    const kg = this.kilos();
    return kg != null && kg > 0 && this.disponible() <= kg;
  }

  guardar(): void {
    const kg = this.kilos();
    if (kg == null) {
      this.error.set(
        this.unidad === 'paq' && !this.pesoRef()
          ? 'No se sabe cuánto pesa un paquete de este hilo: captura el mínimo en kilos.'
          : 'Escribe el mínimo.'
      );
      return;
    }
    this.enviar(kg);
  }

  /** Mínimo en cero = sin alerta. */
  quitar(): void {
    this.enviar(0);
  }

  private enviar(kg: number): void {
    const f = this.fila();
    this.error.set(null);
    this.guardando.set(true);
    this.inv
      .configurar({
        variante_id: f.variante_id,
        almacen_id: f.almacen_id,
        stock_minimo: kg,
        // El endpoint escribe los tres campos: se mandan los que ya tenía para
        // no borrarlos al cambiar solo el mínimo.
        stock_maximo: f.stock_maximo != null ? Number(f.stock_maximo) : null,
        ubicacion_fisica: f.ubicacion_fisica ?? undefined,
      })
      .subscribe({
        next: () => {
          this.guardando.set(false);
          this.guardado.emit();
          this.cerrar();
        },
        error: (e) => {
          this.guardando.set(false);
          this.error.set(this.msg(e));
        },
      });
  }

  cerrar(): void {
    this.cerrado.emit();
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
