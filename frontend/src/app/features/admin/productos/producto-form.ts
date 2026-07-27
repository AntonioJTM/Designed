import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { CatalogoService } from '../../../core/services/catalogo.service';
import {
  Categoria,
  Opcion,
  Producto,
  ProductoDetalle,
  Variante,
} from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';

@Component({
  selector: 'app-producto-form',
  imports: [ReactiveFormsModule, FormsModule, RouterLink],
  templateUrl: './producto-form.html',
})
export class ProductoForm {
  private readonly fb = inject(FormBuilder);
  private readonly catalogo = inject(CatalogoService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly id = signal<number | null>(null);
  readonly esEdicion = computed(() => this.id() !== null);

  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  /**
   * Aviso de que se guardó. Importa en el alta: el producto se puede guardar sin
   * presentaciones —se capturan aparte— y sin este aviso la pantalla no daba
   * ninguna señal de haber terminado.
   */
  readonly guardado = signal<string | null>(null);

  readonly categorias = signal<Categoria[]>([]);
  readonly lineas = signal<Opcion[]>([]);
  readonly unidades = signal<Opcion[]>([]);
  readonly impuestos = signal<Opcion[]>([]);

  readonly variantes = signal<Variante[]>([]);

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

  /** El producto se maneja en paquetes y conos. */
  readonly esMultipresentacion = computed(() => !!this.formValor().multipresentacion);

  /** El producto etiqueta sus presentaciones por lote. */
  readonly esPorLotes = computed(() => !!this.formValor().por_lotes);

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
    const opciones$ = forkJoin({
      categorias: this.catalogo.listarCategorias(),
      lineas: this.catalogo.opciones('lineas'),
      unidades: this.catalogo.opciones('unidades'),
      impuestos: this.catalogo.opciones('impuestos'),
    });

    opciones$.subscribe({
      next: (o) => {
        this.categorias.set(o.categorias.items);
        this.lineas.set(o.lineas);
        this.unidades.set(o.unidades);
        this.impuestos.set(o.impuestos);

        const param = this.route.snapshot.paramMap.get('id');
        if (param && param !== 'nuevo') {
          this.id.set(Number(param));
          this.cargarProducto(Number(param));
        } else {
          // Producto nuevo: el kilogramo es la unidad habitual de la tienda.
          const kg = o.unidades.find((u) => u.abreviatura === 'kg') ?? o.unidades[0];
          if (kg) this.form.patchValue({ unidad_medida_id: kg.id });
          this.cargando.set(false);
        }
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  private cargarProducto(id: number): void {
    this.catalogo.obtenerProducto(id).subscribe({
      next: (p: ProductoDetalle) => {
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
        // Solo para el conteo del enlace a presentaciones.
        this.variantes.set(p.variantes);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    this.guardado.set(null);

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

    const id = this.id();
    const obs = id ? this.catalogo.actualizarProducto(id, body) : this.catalogo.crearProducto(body);
    obs.subscribe({
      next: (p) => {
        this.guardando.set(false);
        if (!id) {
          this.guardado.set(
            `Producto "${p.nombre}" guardado. Sus presentaciones (SKU) se capturan en ` +
              `"Administrar presentaciones".`
          );
          // Pasa a modo edición EN EL MOMENTO (la ruta reutiliza el componente y
          // no re-ejecuta el constructor). Así se muestran de inmediato las
          // secciones de variantes e imágenes, por si se quiere seguir capturando.
          this.id.set(p.id);
          this.router.navigate(['/admin/productos', p.id], { replaceUrl: true });
          this.cargarProducto(p.id);
        } else {
          this.guardado.set('Cambios guardados.');
        }
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.guardando.set(false);
      },
    });
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
