import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TiendaService } from '../../../core/services/tienda.service';
import { CuentaBancaria, CuentaBancariaInput } from '../../../core/models/tienda.models';
import { ApiError } from '../../../core/models/auth.models';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';

/** Solo los dígitos de lo tecleado. */
export function digitos(v: string | null | undefined): string {
  return String(v ?? '').replace(/\D/g, '');
}

/**
 * ¿La CLABE es válida? 18 dígitos y el último es de control (pesos 3, 7, 1 sobre
 * los otros 17). Es la misma regla del backend (`configuracion/cuentas.js`):
 * aquí solo sirve para avisar mientras se teclea.
 */
export function clabeValida(clabe: string): boolean {
  if (!/^\d{18}$/.test(clabe)) return false;
  const pesos = [3, 7, 1];
  const suma = [...clabe.slice(0, 17)].reduce((s, c, i) => s + ((Number(c) * pesos[i % 3]) % 10), 0);
  return (10 - (suma % 10)) % 10 === Number(clabe[17]);
}

/** "032 180 00011835971 9": la CLABE en sus partes (banco, plaza, cuenta, control). */
export function clabeLegible(clabe: string | null | undefined): string {
  const c = digitos(clabe);
  if (c.length !== 18) return c;
  return `${c.slice(0, 3)} ${c.slice(3, 6)} ${c.slice(6, 17)} ${c.slice(17)}`;
}

/** Bancos que más se usan, para sugerir mientras se escribe (se puede escribir otro). */
const BANCOS = [
  'BBVA', 'Banorte', 'Santander', 'Banamex', 'HSBC', 'Scotiabank', 'Banco Azteca', 'BanCoppel',
  'Inbursa', 'Banregio', 'Afirme', 'Banco del Bajío', 'Mercado Pago', 'Spin by OXXO', 'Nu',
];

/**
 * Alta y edición de una cuenta de banco para transferencias (2026-10-06): banco,
 * a nombre de quién, número de cuenta y CLABE. Pide al menos uno de los dos
 * números. La lista ya trae la cuenta y entra por input: abre armado.
 *
 * No se cierra al tocar el fondo (se perdería la captura): sale con la ✕,
 * "Cancelar" o Escape.
 */
@Component({
  selector: 'app-cuenta-bancaria-modal',
  imports: [FormsModule],
  templateUrl: './cuenta-bancaria-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class CuentaBancariaModal implements OnInit {
  private readonly tienda = inject(TiendaService);
  private readonly confirmacion = inject(ConfirmacionService);

  /** null = cuenta nueva. */
  readonly cuenta = input<CuentaBancaria | null>(null);
  readonly cerrado = output<void>();
  /** El texto para la pantalla; la lista se recarga. */
  readonly guardada = output<string>();

  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly BANCOS = BANCOS;

  form: CuentaBancariaInput = { banco: '', titular: '', numero_cuenta: '', clabe: '', activa: true };

  /** El input se lee aquí y NO en el constructor (ahí todavía no está asignado). */
  ngOnInit(): void {
    const c = this.cuenta();
    if (c) {
      this.form = {
        banco: c.banco,
        titular: c.titular ?? '',
        numero_cuenta: c.numero_cuenta ?? '',
        clabe: clabeLegible(c.clabe),
        activa: !!c.activa,
      };
    }
  }

  esEdicion(): boolean {
    return !!this.cuenta();
  }

  /** Lo que se dice bajo la CLABE mientras se teclea. Método: lee ngModel. */
  avisoClabe(): { texto: string; ok: boolean } | null {
    const c = digitos(this.form.clabe);
    if (!c) return null;
    if (c.length < 18) return { texto: `Van ${c.length} de 18 dígitos.`, ok: false };
    if (c.length > 18) return { texto: `Lleva 18 dígitos y hay ${c.length}.`, ok: false };
    return clabeValida(c)
      ? { texto: 'CLABE válida.', ok: true }
      : { texto: 'El último dígito no cuadra con los demás: revisa que esté bien copiada.', ok: false };
  }

  guardar(): void {
    const f = this.form;
    if (!f.banco.trim()) {
      this.error.set('Escribe el nombre del banco.');
      return;
    }
    if (!digitos(f.numero_cuenta) && !digitos(f.clabe)) {
      this.error.set('Escribe el número de cuenta o la CLABE: sin ninguno de los dos no se puede depositar.');
      return;
    }
    const body: CuentaBancariaInput = {
      banco: f.banco.trim(),
      titular: (f.titular ?? '').trim() || null,
      numero_cuenta: digitos(f.numero_cuenta) || null,
      clabe: digitos(f.clabe) || null,
      activa: f.activa,
    };
    this.guardando.set(true);
    this.error.set(null);
    const c = this.cuenta();
    const obs = c ? this.tienda.actualizarCuentaBancaria(c.id, body) : this.tienda.crearCuentaBancaria(body);
    obs.subscribe({
      next: () => {
        this.guardando.set(false);
        this.guardada.emit(c ? `Se guardó la cuenta de ${body.banco}.` : `Se agregó la cuenta de ${body.banco}.`);
        this.cerrar();
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.guardando.set(false);
      },
    });
  }

  async eliminar(): Promise<void> {
    const c = this.cuenta();
    if (!c) return;
    const si = await this.confirmacion.pedir({
      titulo: `¿Quitar la cuenta de ${c.banco}?`,
      mensaje: 'Deja de enseñarse a los clientes. Si solo quieres esconderla un tiempo, desmarca "Activa".',
      aceptar: 'Quitar la cuenta',
      peligro: true,
    });
    if (!si) return;
    this.guardando.set(true);
    this.tienda.eliminarCuentaBancaria(c.id).subscribe({
      next: () => {
        this.guardando.set(false);
        this.guardada.emit(`Se quitó la cuenta de ${c.banco}.`);
        this.cerrar();
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.guardando.set(false);
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
