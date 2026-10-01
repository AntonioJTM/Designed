import { Component, inject, signal } from '@angular/core';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { TipoCliente } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';
import { TipoClienteFormModal } from './tipo-cliente-form-modal';

/**
 * Las listas de precio. Cada tipo de cliente es una: el marcado como público
 * cobra `producto_variantes.precio` y los demás llevan su propio precio por
 * presentación, que se captura en la pantalla de presentaciones del producto.
 *
 * Hasta ahora solo se podían crear por API; el punto de venta ya ofrecía el
 * selector pero no había dónde darlos de alta.
 */
@Component({
  selector: 'app-tipos-cliente',
  imports: [TipoClienteFormModal],
  templateUrl: './tipos-cliente.html',
})
export class TiposCliente {
  private readonly catalogo = inject(CatalogoService);

  readonly tipos = signal<TipoCliente[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  /** `null` = cerrado, `'nuevo'` = alta, un tipo = edición de ese renglón. */
  readonly modal = signal<TipoCliente | 'nuevo' | null>(null);

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

  /** Tipo que edita el modal (`null` cuando es un alta). */
  tipoModal(): TipoCliente | null {
    const m = this.modal();
    return m === 'nuevo' || m === null ? null : m;
  }

  abrirNuevo(): void {
    this.mensaje.set(null);
    this.error.set(null);
    this.modal.set('nuevo');
  }

  abrirEdicion(t: TipoCliente): void {
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

  eliminar(t: TipoCliente): void {
    if (!confirm(`¿Eliminar la lista "${t.nombre}"?`)) return;
    this.error.set(null);
    this.mensaje.set(null);
    this.catalogo.eliminarTipoCliente(t.id).subscribe({
      next: () => {
        this.mensaje.set(`Se eliminó "${t.nombre}".`);
        this.cargar();
      },
      // El backend rechaza borrar el público y los que tienen precios o pedidos,
      // con un mensaje que ya explica qué hacer: se muestra tal cual.
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
