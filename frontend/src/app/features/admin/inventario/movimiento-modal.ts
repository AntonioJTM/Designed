import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EquivalenciaPaquetes, InventarioService } from '../../../core/services/inventario.service';
import { Almacen, TipoMovimiento } from '../../../core/models/inventario.models';
import { Variante } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';

/**
 * AJUSTE Y MERMA en un modal. Antes eran dos tarjetas desplegadas ("1 · Elige la
 * variante" y "2 · Ajustar o dar de baja") que ocupaban media pantalla de
 * Inventario para algo que se usa poco.
 *
 * Solo esos dos tipos: `entrada` la hace la remesa, `devolucion` la cancelación
 * del pedido y `salida` la reemplazó el traspaso. El ajuste es la ÚNICA forma de
 * cuadrar el sistema con un conteo físico, así que no se quita.
 *
 * El inventario se lleva en KILOS, pero la tienda cuenta en PAQUETES: se puede
 * capturar en cualquiera de los dos y el modal traduce con el peso promedio REAL
 * de los bultos que hay en ese almacén (`GET /inventario/equivalencia-paquetes`),
 * no con el nominal. Al backend siempre se le mandan kilos.
 */
@Component({
  selector: 'app-movimiento-modal',
  imports: [FormsModule],
  templateUrl: './movimiento-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class MovimientoModal implements OnInit {
  private readonly inv = inject(InventarioService);

  readonly almacenes = input<Almacen[]>([]);

  readonly cerrado = output<void>();
  /** Se registró un movimiento: el listado recarga existencias y panorama. */
  readonly hecho = output<void>();

  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  readonly guardando = signal(false);

  readonly tipos: TipoMovimiento[] = ['ajuste', 'merma'];

  // Selector de variante
  q = '';
  readonly resultados = signal<Variante[]>([]);
  varianteSel: number | '' = '';

  /** En qué unidad se está capturando. Los paquetes se traducen a kilos. */
  unidad: 'kg' | 'paq' = 'kg';

  mov = {
    tipo: 'ajuste' as TipoMovimiento,
    almacen_id: '' as number | '',
    cantidad: null as number | null,
    motivo: '',
  };

  /**
   * Peso de referencia y existencias del SKU en ese almacén. Se pide al elegir la
   * variante o cambiar de almacén, porque el promedio depende de los bultos que
   * estén ahí.
   */
  readonly equivalencia = signal<EquivalenciaPaquetes | null>(null);

  /** El input se lee aquí, no en el constructor: ahí todavía no está puesto. */
  ngOnInit(): void {
    const a = this.almacenes()[0];
    if (a) this.mov.almacen_id = a.id;
  }

  buscar(): void {
    const q = this.q.trim();
    if (!q) return;
    this.error.set(null);
    this.inv.buscarVariantes(q).subscribe({
      next: (v) => {
        this.resultados.set(v);
        if (v.length === 1) {
          // Coincidencia única (típico al escanear un código): se autoselecciona.
          this.varianteSel = v[0].id;
          this.mensaje.set(`Variante: ${v[0].sku} · ${v[0].producto}`);
          this.alElegir();
        } else if (v.length === 0) {
          this.mensaje.set(null);
          this.error.set('No se encontró ninguna variante con ese código.');
        }
      },
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  esAjuste(): boolean {
    return this.mov.tipo === 'ajuste';
  }

  /** La variante elegida, para saber si se cuenta en paquetes y cuánto pesa. */
  varianteActual(): Variante | null {
    return this.resultados().find((v) => v.id === Number(this.varianteSel)) ?? null;
  }

  /** Solo los paquetes se pueden contar por pieza; conos y simples van en kilos. */
  esPaquete(): boolean {
    return this.varianteActual()?.tipo_presentacion === 'paquete';
  }

  /** Al cambiar de variante o de almacén hay que rehacer la equivalencia. */
  alElegir(): void {
    this.equivalencia.set(null);
    if (!this.esPaquete()) this.unidad = 'kg';
    const id = Number(this.varianteSel);
    const alm = Number(this.mov.almacen_id);
    if (!id || !alm) return;
    this.inv.equivalenciaPaquetes(id, alm).subscribe({
      next: (e) => this.equivalencia.set(e),
      error: () => this.equivalencia.set(null),
    });
  }

  /** Peso con el que se traduce paquetes → kilos (promedio real, o nominal). */
  pesoRef(): number {
    return Number(this.equivalencia()?.peso_referencia ?? 0);
  }

  /**
   * Los kilos que se van a mandar. Es un MÉTODO y no un `computed` porque los
   * campos son `ngModel` normales, no señales: un `computed` se quedaría pegado
   * en el primer valor.
   */
  kilos(): number | null {
    const n = this.mov.cantidad;
    if (n == null || isNaN(Number(n))) return null;
    if (this.unidad === 'kg') return Number(n);
    const peso = this.pesoRef();
    if (!peso) return null;
    return Math.round(Number(n) * peso * 1000) / 1000;
  }

  /** Kilos que hay hoy en ese almacén, para contrastar con lo contado. */
  saldoActual(): number | null {
    const e = this.equivalencia();
    return e ? Number(e.disponible.kg_inventario) : null;
  }

  /** Cómo queda el saldo: el ajuste SOBREESCRIBE, la merma resta. */
  saldoResultante(): number | null {
    const kg = this.kilos();
    const actual = this.saldoActual();
    if (kg == null || actual == null) return null;
    const nuevo = this.esAjuste() ? kg : actual - kg;
    return Math.round(nuevo * 1000) / 1000;
  }

  /** El backend rechaza dejar el saldo bajo cero; se avisa antes de intentarlo. */
  quedaNegativo(): boolean {
    const n = this.saldoResultante();
    return n != null && n < 0;
  }

  /** Cuántos paquetes son unos kilos, con el peso de referencia. */
  enPaquetes(kg: number | null): number | null {
    const peso = this.pesoRef();
    if (kg == null || !peso) return null;
    return Math.round((kg / peso) * 100) / 100;
  }

  registrar(): void {
    this.error.set(null);
    this.mensaje.set(null);
    const kg = this.kilos();
    if (!this.varianteSel || !this.mov.almacen_id || kg == null) {
      this.error.set('Elige variante, almacén y cantidad.');
      return;
    }
    if (this.unidad === 'paq' && !this.pesoRef()) {
      this.error.set('No se sabe cuánto pesa un paquete de este SKU: captura los kilos.');
      return;
    }
    this.guardando.set(true);
    this.inv
      .registrarMovimiento({
        variante_id: Number(this.varianteSel),
        almacen_id: Number(this.mov.almacen_id),
        tipo: this.mov.tipo,
        // Siempre en kilos: es la unidad del inventario.
        cantidad: kg,
        motivo: this.mov.motivo.trim() || undefined,
      })
      .subscribe({
        next: (r) => {
          this.mensaje.set(`Movimiento registrado. Saldo: ${r.saldo_anterior} → ${r.saldo_nuevo}.`);
          this.mov.cantidad = null;
          this.mov.motivo = '';
          this.guardando.set(false);
          // Se refresca el saldo para el siguiente SKU del conteo.
          this.alElegir();
          // No se cierra: cuadrar varios SKU seguidos es lo normal en un conteo.
          this.hecho.emit();
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
