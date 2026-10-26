import { Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { hoyLocal } from './fecha.pipe';

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
 * venta). Solo el número de días (2026-10-21, usuario: "que solo me deje anotar
 * cuántos días y no de las opciones": se quitaron los botones 8 / 15 / 30); abajo,
 * cuándo vence. Propone 15 y al entrar al campo lo deja seleccionado, así lo que
 * se teclea lo reemplaza. Lo usan la caja (A crédito), entregar una nota en espera
 * a crédito y pasar una nota pendiente de pago a crédito.
 */
@Component({
  selector: 'app-plazo-credito',
  imports: [FormsModule],
  template: `
    <div class="field plazo">
      <label [for]="idCampo">A cuántos días</label>
      <span class="plazo-fila">
        <input [id]="idCampo" type="number" min="1" max="365" step="1" inputmode="numeric"
               [ngModel]="dias()" (ngModelChange)="dias.set($event)" (focus)="seleccionar($event)"
               [name]="nombre()" [class.invalido]="!valido()" [attr.aria-invalid]="!valido()"
               [attr.aria-describedby]="idAyuda" />
        <span>días</span>
      </span>
      <span class="ayuda" [id]="idAyuda" [class.mal]="!valido()">
        @if (valido()) { Vence el <b>{{ vence() }}</b>. Si no la paga para entonces, la campana lo avisa. }
        @else { Pon de 1 a 365 días. }
      </span>
    </div>
  `,
  styles: `
    .plazo-fila { display: inline-flex; align-items: center; gap: 6px; font-size: 0.875rem; color: var(--tinta-2); }
    .plazo-fila input { width: 6rem; }
    .ayuda.mal { color: var(--peligro-t); }
  `,
})
export class PlazoCredito {
  private readonly n = ++siguiente;
  readonly idCampo = `plazo-dias-${this.n}`;
  readonly idAyuda = `plazo-ayuda-${this.n}`;

  /** Al entrar al campo queda seleccionado: lo que se teclee reemplaza los 15 propuestos. */
  seleccionar(e: Event): void {
    (e.target as HTMLInputElement).select();
  }
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
