import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { CatalogoService } from '../../../core/services/catalogo.service';
import {
  InventarioService,
  PreviaRemesa,
  ResultadoRemesa,
} from '../../../core/services/inventario.service';
import { Almacen } from '../../../core/models/inventario.models';
import {
  Imagen,
  LoteDeBultos,
  ModoPrecio,
  Opcion,
  ProductoDetalle,
  TipoCliente,
  TipoPresentacion,
  Variante,
  VarianteCodigo,
} from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { cotejarArchivo, textoAviso } from '../../../shared/remesa-archivo';

/**
 * Presentaciones (SKU) e imágenes de un producto, en su propia pantalla.
 *
 * Se separó del formulario del producto: ahí solo se capturan los datos del hilo
 * —nombre, material, calibre, precio por kilo—. Las presentaciones nuevas heredan
 * el `precio_kg` del producto si no se les captura precio.
 */
@Component({
  selector: 'app-producto-presentaciones',
  imports: [ReactiveFormsModule, FormsModule, RouterLink, CantidadPipe],
  templateUrl: './producto-presentaciones.html',
})
export class ProductoPresentaciones {
  private readonly fb = inject(FormBuilder);
  private readonly catalogo = inject(CatalogoService);
  private readonly inv = inject(InventarioService);
  private readonly route = inject(ActivatedRoute);

  readonly id = signal<number | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  // Datos del producto, solo para encabezar la pantalla y heredar el precio.
  readonly nombreProducto = signal('');
  /** Calibre del producto, para cotejarlo con el nombre del archivo que se sube. */
  readonly calibreProducto = signal<string | null>(null);
  readonly precioProducto = signal<string | number | null>(null);
  readonly unidadProducto = signal('kg');
  /** El producto admite paquete/cono; sin esto el backend solo acepta 'simple'. */
  readonly esMultipresentacion = signal(false);
  /** El producto etiqueta sus presentaciones por lote. */
  readonly esPorLotes = signal(false);

  readonly tiposCliente = signal<TipoCliente[]>([]);
  readonly variantes = signal<Variante[]>([]);
  readonly imagenes = signal<Imagen[]>([]);

  // Bultos por variante: cada código es un bulto con su peso y su lote.
  readonly codigos = signal<Record<number, VarianteCodigo[]>>({});
  readonly expandida = signal<number | null>(null);
  nuevoCodigo = '';
  nuevoLote = '';
  nuevoPeso: number | null = null;
  /** Conos que rinde el bulto: varía entre bultos, así vienen de fábrica. */
  nuevoConos: number | null = null;

  /** El SKU se tecleó a mano, así que ya no sigue al código de barras. */
  skuManual = false;

  /** Precio que se está capturando por tipo de cliente. */
  readonly editandoPrecios = signal<number | null>(null);
  precioTipo: Record<number, number | null> = {};

  /** Tipos que llevan precio propio: todos menos el público. */
  readonly tiposConPrecio = computed(() => this.tiposCliente().filter((t) => !t.es_publico));

  /**
   * El producto ya tiene su presentación. Cuando la tiene, no se dan de alta más:
   * las remesas siguientes agregan BULTOS a esa misma presentación. Lo único que
   * puede hacer falta después es el cono, y va en su propia sección.
   */
  readonly yaTienePresentacion = computed(() =>
    this.variantes().some((v) => v.tipo_presentacion !== 'cono')
  );

  /** El paquete del producto: de él salen los conos. */
  readonly paquete = computed(() =>
    this.variantes().find((v) => v.tipo_presentacion === 'paquete') ?? null
  );

  /** Los conos ya dados de alta. */
  readonly conos = computed(() => this.variantes().filter((v) => v.tipo_presentacion === 'cono'));

  // ---- Carga masiva desde la lista de empaque del proveedor ----
  readonly almacenes = signal<Almacen[]>([]);
  readonly previa = signal<PreviaRemesa | null>(null);
  readonly ultimaCarga = signal<ResultadoRemesa | null>(null);
  readonly leyendo = signal(false);
  readonly cargandoRemesa = signal(false);
  readonly mensaje = signal<string | null>(null);
  readonly verTodosBultos = signal(false);
  almacenCarga: number | '' = '';
  archivo: File | null = null;

  /** Los avisos que impiden cargar (códigos ya registrados). */
  readonly bloqueantes = computed(() =>
    (this.previa()?.avisos ?? []).filter((a) => a.bloqueante)
  );
  /** Los informativos: renglones que se omitieron por venir mal. */
  readonly advertencias = computed(() =>
    (this.previa()?.avisos ?? []).filter((a) => !a.bloqueante)
  );
  /** Por omisión se listan los primeros; el archivo real trae 80. */
  readonly bultosVisibles = computed(() => {
    const b = this.previa()?.bultos ?? [];
    return this.verTodosBultos() ? b : b.slice(0, 15);
  });

