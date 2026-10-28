import { Component, inject, input, signal } from '@angular/core';
import { InventarioService } from '../core/services/inventario.service';
import { guardarArchivo, mensajeDeError } from './descargar';

const NOMBRES = {
  lista: 'Plantilla - Lista con varios colores.xlsx',
  hilo: 'Plantilla - Un solo hilo.xlsx',
} as const;

/**
 * «DESCARGAR PLANTILLA» (2026-10-22, usuario: "que al cargar el Excel también
 * haya una opción Plantilla o Formato; que me dé el Excel en limpio para que
 * nosotros lo llenemos"). Baja el Excel vacío con las columnas que lee la carga:
 * `lista` (varios colores: hoja GLOBAL, DOCUMENTO e INSTRUCCIONES) o `hilo`
 * (un solo hilo: código, cantidad, lote y cono). Va junto a «Elegir archivo» en
 * los tres cargadores: los dos modos de Surtir inventario y las presentaciones.
 */
@Component({
  selector: 'app-boton-plantilla',
  template: `
    <button type="button" class="btn btn-ghost btn-sm" [disabled]="bajando()" (click)="bajar()"
            [title]="tipo() === 'lista'
              ? 'Un Excel vacío con las columnas de la lista con varios colores, para llenarlo'
              : 'Un Excel vacío con las columnas de la lista de un solo hilo, para llenarlo'">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12 M8 11l4 4 4-4 M4 19h16"></path></svg>
      {{ bajando() ? 'Bajando…' : 'Descargar plantilla' }}
    </button>
    @if (error()) { <span class="error-plantilla" role="alert">{{ error() }}</span> }
  `,
  styles: `
    :host { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 4px; }
    .btn { display: inline-flex; align-items: center; gap: 6px; }
    .error-plantilla { font-size: 0.8125rem; color: var(--peligro-t); }
  `,
})
export class BotonPlantilla {
  private readonly inv = inject(InventarioService);

  readonly tipo = input.required<'lista' | 'hilo'>();
  readonly bajando = signal(false);
  readonly error = signal<string | null>(null);

  bajar(): void {
    if (this.bajando()) return;
    const tipo = this.tipo();
    this.bajando.set(true);
    this.error.set(null);
    this.inv.plantillaCarga(tipo).subscribe({
      next: (blob) => {
        guardarArchivo(blob, NOMBRES[tipo]);
        this.bajando.set(false);
      },
      error: async (e) => {
        this.error.set(await mensajeDeError(e, 'No se pudo bajar la plantilla de Excel.'));
        this.bajando.set(false);
      },
    });
  }
}
