import { Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { hoyLocal } from './fecha.pipe';

/** Los días que se ofrecen de un toque; cualquier otro se escribe. */
export const PLAZOS_CREDITO = [8, 15, 30];
/** Los que se proponen al fiar (2026-10-20: "la caja propone 15"). */
export const PLAZO_CREDITO_POR_OMISION = 15;

let siguiente = 0;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** 'YYYY-MM-DD' + n días, en 'YYYY-MM-DD'. */
export function venceEl(desde: string, dias: number): string {
  const d = new Date(Date.parse(desde));
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** '2026-11-04' → '4 de noviembre' (con el año si no es este). */
export function fechaVence(dia: string | null | undefined): string {
  const [a, m, d] = String(dia ?? '').slice(0, 10).split('-').map(Number);
  if (!a || !m || !d) return '';
  return `${d} de ${MESES[m - 1]}${String(a) === hoyLocal().slice(0, 4) ? '' : ' de ' + a}`;
}

/** Días válidos: entero de 1 a 365. */
export function plazoValido(dias: unknown): boolean {
  const n = Number(dias);
  return Number.isInteger(n) && n >= 1 && n <= 365;
}

/**
 * A CUÁNTOS DÍAS ES LA NOTA (2026-10-20, usuario: "cuando se realiza una venta a
 * crédito, que diga a cuántos días es la nota"; eligió que se escriban en CADA
 * venta). Botones 8 / 15 / 30 y "otro" con el número; abajo, cuándo vence. Lo
 * usan la caja (A crédito), entregar una nota en espera a crédito y pasar una
 * nota pendiente de pago a crédito.
 */
@Component({
  selector: 'app-plazo-credito',
  imports: [FormsModule],
  template: `
    <div class="field plazo">
      <span [id]="idTitulo">A cuántos días</span>
      <div class="plazo-fila">
        <div class="seg" role="radiogroup" [attr.aria-labelledby]="idTitulo">
          @for (d of PLAZOS; track d) {
            <button type="button" role="radio" [class.on]="dias() === d" [attr.aria-checked]="dias() === d"
                    (click)="dias.set(d)">{{ d }} días</button>
          }
        </div>
        <label class="otro">
          <span class="oculto">Otro número de días</span>
          <input type="number" min="1" max="365" step="1" [ngModel]="dias()" (ngModelChange)="dias.set($event)"
                 [name]="nombre()" [class.invalido]="!valido()" [attr.aria-invalid]="!valido()" />
          <span>días</span>
        </label>
      </div>
      <span class="ayuda" [class.mal]="!valido()">
        @if (valido()) { Vence el <b>{{ vence() }}</b>. Si no la paga para entonces, la campana lo avisa. }
        @else { Pon de 1 a 365 días. }
      </span>
    </div>
  `,
  styles: `
    .plazo-fila { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .plazo-fila .seg { flex: 1 1 auto; }
    .otro { display: inline-flex; align-items: center; gap: 6px; font-size: 0.875rem; color: var(--tinta-2); }
    .otro input { width: 5.5rem; }
    .ayuda.mal { color: var(--peligro-t); }
  `,
})
export class PlazoCredito {
  readonly PLAZOS = PLAZOS_CREDITO;
  readonly idTitulo = `plazo-titulo-${++siguiente}`;
  /** Los días de la nota. */
  readonly dias = model<number | null>(PLAZO_CREDITO_POR_OMISION);
  /** Desde qué día cuenta ('YYYY-MM-DD'); hoy, si no se dice. */
  readonly desde = input<string | null>(null);
  readonly nombre = input('dias_credito');

  valido(): boolean {
    return plazoValido(this.dias());
  }

  vence(): string {
    return fechaVence(venceEl(this.desde() ?? hoyLocal(), Number(this.dias())));
  }
}