  /**
   * Coteja el nombre del archivo contra ESTE producto. El proveedor nombra sus
   * listas "COLOR CALIBRE.xlsx", y aquí el producto ya está fijado: si el nombre
   * apunta a otro hilo, casi seguro se abrió la pantalla equivocada. Pasó de
   * verdad: la lista de ROSA MEXICANO 2/30 entró al producto DEV_2 1/30.
   * Solo avisa; la convención no es garantía.
   */
  avisoArchivo(): string | null {
    if (!this.archivo) return null;
    return textoAviso(
      cotejarArchivo(this.archivo.name, {
        producto: this.nombreProducto(),
        calibre: this.calibreProducto(),
      })
    );
  }

  elegirArchivo(e: Event): void {
    this.archivo = (e.target as HTMLInputElement).files?.[0] ?? null;
    this.previa.set(null);
    this.ultimaCarga.set(null);
    this.error.set(null);
    this.mensaje.set(null);
    if (this.archivo) this.leerArchivo();
  }

  leerArchivo(): void {
    if (!this.archivo) return;
    this.leyendo.set(true);
    this.error.set(null);
    this.verTodosBultos.set(false);
    this.inv.previaRemesa(this.archivo).subscribe({
      next: (p) => {
        this.previa.set(p);
        this.leyendo.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.previa.set(null);
        this.leyendo.set(false);
      },
    });
  }

  /**
   * Carga los bultos del archivo y da entrada al inventario. Va por
   * `producto_id`: si el producto todavía no tiene presentación, el backend la
   * crea con el peso promedio de los bultos y el precio de lista del producto.
   */
  confirmarCarga(): void {
    const p = this.previa();
    const id = this.id();
    if (!p || !id) return;
    if (!this.almacenCarga) {
      this.error.set('Elige a qué almacén entra la mercancía.');
      return;
    }
    if (!p.se_puede_cargar) {
      this.error.set('Hay códigos que ya están registrados. Revisa los avisos.');
      return;
    }
    this.cargandoRemesa.set(true);
    this.error.set(null);
    this.inv
      .confirmarRemesa({
        producto_id: id,
        almacen_id: Number(this.almacenCarga),
        archivo: p.archivo,
        bultos: p.bultos,
      })
      .subscribe({
        next: (r) => {
          this.ultimaCarga.set(r);
          this.mensaje.set(
            `Remesa ${r.folio}: ${r.num_bultos} bultos, ${r.kg_total} kg al inventario.`
          );
          this.previa.set(null);
          this.archivo = null;
          this.cargandoRemesa.set(false);
          this.recargar();
        },
        error: (e) => {
          this.error.set(this.msg(e));
          this.cargandoRemesa.set(false);
        },
      });
  }

