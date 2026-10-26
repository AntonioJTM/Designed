import { Component, effect, inject, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TransferenciasService } from '../core/services/transferencias.service';

/**
 * "¿A QUÉ CUENTA LLEGÓ?" (2026-10-20, Transferencias: el usuario eligió que se
 * pregunte AL COBRAR). Va junto al cobro por transferencia en la caja, el abono,
 * el anticipo, el pago de una nota y la entrega. Con UNA sola cuenta activa se
 * elige sola; con varias hay que escogerla (quien llama apaga su botón con
 * `TransferenciasService.faltaCuenta`); sin cuentas dadas de alta no se dibuja.
 */
@Component({
  selector: 'app-cuenta-deposito',
  imports: [FormsModule],
  template: `
    @if (svc.cuentas(); as cs) {
      @if (cs.length) {
        <label class="field">
          <span>{{ pregunta() }}</span>
          <select [ngModel]="cuenta()" (ngModelChange)="cuenta.set($event)" [name]="nombre()"
                  [class.invalido]="marcar() && !cuenta()" [attr.aria-invalid]="marcar() && !cuenta()">
            @if (cs.length > 1) { <option [ngValue]="null" disabled>Elige la cuenta</option> }
            @for (c of cs; track c.id) { <option [ngValue]="c.id">{{ svc.nombreCuenta(c) }}</option> }
          </select>
        </label>
      }
    }
  `,
})
export class CuentaDeposito {
  protected readonly svc = inject(TransferenciasService);
  /** El id de la cuenta elegida (null = sin elegir). */
  readonly cuenta = model<number | null>(null);
  readonly nombre = input('cuenta_deposito');
  /** Lo que pregunta: al regresarle dinero por el banco es «¿De qué cuenta salió?» (2026-10-26). */
  readonly pregunta = input('¿A qué cuenta llegó?');
  /** Pintarlo en rojo si falta (después de intentar cobrar). */
  readonly marcar = input(false);

  /** La eligió sola (era la única): si después aparecen más, se vuelve a preguntar. */
  private sola = false;

  constructor() {
    // Se vuelven a pedir cada vez que se abre un cobro (revisor de tiendas,
    // 2026-10-20): una cuenta dada de alta o desactivada a media mañana ya cuenta,
    // sin recargar la caja.
    this.svc.cargarCuentas(true);
    effect(() => {
      const cs = this.svc.cuentas();
      const actual = this.cuenta();
      if (!cs) return;
      // Con una sola cuenta no hay qué preguntar: se elige sola.
      if (cs.length === 1 && actual == null) {
        this.sola = true;
        this.cuenta.set(cs[0].id);
        return;
      }
      // La elegida ya no está (se desactivó), o se eligió sola y ahora hay varias: a escoger.
      if (actual != null && (!cs.some((c) => c.id === actual) || (this.sola && cs.length > 1))) {
        this.sola = false;
        this.cuenta.set(null);
      }
    });
  }
}
