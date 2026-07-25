import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { CatalogoService } from '../../../core/services/catalogo.service';
import {
  Categoria,
  TipoCliente,
  Imagen,
  Opcion,
  ModoPrecio,
  Producto,
  ProductoDetalle,
  TipoPresentacion,
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
  readonly lineas = signal<Opcion[]>([]);
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
    linea_id: [null as number | null],
    nombre: ['', [Validators.required, Validators.minLength(1)]],
    descripcion: [''],
    grosor_calibre: [''],
    // Habilita las presentaciones paquete/cono de este producto.
    multipresentacion: [false],
    // Habilita etiquetar sus presentaciones por lote.
    por_lotes: [false],
    destacado: [false],
    activo: [true],
  });

  readonly varForm = this.fb.nonNullable.group({
    sku: ['', Validators.required],
    color_id: [null as number | null],
    presentacion: [''],
    lote: [''],
    codigo_barras: [''],
    // Presentación: 'paquete' se vende por kilo y se puede desarmar en conos;
    // 'cono' sale de un paquete y se vende por pieza.
    tipo_presentacion: ['paquete' as TipoPresentacion],
    peso_kg: [null as number | null],
    origen_variante_id: [null as number | null],
    piezas_por_origen: [null as number | null],
    modo_precio: ['calculado' as ModoPrecio],
    precio: [null as number | null, [Validators.min(0)]],
    precio_oferta: [null as number | null],
    costo: [null as number | null],
  });

  /** Valor vivo del formulario de variante (alimenta la vista previa). */
  private readonly varFormValor = toSignal(this.varForm.valueChanges, {
    initialValue: this.varForm.getRawValue(),
  });

  readonly tiposCliente = signal<TipoCliente[]>([]);
  /** Precio que se está capturando por tipo, dentro de una variante. */
  readonly editandoPrecios = signal<number | null>(null);
  precioTipo: Record<number, number | null> = {};

  /** Tipos que llevan precio propio: todos menos el público. */
  readonly tiposConPrecio = computed(() => this.tiposCliente().filter((t) => !t.es_publico));

  /** Valor vivo del formulario del producto, para reaccionar al material. */
  private readonly formValor = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
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

  /** Paquetes ya dados de alta en este producto: son los orígenes posibles. */
  readonly paquetes = computed(() =>
    this.variantes().filter((v) => v.tipo_presentacion === 'paquete')
  );

  /** Vista previa del cálculo del cono, para que se vea antes de guardar. */
  readonly previaCono = computed(() => {
    const v = this.varFormValor();
    if (v.tipo_presentacion !== 'cono' || v.modo_precio !== 'calculado') return null;
    const paq = this.paquetes().find((p) => p.id === Number(v.origen_variante_id));
    const piezas = Number(v.piezas_por_origen);
    if (!paq || !paq.peso_kg || !piezas) return null;

    const precioKg = Number(paq.precio);
    const pesoPaq = Number(paq.peso_kg);
    return {
      paquete: paq.sku,
      precioKg,
      pesoPaq,
      valorPaquete: precioKg * pesoPaq,
      piezas,
      pesoCono: pesoPaq / piezas,
      precioCono: Math.round(((precioKg * pesoPaq) / piezas) * 100) / 100,
    };
  });

  readonly imgForm = this.fb.nonNullable.group({
    url: ['', Validators.required],
    es_principal: [false],
  });

  constructor() {
    const opciones$ = forkJoin({
      categorias: this.catalogo.listarCategorias(),
      lineas: this.catalogo.opciones('lineas'),
      unidades: this.catalogo.opciones('unidades'),
      impuestos: this.catalogo.opciones('impuestos'),
      colores: this.catalogo.opciones('colores'),
      tiposCliente: this.catalogo.tiposCliente(),
    });

    opciones$.subscribe({
      next: (o) => {
        this.categorias.set(o.categorias.items);
        this.lineas.set(o.lineas);
        this.unidades.set(o.unidades);
        this.impuestos.set(o.impuestos);
        this.colores.set(o.colores);
        this.tiposCliente.set(o.tiposCliente);

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
          multipresentacion: !!p.multipresentacion,
          por_lotes: !!p.por_lotes,
          destacado: !!p.destacado,
          activo: !!p.activo,
        });
        // Si el calibre guardado no está entre los del material, se conserva
        // como opción extra para no borrárselo sin avisar al guardar.
        this.calibreHeredado.set(p.grosor_calibre?.trim() || null);
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
      linea_id: v.linea_id || null,
      nombre: v.nombre,
      descripcion: v.descripcion.trim() || undefined,
      grosor_calibre: v.grosor_calibre.trim() || undefined,
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

  /** Qué le falta a la variante, en lenguaje del usuario, o null si está lista. */
  faltaEnVariante(): string | null {
    const v = this.varForm.getRawValue();
    if (!v.sku.trim()) return 'Ponle un SKU a la variante.';

    if (v.tipo_presentacion === 'paquete') {
      if (!v.peso_kg) return 'Indica cuánto pesa el paquete en kilos.';
      if (v.precio == null) return 'Indica el precio por kilo del paquete.';
    }
    if (v.tipo_presentacion === 'cono') {
      if (!v.origen_variante_id) return 'Elige de qué paquete se desarma el cono.';
      if (!v.piezas_por_origen) return 'Indica cuántos conos salen de un paquete.';
      if (v.modo_precio === 'manual' && v.precio == null) {
        return 'Con precio por pieza tienes que capturar el precio del cono.';
      }
    }
    if (v.tipo_presentacion === 'simple' && v.precio == null) {
      return 'Indica el precio de la variante.';
    }
    return null;
  }

  agregarVariante(): void {
    const falta = this.faltaEnVariante();
    if (falta) {
      this.error.set(falta);
      this.varForm.markAllAsTouched();
      return;
    }
    this.error.set(null);
    const v = this.varForm.getRawValue();
    const esCono = v.tipo_presentacion === 'cono';
    // Con cono de precio calculado el backend lo deriva del paquete.
    const precioDerivado = esCono && v.modo_precio === 'calculado';

    this.catalogo
      .crearVariante({
        producto_id: this.id()!,
        sku: v.sku.trim(),
        color_id: v.color_id || null,
        presentacion: v.presentacion.trim() || undefined,
        codigo_barras: v.codigo_barras.trim() || null,
        lote: v.lote.trim() || null,
        tipo_presentacion: v.tipo_presentacion,
        peso_kg: v.tipo_presentacion === 'paquete' ? v.peso_kg : null,
        origen_variante_id: esCono ? v.origen_variante_id : null,
        piezas_por_origen: esCono ? v.piezas_por_origen : null,
        modo_precio: esCono ? v.modo_precio : 'manual',
        // Nunca convertir null a texto: String(null) manda "null" y el API
        // lo rechaza con un 422 genérico.
        precio: precioDerivado || v.precio == null ? undefined : String(v.precio),
        precio_oferta: v.precio_oferta != null ? String(v.precio_oferta) : null,
        costo: v.costo != null ? String(v.costo) : null,
      })
      .subscribe({
        next: (nv) => {
          this.variantes.update((arr) => [...arr, nv]);
          this.varForm.reset({
            sku: '', color_id: null, presentacion: '', lote: '', codigo_barras: '',
            tipo_presentacion: this.esMultipresentacion() ? 'paquete' : 'simple',
            peso_kg: null, origen_variante_id: null,
            piezas_por_origen: null, modo_precio: 'calculado',
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

  /** Abre (o cierra) la captura de precios por tipo de una variante. */
  togglePrecios(v: Variante): void {
    if (this.editandoPrecios() === v.id) {
      this.editandoPrecios.set(null);
      return;
    }
    this.editandoPrecios.set(v.id);
    this.precioTipo = {};
    for (const t of this.tiposConPrecio()) {
      const p = v.precios?.find((x) => x.tipo_cliente_id === t.id);
      this.precioTipo[t.id] = p ? Number(p.precio) : null;
    }
  }

  /** Precio capturado de una variante para un tipo, o null si paga el público. */
  precioDe(v: Variante, tipoId: number): number | null {
    const p = v.precios?.find((x) => x.tipo_cliente_id === tipoId);
    return p ? Number(p.precio) : null;
  }

  guardarPrecioTipo(v: Variante, tipoId: number): void {
    const valor = this.precioTipo[tipoId];
    this.error.set(null);
    this.catalogo
      .fijarPrecioTipo(v.id, tipoId, valor == null || valor === ('' as unknown) ? null : Number(valor))
      .subscribe({
        next: (nv) => this.variantes.update((arr) => arr.map((x) => (x.id === nv.id ? nv : x))),
        error: (e) => this.error.set(this.msg(e)),
      });
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
