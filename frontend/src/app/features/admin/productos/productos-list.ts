import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { Categoria, Opcion, Paginado, Producto } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';
import { ProductoFormModal } from './producto-form-modal';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { fechaRelativa } from '../../../shared/fecha.pipe';

/** Lo que filtra el selector "Estado". */
type FiltroEstado = 'activos' | 'inactivos' | 'todos';

/** El API no entrega más de 100 renglones por página. */
const POR_PAGINA = 100;

@Component({
  selector: 'app-productos-list',
  imports: [RouterLink, FormsModule, ProductoFormModal, DineroPipe, CantidadPipe],
  templateUrl: './productos-list.html',
})
export class ProductosList implements OnDestroy {
  private readonly catalogo = inject(CatalogoService);
  private readonly inv = inject(InventarioService);
  private readonly router = inject(Router);

  readonly productos = signal<Producto[]>([]);
  readonly categorias = signal<Categoria[]>([]);
  readonly lineas = signal<Opcion[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  /**
   * Kilos que hay de cada hilo, sumando TODOS los almacenes y las dos
   * presentaciones (paquete y cono). Sale del panorama de Inventario, que ya los
   * suma por presentación: el listado de productos solo trae lo disponible en
   * el almacén de la tienda en línea, que no es lo que la tienda quiere saber.
   * `null` = no se pudo leer; entonces la columna dice "—" en vez de un 0 falso.
   */
  readonly existencias = signal<Map<number, number> | null>(null);
  /** El panorama se recortó: a un hilo que no venga no se le puede decir "0 kg". */
  private existenciasIncompletas = false;

  /**
   * Alta y edición viven en un modal sobre el listado: `null` = cerrado,
   * `'nuevo'` = alta, un id = edición de ese producto.
   */
  readonly modal = signal<number | 'nuevo' | null>(null);

  // Los filtros son SEÑALES y no propiedades sueltas con [(ngModel)]: el
  // listado visible es un `computed` que los lee, y un `computed` solo se
  // recalcula cuando cambia una señal.
  readonly q = signal('');
  readonly categoriaId = signal<number | ''>('');
  readonly lineaId = signal<number | ''>('');
  readonly estado = signal<FiltroEstado>('activos');
  /**
   * Solo los hilos que no se pueden vender por falta de precio. A esto manda la
   * campana (`?falta=precio`) después de cargar la lista del proveedor, que
   * crea los hilos sin precio.
   */
  readonly soloSinPrecio = signal(false);

  /** Cuántos de los que trae el filtro no tienen precio. */
  readonly numSinPrecio = computed(() => this.productos().filter((p) => !!p.sin_precio).length);

  /**
   * Lo que se ve: la línea se filtra aquí (el API no la filtra) y se ordena por
   * color y luego por calibre, así "ROJO 1/30" y "ROJO 2/30" quedan juntos.
   * El API los entrega por fecha de alta, que no le sirve a nadie para buscar.
   */
  readonly visibles = computed(() => {
    const linea = this.lineaId();
    const sinPrecio = this.soloSinPrecio();
    return this.productos()
      .filter((p) => linea === '' || p.linea_id === linea)
      .filter((p) => !sinPrecio || !!p.sin_precio)
      .sort(
        (a, b) =>
          a.nombre.localeCompare(b.nombre, 'es') ||
          (a.grosor_calibre ?? '').localeCompare(b.grosor_calibre ?? '', 'es')
      );
  });

  private reloj: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // También si la campana se toca estando ya en Productos: la pantalla no se
    // vuelve a crear, solo cambia la dirección.
    inject(ActivatedRoute)
      .queryParamMap.pipe(takeUntilDestroyed())
      .subscribe((q) => {
        if (q.get('falta') === 'precio') this.soloSinPrecio.set(true);
      });
    this.catalogo.listarCategorias().subscribe({
      next: (p) => this.categorias.set(p.items),
      error: () => {},
    });
    this.catalogo.opciones('lineas').subscribe({
      next: (l) => this.lineas.set(l),
      error: () => {},
    });
    this.cargarExistencias();
    this.buscar();
  }

