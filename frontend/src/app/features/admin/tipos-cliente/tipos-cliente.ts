import { Component, inject, signal } from '@angular/core';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { TipoCliente } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';
import { TipoClienteFormModal } from './tipo-cliente-form-modal';

/**
 * Una lista como la trae `GET /tipos-cliente`: además del tipo, cuántos clientes
 * la usan y en cuántas presentaciones tiene precio propio (de solo lectura).
 */
export interface ListaPrecio extends TipoCliente {
  num_clientes?: number | string;
  num_precios?: number | string;
}

/**
 * Las listas de precio (rediseño 2026-10). Cada tipo de cliente es una: el
 * marcado como público cobra `producto_variantes.precio` y los demás llevan su
 * propio precio por presentación, que se captura en la pantalla de
 * presentaciones del producto.
 *
 * La tabla dice si cada lista SE USA —cuántos clientes la tienen y cuántas
 * presentaciones le pusieron precio—: sin eso no hay forma de saber si apagar
 * una lista le cambia el precio a alguien. El alta, la edición y la baja son un
 * modal; el público no se puede eliminar ni desactivar.
 */
@Component({
  selector: 'app-tipos-cliente',
  imports: [TipoClienteFormModal],
  templateUrl: './tipos-cliente.html',
})
export class TiposCliente {
  private readonly catalogo = inject(CatalogoService);

  readonly tipos = signal<ListaPrecio[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  /** `null` = cerrado, `'nuevo'` = alta, un tipo = edición de ese renglón. */
  readonly modal = signal<ListaPrecio | 'nuevo' | null>(null);

  constructor() {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.catalogo.tiposCliente().subscribe({
      next: (t) => {
        this.tipos.set(t);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  /** Clientes que la tienen como su lista habitual (`null` si el servidor no lo dijo). */
  clientes(t: ListaPrecio): number | null {
    return t.num_clientes === undefined ? null : Number(t.num_clientes);
  }

  /** Presentaciones con precio propio en la lista. */
  precios(t: ListaPrecio): number | null {
    return t.num_precios === undefined ? null : Number(t.num_precios);
  }

  /** La línea de abajo del nombre: qué es la lista y si de verdad se usa. */
  nota(t: ListaPrecio): string {
    if (t.es_publico) return 'La de mostrador. No se puede borrar ni apagar.';
    const precios = this.precios(t);
    const clientes = this.clientes(t);
    if (precios === 0 && clientes === 0) return 'Sin uso por ahora';
    if (precios === 0) return 'Sin precio propio todavía: cobra el precio público';
    return 'Precio propio en cada presentación';
  }

  /** Tipo que edita el modal (`null` cuando es un alta). */
  tipoModal(): ListaPrecio | null {
    const m = this.modal();
    return m === 'nuevo' || m === null ? null : m;
  }

  abrirNuevo(): void {
    this.mensaje.set(null);
    this.error.set(null);
    this.modal.set('nuevo');
  }

  abrirEdicion(t: ListaPrecio): void {
    this.mensaje.set(null);
    this.error.set(null);
    this.modal.set(t);
  }

  cerrarModal(): void {
    this.modal.set(null);
  }

  guardado(t: TipoCliente): void {
    this.mensaje.set(`Se guardó "${t.nombre}".`);
    this.cargar();
  }

  eliminado(t: TipoCliente): void {
    this.mensaje.set(`Se eliminó "${t.nombre}".`);
    this.cargar();
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
