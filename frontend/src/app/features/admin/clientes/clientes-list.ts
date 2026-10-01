import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ClientesService, OrdenClientes } from '../../../core/services/clientes.service';
import { Cliente } from '../../../core/models/clientes.models';
import { ApiError } from '../../../core/models/auth.models';
import { FechaPipe } from '../../../shared/fecha.pipe';
import { ClienteFormModal } from './cliente-form-modal';

/**
 * Los clientes. Es una pantalla para MIRAR: quién compra más, quién debe y
 * quién no ha vuelto, con las acciones en botones que abren un modal.
 *
 * El ORDEN es lo que la hace útil: la tienda no busca un cliente en una lista
 * alfabética, se pregunta cosas ("¿quién me debe?", "¿quién compra más?") y el
 * selector de orden contesta cada una sin salir de aquí.
 */
@Component({
  selector: 'app-clientes-list',
  imports: [FormsModule, RouterLink, FechaPipe, ClienteFormModal],
  templateUrl: './clientes-list.html',
})
export class ClientesList {
  private readonly clientes = inject(ClientesService);

  readonly items = signal<Cliente[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  q = '';
  conSaldo = false;
  orden: OrdenClientes = 'nombre';

  /** `null` = cerrado, `'nuevo'` = alta, un cliente = edición de ese renglón. */
  readonly modal = signal<Cliente | 'nuevo' | null>(null);

  /** Los órdenes, con el nombre de la pregunta que contestan. */
  readonly ordenes: { valor: OrdenClientes; etiqueta: string }[] = [
    { valor: 'nombre', etiqueta: 'Por nombre' },
    { valor: 'saldo', etiqueta: 'Quién me debe más' },
    { valor: 'compras', etiqueta: 'Quién compra más' },
    { valor: 'reciente', etiqueta: 'Quién vino más reciente' },
    { valor: 'nuevo', etiqueta: 'Los más nuevos' },
  ];

  constructor() {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set(null);
    this.clientes
      .listar({ q: this.q.trim() || undefined, con_saldo: this.conSaldo, orden: this.orden })
      .subscribe({
        next: (p) => {
          this.items.set(p.items);
          this.total.set(p.total);
          this.cargando.set(false);
        },
        error: (e) => {
          this.error.set(this.msg(e));
          this.cargando.set(false);
        },
      });
  }

  /** Cliente que edita el modal (`null` cuando es un alta). */
  clienteModal(): Cliente | null {
    const m = this.modal();
    return m === 'nuevo' || m === null ? null : m;
  }

  abrirNuevo(): void {
    this.mensaje.set(null);
    this.modal.set('nuevo');
  }

  abrirEdicion(c: Cliente): void {
    this.mensaje.set(null);
    this.modal.set(c);
  }

  cerrarModal(): void {
    this.modal.set(null);
  }

  guardado(c: Cliente): void {
    this.mensaje.set(`Se guardó "${c.nombre_comercial || c.nombre}".`);
    this.cargar();
  }

  /** Los DECIMAL llegan como string; hay que compararlos como números. */
  num(v: unknown): number {
    return Number(v ?? 0);
  }

  dinero(v: unknown): string {
    return this.num(v).toLocaleString('es-MX', {
      style: 'currency',
      currency: 'MXN',
      maximumFractionDigits: 0,
    });
  }

  /**
   * Cuántos días lleva sin venir, para el aviso del renglón. `null` cuando
   * nunca ha comprado: no es lo mismo que llevar mucho sin volver.
   */
  diasSinVenir(c: Cliente): number | null {
    if (!c.ultima_compra) return null;
    const ms = Date.now() - new Date(String(c.ultima_compra).replace(' ', 'T')).getTime();
    return Math.floor(ms / 86400000);
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
