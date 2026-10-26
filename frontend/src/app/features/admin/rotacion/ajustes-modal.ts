import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RotacionService } from '../../../core/services/rotacion.service';
import { AjustesRotacion } from '../../../core/models/rotacion.models';
import { ApiError } from '../../../core/models/auth.models';

/**
 * LOS TIEMPOS DE «QUÉ PEDIR»: cuánto tarda el proveedor, el colchón, para cuánto
 * alcanza cada pedido y (si se usa) cuántos kilos caben en un contenedor. Viven
 * en Configuración (claves `rotacion_*`); al guardarlos dejan de estar «Por
 * confirmar» y todo se recalcula con ellos.
 */
@Component({
  selector: 'app-ajustes-rotacion-modal',
  imports: [FormsModule],
  host: { '(document:keydown.escape)': 'cerrado.emit()' },
  template: `
    <!-- No se cierra al hacer clic en el fondo; sale con la ✕, "Cancelar" o Escape. -->
    <div class="modal-overlay">
      <div class="modal angosto" role="dialog" aria-modal="true" aria-labelledby="titulo-ajustes-rot">
        <div class="modal-head">
          <h2 id="titulo-ajustes-rot">Los tiempos para pedir</h2>
          <button type="button" class="modal-cerrar" (click)="cerrado.emit()" aria-label="Cerrar">✕</button>
        </div>
        <form (ngSubmit)="guardar()">
          <div class="modal-body columna">
            <p class="muted">
              Con esto se calcula cuándo pedir cada hilo y cuánto. Al guardarlos se recalcula todo.
              @if (!ajustes().confirmados) { Los de ahora son los de fábrica: <b class="tinta">confírmalos con lo que de verdad tarda tu proveedor</b>. }
            </p>
            @if (error()) { <p class="alert" role="alert">{{ error() }}</p> }
            <div class="form-grid">
              <label class="field">
                El proveedor tarda
                <span class="con-unidad">
                  <input type="number" min="1" max="52" step="1" name="proveedor" [(ngModel)]="proveedor" required
                         [attr.aria-invalid]="!valido('proveedor')" [class.invalido]="!valido('proveedor')" />
                  <span>semanas</span>
                </span>
                <span class="ayuda">Desde que se le pide hasta que llega al almacén.</span>
              </label>
              <label class="field">
                Colchón
                <span class="con-unidad">
                  <input type="number" min="0" max="12" step="1" name="colchon" [(ngModel)]="colchon" required
                         [attr.aria-invalid]="!valido('colchon')" [class.invalido]="!valido('colchon')" />
                  <span>semanas de venta</span>
                </span>
                <span class="ayuda">Por si el proveedor se atrasa o se vende más de lo esperado.</span>
              </label>
              <label class="field">
                Cada pedido alcanza para
                <span class="con-unidad">
                  <input type="number" min="1" max="12" step="1" name="cubre" [(ngModel)]="cubre" required
                         [attr.aria-invalid]="!valido('cubre')" [class.invalido]="!valido('cubre')" />
                  <span>meses</span>
                </span>
                <span class="ayuda">Cuánto se pide: lo que se va a vender en ese tiempo.</span>
              </label>
              <label class="field">
                <span>Kilos por contenedor <span class="muted">(opcional)</span></span>
                <span class="con-unidad">
                  <input type="number" min="1" step="1" name="contenedor" [(ngModel)]="contenedor"
                         [attr.aria-invalid]="!valido('contenedor')" [class.invalido]="!valido('contenedor')" />
                  <span>kg</span>
                </span>
                <span class="ayuda">Para decir qué tanto del contenedor llena el pedido.</span>
              </label>
            </div>
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-ghost" (click)="cerrado.emit()">Cancelar</button>
            <button type="submit" class="btn btn-primary" [disabled]="guardando()">{{ guardando() ? 'Guardando…' : 'Guardar' }}</button>
          </div>
        </form>
      </div>
    </div>
  `,
  styles: `
    .tinta { color: var(--tinta); }
    .con-unidad { display: flex; align-items: center; gap: 10px; }
    .con-unidad input { width: min(7rem, 100%); }
    .con-unidad span { font-size: 0.875rem; color: var(--tinta-2); }
  `,
})
export class AjustesModal implements OnInit {
  private readonly api = inject(RotacionService);

  readonly ajustes = input.required<AjustesRotacion>();
  readonly cerrado = output<void>();
  readonly guardado = output<AjustesRotacion>();

  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  proveedor: number | null = 10;
  colchon: number | null = 3;
  cubre: number | null = 4;
  contenedor: number | null = null;

  ngOnInit(): void {
    const a = this.ajustes();
    this.proveedor = a.semanas_proveedor;
    this.colchon = a.semanas_colchon;
    this.cubre = a.meses_cubre;
    this.contenedor = a.kg_contenedor;
  }

  /** Método, no `computed`: lee campos de ngModel. */
  valido(campo: 'proveedor' | 'colchon' | 'cubre' | 'contenedor'): boolean {
    const entero = (v: number | null, min: number, max: number) => v != null && Number.isInteger(Number(v)) && v >= min && v <= max;
    switch (campo) {
      case 'proveedor': return entero(this.proveedor, 1, 52);
      case 'colchon': return entero(this.colchon, 0, 12);
      case 'cubre': return entero(this.cubre, 1, 12);
      default: return this.contenedor == null || (this.contenedor as unknown) === '' || Number(this.contenedor) > 0;
    }
  }

  guardar(): void {
    if (this.guardando()) return;
    if (!this.valido('proveedor')) return this.error.set('El proveedor tarda de 1 a 52 semanas.');
    if (!this.valido('colchon')) return this.error.set('El colchón va de 0 a 12 semanas.');
    if (!this.valido('cubre')) return this.error.set('Cada pedido alcanza de 1 a 12 meses.');
    if (!this.valido('contenedor')) return this.error.set('Los kilos por contenedor van vacíos o más de 0.');
    const cont = this.contenedor == null || (this.contenedor as unknown) === '' ? null : Number(this.contenedor);
    this.guardando.set(true);
    this.error.set(null);
    this.api.guardarAjustes({
      semanas_proveedor: Number(this.proveedor), semanas_colchon: Number(this.colchon),
      meses_cubre: Number(this.cubre), kg_contenedor: cont,
    }).subscribe({
      next: (a) => { this.guardando.set(false); this.guardado.emit(a); },
      error: (e) => {
        this.guardando.set(false);
        this.error.set((e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'No se pudieron guardar. Intenta de nuevo.');
      },
    });
  }
}