  readonly varForm = this.fb.nonNullable.group({
    sku: ['', Validators.required],
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

  private readonly varFormValor = toSignal(this.varForm.valueChanges, {
    initialValue: this.varForm.getRawValue(),
  });

  readonly paquetes = computed(() =>
    this.variantes().filter((v) => v.tipo_presentacion === 'paquete')
  );

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
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.id.set(id);

    forkJoin({
      tiposCliente: this.catalogo.tiposCliente(),
      producto: this.catalogo.obtenerProducto(id),
      almacenes: this.inv.almacenes(),
    }).subscribe({
      next: (o) => {
        this.tiposCliente.set(o.tiposCliente);
        const activos = o.almacenes.filter((a) => a.activo);
        this.almacenes.set(activos);
        // La remesa suele llegar a la matriz.
        this.almacenCarga = (activos.find((a) => a.es_matriz) ?? activos[0])?.id ?? '';
        this.aplicar(o.producto);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  private aplicar(p: ProductoDetalle): void {
    this.nombreProducto.set(p.nombre);
    this.calibreProducto.set(p.grosor_calibre ?? null);
    this.precioProducto.set(p.precio_kg ?? null);
    this.unidadProducto.set(p.unidad ?? 'kg');
    this.esMultipresentacion.set(!!p.multipresentacion);
    this.esPorLotes.set(!!p.por_lotes);
    this.variantes.set(p.variantes);
    this.imagenes.set(p.imagenes);
    // El hilo SIEMPRE entra en paquetes: el tipo no se elige.
    this.varForm.patchValue({ tipo_presentacion: 'paquete' });
  }

  /** Vuelve a leer el producto: tras cargar la remesa cambian las presentaciones. */
  private recargar(): void {
    const id = this.id();
    if (id) this.cargarProducto(id);
  }

  /** Recarga el producto: lo usan las altas de imagen y de precio por tipo. */
  private cargarProducto(id: number): void {
    this.catalogo.obtenerProducto(id).subscribe({
      next: (p) => this.aplicar(p),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  /**
   * Captura el Enter del lector de código de barras: evita que se envíe el
   * formulario y, si el SKU está vacío, copia el código escaneado también al SKU.
   * (Un lector actúa como teclado: teclea el código y manda Enter.)
   */
  capturarCodigo(ev: Event): void {
    ev.preventDefault();
    this.sincronizarSku();
  }

  /**
   * El SKU sigue al código de barras: en esta tienda son la misma cosa (el
   * código que trae el proveedor es el identificador de la presentación), así
   * que teclearlo dos veces sobra. Deja de seguirlo si se editó el SKU a mano.
   */
  sincronizarSku(): void {
    if (this.skuManual) return;
    const codigo = (this.varForm.controls.codigo_barras.value || '').trim();
    if (codigo) this.varForm.controls.sku.setValue(codigo);
  }

  /** El SKU se tecleó a mano: desde aquí ya no se sobreescribe con el código. */
  marcarSkuManual(): void {
    const sku = this.varForm.controls.sku.value.trim();
    const codigo = (this.varForm.controls.codigo_barras.value || '').trim();
    // Si lo vacía, vuelve a seguir al código: es la forma de deshacer.
    this.skuManual = sku !== '' && sku !== codigo;
  }

  /** Qué le falta a la variante, en lenguaje del usuario, o null si está lista. */
  faltaEnVariante(): string | null {
    const v = this.varForm.getRawValue();
    if (!v.sku.trim()) return 'Ponle un SKU a la variante.';

    // El precio puede venir del producto (`precio_kg`), así que solo se exige
    // cuando no hay ninguno de los dos. Mismo criterio que el backend.
    const sinPrecio = v.precio == null && this.precioProducto() == null;

    if (v.tipo_presentacion === 'paquete') {
      if (!v.peso_kg) return 'Indica cuánto pesa el paquete en kilos.';
      if (sinPrecio) {
        return 'Falta el precio: captúralo aquí o pon el precio por kilo del producto.';
      }
    }
    if (v.tipo_presentacion === 'cono') {
      if (!v.origen_variante_id) return 'Elige de qué paquete se desarma el cono.';
      if (!v.piezas_por_origen) return 'Indica cuántos conos salen de un paquete.';
      if (v.modo_precio === 'manual' && v.precio == null) {
        return 'Con precio por pieza tienes que capturar el precio del cono.';
      }
    }
    if (v.tipo_presentacion === 'simple' && sinPrecio) {
      return 'Falta el precio: captúralo aquí o pon el precio por kilo del producto.';
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
            sku: '', presentacion: '', lote: '', codigo_barras: '',
            tipo_presentacion: this.esMultipresentacion() ? 'paquete' : 'simple',
            peso_kg: null, origen_variante_id: null,
            piezas_por_origen: null, modo_precio: 'calculado',
            precio: null, precio_oferta: null, costo: null,
          });
          this.skuManual = false;
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
    this.nuevoLote = '';
    this.nuevoPeso = null;
    this.nuevoConos = null;
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

  /**
   * Los bultos agrupados por lote. Una remesa suele traer varios lotes del
   * MISMO hilo (el archivo real trajo 80 bultos en 2 lotes), y así se ve de
   * un golpe cuántos kilos entraron con cada uno.
   */
  lotesDe(varianteId: number): LoteDeBultos[] {
    const grupos = new Map<string, LoteDeBultos>();
    for (const b of this.codigosDe(varianteId)) {
      const lote = b.lote?.trim() || 'Sin lote';
      const g =
        grupos.get(lote) ?? { lote, bultos: [], kg: 0, disponibles: 0, kgDisponibles: 0 };
      g.bultos.push(b);
      g.kg += Number(b.peso_kg ?? 0);
      // Los consumidos siguen listados —son el histórico— pero no cuentan como
      // existencias: ya se vendieron o se desarmaron.
      if (this.estaDisponible(b)) {
        g.disponibles += 1;
        g.kgDisponibles += Number(b.peso_kg ?? 0);
      }
      grupos.set(lote, g);
    }
    return [...grupos.values()].sort((a, b) => a.lote.localeCompare(b.lote));
  }

  /** Un bulto sin estado (dato viejo) se trata como disponible. */
  estaDisponible(b: VarianteCodigo): boolean {
    return !b.estado || b.estado === 'disponible';
  }

  /** Total de kilos de los bultos que siguen disponibles. */
  kgDeBultos(varianteId: number): number {
    return this.codigosDe(varianteId)
      .filter((b) => this.estaDisponible(b))
      .reduce((s, b) => s + Number(b.peso_kg ?? 0), 0);
  }

  /** Cuántos bultos siguen disponibles de la variante. */
  bultosDisponibles(varianteId: number): number {
    return this.codigosDe(varianteId).filter((b) => this.estaDisponible(b)).length;
  }

  agregarCodigoVar(varianteId: number): void {
    const codigo = this.nuevoCodigo.trim();
    if (!codigo) return;
    this.error.set(null);
    this.catalogo
      .agregarCodigo(varianteId, {
        codigo,
        // El peso, el lote y los conos son del bulto; van a sus columnas.
        peso_kg: this.nuevoPeso != null && this.nuevoPeso > 0 ? this.nuevoPeso : undefined,
        lote: this.nuevoLote.trim() || undefined,
        conos: this.nuevoConos != null && this.nuevoConos > 0 ? this.nuevoConos : undefined,
      })
      .subscribe({
        next: (c) => {
          this.codigos.update((m) => ({ ...m, [varianteId]: [...(m[varianteId] ?? []), c] }));
          this.nuevoCodigo = '';
          this.nuevoLote = '';
          this.nuevoPeso = null;
          this.nuevoConos = null;
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
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
