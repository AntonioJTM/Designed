import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { InventarioService } from '../../../core/services/inventario.service';
import { AuthService } from '../../../core/services/auth.service';
import { Almacen, Movimiento, TraspasoDetalle } from '../../../core/models/inventario.models';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';
import { CuandoPipe } from './cuando.pipe';
import { FolioPipe } from '../../../shared/folio.pipe';

/**
 * Kardex: cada entrada y salida de mercancía, con el documento que la explica.
 *
 * Habla de DOCUMENTOS, no de tipos: el `concepto`, el `folio` y el documento que
 * se puede abrir (`detalle_tipo` / `detalle_id`) los resuelve el backend
 * (`listarMovimientos`) y aquí se pintan tal cual. La pantalla nunca reconstruye
 * esa etiqueta por su cuenta; solo elige el color de la pastilla según el tipo
 * de documento.
 */
@Component({
  selector: 'app-kardex',
  imports: [FolioPipe, FormsModule, RouterLink, CantidadPipe, FechaPipe, CuandoPipe],
  templateUrl: './kardex.html',
  styleUrl: './kardex.scss',
})
export class Kardex {
  private readonly inv = inject(InventarioService);
  private readonly auth = inject(AuthService);

  readonly almacenes = signal<Almacen[]>([]);
  readonly movimientos = signal<Movimiento[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  /** Movimiento cuyo documento se está viendo, y su contenido. */
  readonly abierto = signal<number | null>(null);
  readonly traspaso = signal<TraspasoDetalle | null>(null);

  /** "Ver venta" solo se ofrece a quien puede abrir el pedido. */
  readonly vePedidos = computed(() => this.auth.puede('ver:pedidos'));

  filtroAlmacen: number | '' = '';
  filtroConcepto = '';
  filtroQ = '';
  desde = '';
  hasta = '';
  private pagina = 1;
  private temporizador: ReturnType<typeof setTimeout> | null = null;

  /** Agrupaciones del kardex en lenguaje de tienda. */
  readonly conceptos = [
    { valor: '', etiqueta: 'Todos' },
    { valor: 'ventas', etiqueta: 'Ventas' },
    { valor: 'entradas', etiqueta: 'Entradas de mercancía' },
    { valor: 'traspasos', etiqueta: 'Traspasos' },
    { valor: 'desarmes', etiqueta: 'Bajadas de conos' },
    { valor: 'ajustes', etiqueta: 'Ajustes' },
    { valor: 'mermas', etiqueta: 'Mermas' },
  ];

  constructor() {
    this.inv.almacenes().subscribe({ next: (a) => this.almacenes.set(a), error: () => {} });
    this.cargar();
  }

  /** Vuelve a la primera página con los filtros de ahora. */
  cargar(): void {
    this.pagina = 1;
    this.abierto.set(null);
    this.pedir(false);
  }

  /** La página siguiente, junto a lo que ya se ve. */
  cargarMas(): void {
    this.pagina++;
    this.pedir(true);
  }

  /** El buscador espera a que se deje de teclear; Enter busca de inmediato. */
  alTeclear(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.cargar(), 350);
  }

  buscarYa(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.cargar();
  }

  private pedir(juntar: boolean): void {
    this.cargando.set(true);
    this.inv
      .movimientos(this.filtroAlmacen || undefined, undefined, this.filtroConcepto || undefined, {
        q: this.filtroQ.trim() || undefined,
        desde: this.desde || undefined,
        hasta: this.hasta || undefined,
        page: this.pagina,
      })
      .subscribe({
        next: (p) => {
          this.movimientos.set(juntar ? [...this.movimientos(), ...p.items] : p.items);
          this.total.set(p.total);
          this.cargando.set(false);
        },
        error: (e) => {
          this.error.set(this.msg(e));
          this.cargando.set(false);
        },
      });
  }

  readonly hayMas = computed(() => this.movimientos().length < this.total());

  /** Abre el traspaso que originó el movimiento para ver qué se mandó. */
  verDetalle(m: Movimiento): void {
    if (this.abierto() === m.id) {
      this.abierto.set(null);
      return;
    }
    this.abierto.set(m.id);
    this.traspaso.set(null);
    if (m.detalle_tipo === 'traspaso' && m.detalle_id) {
      this.inv.traspaso(m.detalle_id).subscribe({
        next: (t) => this.traspaso.set(t),
        error: (e) => this.error.set(this.msg(e)),
      });
    }
  }

  /** Solo los traspasos tienen contenido que valga la pena desplegar. */
  tieneDetalle(m: Movimiento): boolean {
    return m.detalle_tipo === 'traspaso';
  }

  /** Una venta se abre en su pedido, si el puesto puede verlo. */
  enlaceVenta(m: Movimiento): string | null {
    return m.detalle_tipo === 'pedido' && m.detalle_id && this.vePedidos()
      ? `/admin/pedidos/${m.detalle_id}`
      : null;
  }

  /** Cuántos paquetes representan esos kilos, como los cuenta la tienda. */
  paquetesDe(m: Movimiento): string {
    const peso = Number(m.peso_kg ?? 0);
    if (!peso) return '';
    return String(Math.round((Math.abs(Number(m.cantidad)) / peso) * 100) / 100);
  }

  esEntrada(m: Movimiento): boolean {
    return Number(m.cantidad) >= 0;
  }

  /**
   * Color de la pastilla según el DOCUMENTO, no según el texto: la venta en
   * azul, lo que entra de fuera (remesa, conos que se producen) en verde, lo que
   * solo cambia de sitio en gris, el ajuste en ámbar y la merma en rojo.
   */
  tono(m: Movimiento): string {
    switch (m.detalle_tipo) {
      case 'pedido':
        return 'azul';
      case 'remesa':
        return 'verde';
      case 'traspaso':
        return 'gris';
      case 'conversion':
        return this.esEntrada(m) ? 'verde' : 'gris';
    }
    return (
      { ajuste: 'ambar', merma: 'rojo', entrada: 'verde', devolucion: 'azul' } as Record<string, string>
    )[m.tipo] ?? 'gris';
  }

  /** Cantidad absoluta: el signo va aparte, con su color. */
  abs(v: string | number): number {
    return Math.abs(Number(v));
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
