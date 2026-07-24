import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { CatalogoService } from '../../../core/services/catalogo.service';
import {
  Categoria,
  Imagen,
  Opcion,
  Producto,
  ProductoDetalle,
  Variante,
  VarianteCodigo,
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

  readonly categorias = signal<Categoria[]>([]);
  readonly marcas = signal<Opcion[]>([]);
  readonly materiales = signal<Opcion[]>([]);
  readonly unidades = signal<Opcion[]>([]);
  readonly impuestos = signal<Opcion[]>([]);
  readonly colores = signal<Opcion[]>([]);

  readonly variantes = signal<Variante[]>([]);
  readonly imagenes = signal<Imagen[]>([]);

  // Códigos de barras adicionales por variante (opción A: agrupados por color).
  readonly codigos = signal<Record<number, VarianteCodigo[]>>({});
  readonly expandida = signal<number | null>(null);
  nuevoCodigo = '';
  nuevaEtiqueta = '';

  readonly form = this.fb.nonNullable.group({
    categoria_id: [null as number | null, Validators.required],
    unidad_medida_id: [null as number | null, Validators.required],
    impuesto_id: [null as number | null],
    marca_id: [null as number | null],
    material_id: [null as number | null],
    nombre: ['', [Validators.required, Validators.minLength(1)]],
    slug: [''],
    descripcion: [''],
    grosor_calibre: [''],
    peso_gramos: [null as number | null],
    longitud_metros: [null as number | null],
    destacado: [false],
    activo: [true],
  });

  readonly varForm = this.fb.nonNullable.group({
    sku: ['', Validators.required],
    color_id: [null as number | null],
    presentacion: [''],
    codigo_barras: [''],
    precio: [null as number | null, [Validators.required, Validators.min(0)]],
    precio_oferta: [null as number | null],
    costo: [null as number | null],
  });

  readonly imgForm = this.fb.nonNullable.group({
    url: ['', Validators.required],
    es_principal: [false],
  });

  constructor() {
    const opciones$ = forkJoin({
      categorias: this.catalogo.listarCategorias(),
      marcas: this.catalogo.opciones('marcas'),
      materiales: this.catalogo.opciones('materiales'),
      unidades: this.catalogo.opciones('unidades'),
      impuestos: this.catalogo.opciones('impuestos'),
      colores: this.catalogo.opciones('colores'),
    });

    opciones$.subscribe({
      next: (o) => {
        this.categorias.set(o.categorias.items);
        this.marcas.set(o.marcas);
        this.materiales.set(o.materiales);
        this.unidades.set(o.unidades);
        this.impuestos.set(o.impuestos);
        this.colores.set(o.colores);

        const param = this.route.snapshot.paramMap.get('id');
        if (param && param !== 'nuevo') {
          this.id.set(Number(param));
          this.cargarProducto(Number(param));
        } else {
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
          marca_id: p.marca_id ?? null,
          material_id: p.material_id ?? null,
          nombre: p.nombre,
          slug: p.slug,
          descripcion: p.descripcion ?? '',
          grosor_calibre: p.grosor_calibre ?? '',
          peso_gramos: p.peso_gramos ? Number(p.peso_gramos) : null,
          longitud_metros: p.longitud_metros ? Number(p.longitud_metros) : null,
          destacado: !!p.destacado,
          activo: !!p.activo,
        });
        this.variantes.set(p.variantes);
        this.imagenes.set(p.imagenes);
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

    const v = this.form.getRawValue();
    const body: Partial<Producto> = {
      categoria_id: v.categoria_id!,
      unidad_medida_id: v.unidad_medida_id!,
      impuesto_id: v.impuesto_id || null,
      marca_id: v.marca_id || null,
      material_id: v.material_id || null,
      nombre: v.nombre,
      slug: v.slug.trim() || undefined,
      descripcion: v.descripcion.trim() || undefined,
      grosor_calibre: v.grosor_calibre.trim() || undefined,
      peso_gramos: v.peso_gramos,
      longitud_metros: v.longitud_metros,
      destacado: v.destacado,
      activo: v.activo,
    };

    const id = this.id();
    const obs = id ? this.catalogo.actualizarProducto(id, body) : this.catalogo.crearProducto(body);
    obs.subscribe({
      next: (p) => {
        this.guardando.set(false);
        if (!id) {
          // Pasa a modo edición EN EL MOMENTO (la ruta reutiliza el componente y
          // no re-ejecuta el constructor). Así se muestran de inmediato las
          // secciones de variantes e imágenes para seguir capturando.
          this.id.set(p.id);
          this.router.navigate(['/admin/productos', p.id], { replaceUrl: true });
          this.cargarProducto(p.id);
        }
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.guardando.set(false);
      },
    });
  }

  /**
   * Captura el Enter del lector de código de barras: evita que se envíe el
   * formulario y, si el SKU está vacío, copia el código escaneado también al SKU.
   * (Un lector actúa como teclado: teclea el código y manda Enter.)
   */
  capturarCodigo(ev: Event): void {
    ev.preventDefault();
    const codigo = (this.varForm.controls.codigo_barras.value || '').trim();
    if (codigo && !this.varForm.controls.sku.value.trim()) {
      this.varForm.controls.sku.setValue(codigo);
    }
  }

  agregarVariante(): void {
    if (this.varForm.invalid) {
      this.varForm.markAllAsTouched();
      return;
    }
    const v = this.varForm.getRawValue();
    this.catalogo
      .crearVariante({
        producto_id: this.id()!,
        sku: v.sku.trim(),
        color_id: v.color_id || null,
        presentacion: v.presentacion.trim() || undefined,
        codigo_barras: v.codigo_barras.trim() || null,
        precio: String(v.precio),
        precio_oferta: v.precio_oferta != null ? String(v.precio_oferta) : null,
        costo: v.costo != null ? String(v.costo) : null,
      })
      .subscribe({
        next: (nv) => {
          this.variantes.update((arr) => [...arr, nv]);
          this.varForm.reset({
            sku: '', color_id: null, presentacion: '', codigo_barras: '',
            precio: null, precio_oferta: null, costo: null,
          });
        },
        error: (e) => this.error.set(this.msg(e)),
      });
  }

  eliminarVariante(v: Variante): void {
    if (!confirm(`¿Eliminar la variante ${v.sku}?`)) return;
    this.catalogo.eliminarVariante(v.id).subscribe({
      next: () => this.variantes.update((arr) => arr.filter((x) => x.id !== v.id)),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  // ---- Códigos de barras adicionales de una variante ----

  toggleCodigos(v: Variante): void {
    if (this.expandida() === v.id) {
      this.expandida.set(null);
      return;
    }
    this.expandida.set(v.id);
    this.nuevoCodigo = '';
    this.nuevaEtiqueta = '';
    if (!this.codigos()[v.id]) {
      this.catalogo.listarCodigos(v.id).subscribe({
        next: (cs) => this.codigos.update((m) => ({ ...m, [v.id]: cs })),
        error: (e) => this.error.set(this.msg(e)),
      });
    }
  }

  codigosDe(varianteId: number): VarianteCodigo[] {
    return this.codigos()[varianteId] ?? [];
  }

  agregarCodigoVar(varianteId: number): void {
    const codigo = this.nuevoCodigo.trim();
    if (!codigo) return;
    this.error.set(null);
    this.catalogo
      .agregarCodigo(varianteId, { codigo, etiqueta: this.nuevaEtiqueta.trim() || undefined })
      .subscribe({
        next: (c) => {
          this.codigos.update((m) => ({ ...m, [varianteId]: [...(m[varianteId] ?? []), c] }));
          this.nuevoCodigo = '';
          this.nuevaEtiqueta = '';
        },
        error: (e) => this.error.set(this.msg(e)),
      });
  }

  /** Enter del lector: evita submit y agrega el código escaneado. */
  capturarCodigoVar(ev: Event, varianteId: number): void {
    ev.preventDefault();
    this.agregarCodigoVar(varianteId);
  }

  eliminarCodigoVar(codigoId: number, varianteId: number): void {
    this.catalogo.eliminarCodigo(codigoId).subscribe({
      next: () =>
        this.codigos.update((m) => ({
          ...m,
          [varianteId]: (m[varianteId] ?? []).filter((c) => c.id !== codigoId),
        })),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  agregarImagen(): void {
    if (this.imgForm.invalid) {
      this.imgForm.markAllAsTouched();
      return;
    }
    const v = this.imgForm.getRawValue();
    this.catalogo
      .crearImagen({ producto_id: this.id()!, url: v.url.trim(), es_principal: v.es_principal })
      .subscribe({
        next: () => {
          // Recarga para reflejar el cambio de "principal" en las demás.
          this.cargarProducto(this.id()!);
          this.imgForm.reset({ url: '', es_principal: false });
        },
        error: (e) => this.error.set(this.msg(e)),
      });
  }

  eliminarImagen(img: Imagen): void {
    this.catalogo.eliminarImagen(img.id).subscribe({
      next: () => this.imagenes.update((arr) => arr.filter((x) => x.id !== img.id)),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