  ngOnDestroy(): void {
    if (this.reloj) clearTimeout(this.reloj);
  }

  /** Al teclear se espera un respiro antes de ir al servidor: no una consulta por letra. */
  alTeclear(valor: string): void {
    this.q.set(valor);
    if (this.reloj) clearTimeout(this.reloj);
    this.reloj = setTimeout(() => this.buscar(), 300);
  }

  /** Material y estado sí van al servidor; la línea se filtra aquí mismo. */
  cambiarFiltro(): void {
    this.buscar();
  }

  /**
   * Trae TODOS los productos que cumplen el filtro, no solo la primera página:
   * el orden por color se hace aquí, y ordenar media lista mentiría.
   */
  buscar(): void {
    this.cargando.set(true);
    this.error.set(null);
    const estado = this.estado();
    const filtro = {
      q: this.q().trim() || undefined,
      categoria_id: this.categoriaId() || undefined,
      activo: estado === 'todos' ? undefined : estado === 'activos',
      limit: POR_PAGINA,
    };
    this.catalogo
      .listarProductos({ ...filtro, page: 1 })
      .pipe(
        switchMap((primera) => {
          if (primera.paginas <= 1) return of([primera]);
          const resto: ReturnType<CatalogoService['listarProductos']>[] = [];
          for (let page = 2; page <= primera.paginas; page++) {
            resto.push(this.catalogo.listarProductos({ ...filtro, page }));
          }
          return forkJoin(resto).pipe(map((otras) => [primera, ...otras]));
        })
      )
      .subscribe({
        next: (paginas: Paginado<Producto>[]) => {
          this.productos.set(paginas.flatMap((p) => p.items));
          this.cargando.set(false);
        },
        error: (e) => {
          this.error.set(this.msg(e));
          this.cargando.set(false);
        },
      });
  }

  private cargarExistencias(): void {
    this.inv
      .resumen()
      .pipe(catchError(() => of(null)))
      .subscribe((r) => {
        if (!r) {
          this.existencias.set(null);
          return;
        }
        const porHilo = new Map<number, number>();
        for (const f of r.filas) {
          if (f.producto_id == null) continue;
          porHilo.set(f.producto_id, (porHilo.get(f.producto_id) ?? 0) + Number(f.total || 0));
        }
        this.existenciasIncompletas = r.truncado;
        this.existencias.set(porHilo);
      });
  }

  /** Kilos del hilo, o `null` cuando no se sabe (para pintar "—"). */
  hay(p: Producto): number | null {
    const m = this.existencias();
    if (!m) return null;
    const kg = m.get(p.id);
    if (kg !== undefined) return kg;
    return this.existenciasIncompletas ? null : 0;
  }

  /** "Llegó en la carga de hoy", "… del 03/10": cuándo entró sin precio. */
  llego(p: Producto): string {
    return p.primera_carga ? `Llegó en la carga de ${fechaRelativa(p.primera_carga, false).replace(/^el /, 'del ')}` : 'Sin precio';
  }

  /** Id del producto que edita el modal (`null` cuando es un alta). */
  idModal(): number | null {
    const m = this.modal();
    return typeof m === 'number' ? m : null;
  }

  abrirNuevo(): void {
    this.mensaje.set(null);
    this.modal.set('nuevo');
  }

  abrirEdicion(p: Producto): void {
    this.mensaje.set(null);
    this.modal.set(p.id);
  }

  /** Guardó en el modal: el listado se recarga para reflejarlo. */
  alGuardar(p: Producto): void {
    this.mensaje.set(`Producto "${p.nombre}" guardado.`);
    this.buscar();
  }

  /** Se eliminó desde el modal de edición. */
  alEliminar(nombre: string): void {
    this.modal.set(null);
    this.mensaje.set(`Producto "${nombre}" eliminado.`);
    this.buscar();
    this.cargarExistencias();
  }

  aPresentaciones(id: number): void {
    this.modal.set(null);
    this.router.navigate(['/admin/productos', id, 'presentaciones']);
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
