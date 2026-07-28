import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { CatalogoService } from '../../../core/services/catalogo.service';
import {
  Categoria,
  Opcion,
  Producto,
  ProductoDetalle,
} from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';

/**
 * Alta y edición del producto EN UN MODAL, sin salir del listado. Antes era una
 * pantalla aparte (`/admin/productos/:id`): capturar un color y volver costaba
 * dos navegaciones y se perdía el filtro de búsqueda.
 *
 * Solo los datos del hilo. Las presentaciones y las imágenes siguen en su
 * propia pantalla (`/admin/productos/:id/presentaciones`), que es donde se
 * sube el Excel del proveedor.
 */
@Component({
  selector: 'app-producto-form-modal',
  imports: [ReactiveFormsModule, FormsModule],
  templateUrl: './producto-form-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class ProductoFormModal implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly catalogo = inject(CatalogoService);

  /** Producto a editar; `null` = alta. */
  readonly productoId = input<number | null>(null);

  /** El modal se cierra sin más. */
  readonly cerrado = output<void>();
  /** Se guardó: el listado se recarga. */
  readonly guardado = output<Producto>();
  /** Se pide ir a capturar las presentaciones del producto recién guardado. */
  readonly irAPresentaciones = output<number>();

  readonly esEdicion = computed(() => this.productoId() !== null);

  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  /**
   * Producto recién creado. Mientras está puesto, el modal muestra el aviso
   * con el atajo a presentaciones en vez del formulario: el producto se guarda
   * sin presentaciones —se capturan aparte— y sin esta señal el modal se
   * cerraba sin decir qué sigue.
   */
  readonly creado = signal<Producto | null>(null);

  readonly categorias = signal<Categoria[]>([]);
  readonly lineas = signal<Opcion[]>([]);
  readonly unidades = signal<Opcion[]>([]);
  readonly impuestos = signal<Opcion[]>([]);

  readonly form = this.fb.nonNullable.group({
    categoria_id: [null as number | null, Validators.required],
    unidad_medida_id: [null as number | null, Validators.required],
    impuesto_id: [null as number | null],
    linea_id: [null as number | null],
    nombre: ['', [Validators.required, Validators.minLength(1)]],
    // Precio de lista del hilo por unidad de peso. Las presentaciones lo heredan.
    precio_kg: [null as number | null],
    descripcion: [''],
    grosor_calibre: [''],
    // Habilita las presentaciones paquete/cono de este producto.
    multipresentacion: [false],
    // Habilita etiquetar sus presentaciones por lote.
    por_lotes: [false],
    destacado: [false],
    activo: [true],
  });

  /** Valor vivo del formulario del producto, para reaccionar al material. */
  private readonly formValor = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  /** Abreviatura de la unidad elegida, para rotular el precio ("por kg"). */
  readonly unidadSel = computed(() => {
    const id = Number(this.formValor().unidad_medida_id);
    return this.unidades().find((u) => u.id === id)?.abreviatura ?? 'kg';
  });

  /** Calibre que ya traía el producto y no está en la lista de su material. */
  private readonly calibreHeredado = signal<string | null>(null);

  /**
   * Calibres del material elegido: acrilán 1/30 y 2/30, viscosa 2/48. Se leen
   * de la categoría (`calibres`) para poder cambiarlos sin tocar código.
   */
  readonly calibres = computed(() => {
    const catId = Number(this.formValor().categoria_id);
    const material = this.categorias().find((c) => c.id === catId);
    const lista = (material?.calibres ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    const heredado = this.calibreHeredado();
    return heredado && !lista.includes(heredado) ? [...lista, heredado] : lista;
  });

  constructor() {
    // Los campos se ven desde el primer cuadro —así el modal no crece a saltos—
    // pero no se pueden tocar hasta que llegan los datos. El velo los tapa.
    this.form.disable({ emitEvent: false });
  }

  /**
   * La carga va aquí y NO en el constructor: los inputs de señal todavía no
   * están asignados cuando corre el constructor, así que `productoId()` valía
   * `null` y la edición se comportaba como un alta (campos vacíos).
   */
  ngOnInit(): void {
    const id = this.productoId();

    // Una sola espera para las opciones y —si es edición— el producto. Antes el
    // producto se pedía DESPUÉS de las opciones, así que el modal esperaba dos
    // viajes al servidor en fila.
    forkJoin({
      categorias: this.catalogo.listarCategorias(),
      lineas: this.catalogo.opciones('lineas'),
      unidades: this.catalogo.opciones('unidades'),
      impuestos: this.catalogo.opciones('impuestos'),
      producto: id !== null ? this.catalogo.obtenerProducto(id) : of(null),
    }).subscribe({
      next: (o) => {
        this.categorias.set(o.categorias.items);
        this.lineas.set(o.lineas);
        this.unidades.set(o.unidades);
        this.impuestos.set(o.impuestos);

        if (o.producto) this.llenar(o.producto);
        else {
          // Producto nuevo: el kilogramo es la unidad habitual de la tienda.
          const kg = o.unidades.find((u) => u.abreviatura === 'kg') ?? o.unidades[0];
          if (kg) this.form.patchValue({ unidad_medida_id: kg.id });
        }
        this.form.enable({ emitEvent: false });
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  private llenar(p: ProductoDetalle): void {
    this.form.reset({
      categoria_id: p.categoria_id,
      unidad_medida_id: p.unidad_medida_id,
      impuesto_id: p.impuesto_id ?? null,
      linea_id: p.linea_id ?? null,
      nombre: p.nombre,
      descripcion: p.descripcion ?? '',
      grosor_calibre: p.grosor_calibre ?? '',
      precio_kg: p.precio_kg != null ? Number(p.precio_kg) : null,
      multipresentacion: !!p.multipresentacion,
      por_lotes: !!p.por_lotes,
      destacado: !!p.destacado,
      activo: !!p.activo,
    });
    // Si el calibre guardado no está entre los del material, se conserva
    // como opción extra para no borrárselo sin avisar al guardar.
    this.calibreHeredado.set(p.grosor_calibre?.trim() || null);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.guardando.set(true);
    this.error.set(null);

    const v = this.form.getRawValue();
    const body: Partial<Producto> = {
      categoria_id: v.categoria_id!,
      unidad_medida_id: v.unidad_medida_id!,
      impuesto_id: v.impuesto_id || null,
      linea_id: v.linea_id || null,
      nombre: v.nombre,
      descripcion: v.descripcion.trim() || undefined,
      grosor_calibre: v.grosor_calibre.trim() || undefined,
      precio_kg: v.precio_kg != null ? Number(v.precio_kg) : null,
      multipresentacion: v.multipresentacion,
      por_lotes: v.por_lotes,
      destacado: v.destacado,
      activo: v.activo,
    };

    const id = this.productoId();
    const obs = id ? this.catalogo.actualizarProducto(id, body) : this.catalogo.crearProducto(body);
    obs.subscribe({
      next: (p) => {
        this.guardando.set(false);
        // El listado se recarga en los dos casos. Al editar no hay nada más que
        // decir y el modal se cierra; al crear se ofrece el siguiente paso.
        this.guardado.emit(p);
        if (id) this.cerrar();
        else this.creado.set(p);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.guardando.set(false);
      },
    });
  }

  /** Guardó uno y quiere capturar el siguiente color sin cerrar el modal. */
  otro(): void {
    this.creado.set(null);
    this.error.set(null);
    const unidad = this.form.getRawValue().unidad_medida_id;
    // Se conservan material, línea, impuesto y calibre: al capturar la remesa
    // vienen varios colores del mismo hilo, y volver a elegirlos cada vez sobra.
    this.form.patchValue({ nombre: '', descripcion: '', precio_kg: null, destacado: false });
    this.form.patchValue({ unidad_medida_id: unidad });
    this.form.markAsUntouched();
  }

  cerrar(): void {
    this.cerrado.emit();
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
