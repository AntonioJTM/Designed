import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { AuthService } from '../../../core/services/auth.service';
import {
  InventarioService,
  PreviaRemesa,
  ResultadoRemesa,
} from '../../../core/services/inventario.service';
import { Almacen, StockItem } from '../../../core/models/inventario.models';
import {
  Imagen,
  LoteDeBultos,
  ModoPrecio,
  ProductoDetalle,
  TipoCliente,
  TipoPresentacion,
  Variante,
  VarianteCodigo,
} from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { cotejarArchivo, textoAviso } from '../../../shared/remesa-archivo';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { ProductoFormModal } from './producto-form-modal';
import { EntradasModal } from './entradas-modal';
import { guardarArchivo, mensajeDeError } from '../../../shared/descargar';
import { SE_LLEVA_COSTO } from '../../../core/costos';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';

/** Qué modal está abierto. Uno a la vez; se crea al abrirlo y se destruye al cerrarlo. */
type ModalPresentaciones = 'producto' | 'precio' | 'bulto' | 'imagen' | 'manual' | 'entradas' | null;

/** El selector de la tarjeta de bultos. */
type FiltroBultos = 'disponibles' | 'todos' | 'vendidos' | 'desarmados';

/** Un bulto con lo que hace falta para pintarlo en la tabla. */
interface BultoFila extends VarianteCodigo {
  sku: string;
}

/** Cuántos bultos se listan antes de pedir "ver todos": una remesa real trae 80. */
const BULTOS_A_LA_VISTA = 30;

/**
 * Presentaciones (SKU), bultos, precios por lista e imágenes de un producto, en
 * su propia pantalla.
 *
 * Se separó del formulario del producto: ahí solo se capturan los datos del hilo
 * —color, material, calibre, precio por kilo—. Las presentaciones nuevas heredan
 * el `precio_kg` del producto si no se les captura precio.
 *
 * La pantalla es para MIRAR: una tarjeta por presentación con lo que hay, la
 * tabla de precios por lista, el cargador del Excel y la tabla de bultos. Las
 * acciones (precio y peso, bulto a mano, imagen, captura manual, editar el
 * producto) abren un modal.
 */
@Component({
  selector: 'app-producto-presentaciones',
  imports: [ReactiveFormsModule, FormsModule, RouterLink, CantidadPipe, DineroPipe, ProductoFormModal, EntradasModal],
  templateUrl: './producto-presentaciones.html',
  styleUrl: './producto-presentaciones.scss',
  host: { '(document:keydown.escape)': 'cerrarModal()' },
})
export class ProductoPresentaciones {
  private readonly fb = inject(FormBuilder);
  private readonly confirmacion = inject(ConfirmacionService);
  private readonly catalogo = inject(CatalogoService);
  private readonly auth = inject(AuthService);
  private readonly inv = inject(InventarioService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  // ---- Permisos. El servidor también los exige (403 SIN_PERMISO); aquí solo
  // se esconde lo que iba a fallar.
  /** Precio público, peso y precio por lista: lo que se le cobra a todos. */
  readonly puedeCambiarPrecios = computed(() => this.auth.puede('hacer:cambiar_precios'));
  /** El costo es información interna: no todo el personal lo ve. */
  readonly puedeVerCostos = computed(() => this.auth.puede('hacer:ver_costos'));
  /** ¿Se pide el precio de compra al cargar? No: la tienda no lleva el costo (core/costos.ts). */
  readonly seLlevaCosto = SE_LLEVA_COSTO;
  /** Subir el Excel del proveedor da ENTRADA a mercancía: es lo de Recibir remesa. */
  readonly puedeCargarRemesa = computed(() => this.auth.puede('ver:remesa'));
  readonly veInventario = computed(() => this.auth.puede('ver:inventario'));
  /** Las listas de precio se administran en su pantalla (Administración). */
  readonly veListas = computed(() => this.auth.puede('ver:almacenes'));

  readonly id = signal<number | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  readonly modal = signal<ModalPresentaciones>(null);

  // Datos del producto, para encabezar la pantalla y heredar el precio.
  readonly producto = signal<ProductoDetalle | null>(null);
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

  /**
   * Existencias de cada presentación por almacén (`null` mientras no llegan o si
   * no se pudieron leer: la tarjeta dice "—" en vez de "nada", que sería falso).
   */
  readonly existencias = signal<Record<number, StockItem[]> | null>(null);

  // Bultos por variante: cada código es un bulto con su peso, su lote y dónde está.
  readonly codigos = signal<Record<number, VarianteCodigo[]>>({});
  readonly filtroBultos = signal<FiltroBultos>('disponibles');
  readonly verTodosLosBultos = signal(false);

  // ---- Bulto a mano (modal) ----
  nuevoCodigo = '';
  nuevoLote = '';
  nuevoPeso: number | null = null;
  /** Conos que rinde el bulto: varía entre bultos, así vienen de fábrica. */
  nuevoConos: number | null = null;
  readonly avisoBulto = signal<string | null>(null);

  /** El SKU se tecleó a mano, así que ya no sigue al código de barras. */
  skuManual = false;

  // ---- Precio y peso (modal) ----
  /** Presentación cuyo precio público y peso se están cambiando. */
  readonly variantePrecio = signal<Variante | null>(null);
  /**
   * Precio público y peso de la presentación abierta. Antes no había dónde
   * cambiarlos: el precio quedaba como se heredó del producto el día del alta y
   * el peso como lo puso la primera remesa.
   */
  precioPublico: number | null = null;
  pesoPaquete: number | null = null;
  readonly guardandoPublico = signal(false);

  // ---- Precios por lista ----
  /**
   * Lo que está tecleado en la tabla de precios por lista, por `variante:tipo`.
   * Son propiedades normales con [(ngModel)]; por eso "hay cambios" es un
   * MÉTODO y no un `computed`, que se quedaría pegado al primer valor.
   */
  preciosLista: Record<string, number | null> = {};
  readonly guardandoListas = signal(false);

  /** Tipos que llevan precio propio: todos menos el público. */
  readonly tiposConPrecio = computed(() => this.tiposCliente().filter((t) => !t.es_publico));

  /**
   * El producto ya tiene su presentación. Cuando la tiene, no se dan de alta más:
   * las remesas siguientes agregan BULTOS a esa misma presentación. Lo único que
   * puede hacer falta después es el cono, y se crea solo al bajar el primer
   * paquete a mostrador.
   */
  readonly yaTienePresentacion = computed(() =>
    this.variantes().some((v) => v.tipo_presentacion !== 'cono')
  );

  /** El paquete del producto: de él salen los conos. */
  readonly paquete = computed(() =>
    this.variantes().find((v) => v.tipo_presentacion === 'paquete') ?? null
  );

  /** La presentación que recibe los bultos: el paquete, o la simple si no es multipresentación. */
  readonly principal = computed(
    () => this.paquete() ?? this.variantes().find((v) => v.tipo_presentacion !== 'cono') ?? null
  );

  /** Los conos ya dados de alta. */
  readonly conos = computed(() => this.variantes().filter((v) => v.tipo_presentacion === 'cono'));

  /** Las tarjetas: primero lo que entra del proveedor, luego los conos que salen de ahí. */
  readonly variantesOrdenadas = computed(() => [
    ...this.variantes().filter((v) => v.tipo_presentacion !== 'cono'),
    ...this.conos(),
  ]);

  /** Todos los bultos del producto, con el SKU de su presentación. */
  readonly bultos = computed<BultoFila[]>(() => {
    const porVariante = this.codigos();
    return this.variantes().flatMap((v) =>
      (porVariante[v.id] ?? []).map((b) => ({ ...b, sku: v.sku }))
    );
  });

  /** Hay bultos de más de una presentación: entonces la tabla dice de cuál es cada uno. */
  readonly bultosDeVarias = computed(() => new Set(this.bultos().map((b) => b.variante_id)).size > 1);

  readonly bultosFiltrados = computed(() => {
    const f = this.filtroBultos();
    return this.bultos().filter((b) => {
      if (f === 'todos') return true;
      if (f === 'disponibles') return this.estaDisponible(b);
      if (f === 'vendidos') return b.estado === 'vendido';
      return b.estado === 'desarmado';
    });
  });

  readonly bultosVisiblesTabla = computed(() => {
    const b = this.bultosFiltrados();
    return this.verTodosLosBultos() ? b : b.slice(0, BULTOS_A_LA_VISTA);
  });

  readonly numDisponibles = computed(() => this.bultos().filter((b) => this.estaDisponible(b)).length);

  /**
   * Los bultos agrupados por lote. Una remesa suele traer varios lotes del
   * MISMO hilo (el archivo real trajo 80 bultos en 2 lotes), y así se ve de
   * un golpe cuántos kilos entraron con cada uno.
   */
  readonly lotes = computed<LoteDeBultos[]>(() => {
    const grupos = new Map<string, LoteDeBultos>();
    for (const b of this.bultos()) {
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
  });

  // ---- Carga masiva desde la lista de empaque del proveedor ----
  readonly almacenes = signal<Almacen[]>([]);
  readonly previa = signal<PreviaRemesa | null>(null);
  readonly ultimaCarga = signal<ResultadoRemesa | null>(null);
  readonly leyendo = signal(false);
  readonly cargandoRemesa = signal(false);
  readonly verTodosBultos = signal(false);
  readonly arrastrando = signal(false);
  almacenCarga: number | '' = '';
  /**
   * A cómo salió el kilo en esta compra. Opcional a propósito: no se frena una
   * entrada de mercancía por no tener la factura a mano. Sin él, el costo del
   * hilo se queda como estaba.
   */
  costoKg: number | null = null;
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
   * Cómo debería llamarse el archivo de ESTE hilo, con la convención del
   * proveedor ("ROJO 2-30.xlsx"): se le enseña al usuario para que lo busque.
   */
  readonly archivoEsperado = computed(() => {
    const calibre = (this.calibreProducto() ?? '').replace(/\//g, '-');
    return `${this.nombreProducto()}${calibre ? ' ' + calibre : ''}.xlsx`;
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
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    // Se limpia para que volver a elegir EL MISMO archivo (tras cancelar) lo lea otra vez.
    input.value = '';
    if (f) this.tomarArchivo(f);
  }

  /** Soltó un archivo sobre la zona de carga. */
  soltarArchivo(e: DragEvent): void {
    e.preventDefault();
    this.arrastrando.set(false);
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) {
      this.error.set('Solo se leen listas de empaque en .xlsx.');
      return;
    }
    this.tomarArchivo(f);
  }

  sobreZona(e: DragEvent): void {
    e.preventDefault();
    this.arrastrando.set(true);
  }

  private tomarArchivo(f: File): void {
    this.archivo = f;
    this.previa.set(null);
    this.ultimaCarga.set(null);
    this.error.set(null);
    this.mensaje.set(null);
    this.leerArchivo();
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

  /** Descarta la vista previa sin cargar nada. */
  descartarPrevia(): void {
    this.previa.set(null);
    this.archivo = null;
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
        costo_kg: this.costoKg != null && this.costoKg > 0 ? Number(this.costoKg) : null,
        bultos: p.bultos,
      })
      .subscribe({
        next: (r) => {
          this.ultimaCarga.set(r);
          this.mensaje.set(null);
          // Cada carga deja su comprobante en PDF: se baja solo al terminar.
          this.descargarPdfCarga(r.id, r.folio);
          this.previa.set(null);
          this.costoKg = null;
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

  /** Se está generando el PDF de la última carga. */
  readonly generandoPdf = signal(false);

  descargarPdfCarga(id: number, folio: string): void {
    this.generandoPdf.set(true);
    this.inv.pdfCarga(id).subscribe({
      next: (blob) => {
        this.generandoPdf.set(false);
        guardarArchivo(blob, `Carga ${folio}.pdf`);
      },
      error: async (e) => {
        this.generandoPdf.set(false);
        this.error.set(await mensajeDeError(e));
      },
    });
  }

  readonly varForm = this.fb.nonNullable.group({
    sku: ['', Validators.required],
    presentacion: [''],
    lote: [''],
    codigo_barras: [''],
    // Presentación: 'paquete' se vende por kilo y se puede desarmar en conos;
    // 'cono' sale de un paquete y también se vende por kilo, al mismo precio.
    tipo_presentacion: ['paquete' as TipoPresentacion],
    peso_kg: [null as number | null],
    origen_variante_id: [null as number | null],
    piezas_por_origen: [null as number | null],
    modo_precio: ['calculado' as ModoPrecio],
    precio: [null as number | null, [Validators.min(0)]],
    precio_oferta: [null as number | null],
    costo: [null as number | null],
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
    this.producto.set(p);
    this.nombreProducto.set(p.nombre);
    this.calibreProducto.set(p.grosor_calibre ?? null);
    this.precioProducto.set(p.precio_kg ?? null);
    this.unidadProducto.set(p.unidad ?? 'kg');
    this.esMultipresentacion.set(!!p.multipresentacion);
    this.esPorLotes.set(!!p.por_lotes);
    this.variantes.set(p.variantes);
    this.imagenes.set(p.imagenes);
    this.llenarPreciosLista();
    // El hilo entra en paquetes; sin multipresentación es 'simple' (también en kilos).
    this.varForm.patchValue({ tipo_presentacion: p.multipresentacion ? 'paquete' : 'simple' });
    this.cargarDetalle();
  }

  /**
   * Lo que no viene en el producto: cuánto hay de cada presentación en cada
   * almacén y sus bultos. Cada consulta falla por su lado: si una no llega, su
   * dato dice "—" y lo demás se sigue viendo.
   */
  private cargarDetalle(): void {
    const vs = this.variantes();
    if (vs.length === 0) {
      this.existencias.set({});
      this.codigos.set({});
      return;
    }
    forkJoin(
      vs.map((v) =>
        this.inv.stock({ variante_id: v.id, limit: 100 }).pipe(map((r) => [v.id, r.items] as const))
      )
    )
      .pipe(catchError(() => of(null)))
      .subscribe((r) => this.existencias.set(r ? Object.fromEntries(r) : null));

    // Los conos no tienen bultos: nacen del desarme, ya enconados.
    const conBultos = vs.filter((v) => v.tipo_presentacion !== 'cono');
    if (conBultos.length === 0) {
      this.codigos.set({});
      return;
    }
    forkJoin(
      conBultos.map((v) =>
        this.catalogo.listarCodigos(v.id).pipe(
          map((cs) => [v.id, cs] as const),
          catchError(() => of([v.id, [] as VarianteCodigo[]] as const))
        )
      )
    ).subscribe((r) => this.codigos.set(Object.fromEntries(r)));
  }

  /** Vuelve a leer el producto: tras cargar la remesa cambian las presentaciones. */
  private recargar(): void {
    const id = this.id();
    if (!id) return;
    this.catalogo.obtenerProducto(id).subscribe({
      next: (p) => this.aplicar(p),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  // ---- Modales ----

  cerrarModal(): void {
    // El error que se mostró DENTRO del modal se va con él: si no, al cerrar
    // aparecería suelto en la pantalla hablando de una captura que ya no está.
    if (this.modal() !== null) this.error.set(null);
    this.modal.set(null);
    this.variantePrecio.set(null);
  }

  /** Editó el producto desde el encabezado: con precio nuevo puede nacer su presentación. */
  alGuardarProducto(): void {
    this.mensaje.set('Producto guardado.');
    this.recargar();
  }

  alEliminarProducto(): void {
    this.modal.set(null);
    this.router.navigate(['/admin/productos']);
  }

  // ---- Lo que dicen las tarjetas de presentación ----

  /**
   * Debajo del título: material, línea, precio de lista y cómo se maneja.
   * "Acrilán · Turco · precio de lista $128.00 por kg · se maneja en paquete y
   * en cono, por lotes".
   */
  subtitulo(): string {
    const p = this.producto();
    if (!p) return '';
    const partes: string[] = [];
    if (p.categoria) partes.push(p.categoria);
    if (p.linea) partes.push(p.linea);
    const precio = this.precioProducto();
    partes.push(
      precio != null
        ? `precio de lista ${new DineroPipe().transform(precio)} por ${this.unidadProducto()}`
        : 'sin precio de lista'
    );
    let manejo = this.esMultipresentacion() ? 'se maneja en paquete y en cono' : '';
    if (this.esPorLotes()) manejo = manejo ? manejo + ', por lotes' : 'por lotes';
    if (manejo) partes.push(manejo);
    return partes.join(' · ');
  }

  /** A qué almacén va a entrar la remesa, para decirlo junto al botón de cargar. */
  nombreAlmacenCarga(): string {
    return this.almacenes().find((a) => a.id === Number(this.almacenCarga))?.nombre ?? '—';
  }

  /** La lista no tiene precio propio en ninguna presentación: paga el público. */
  listaSinPrecio(tipoId: number): boolean {
    return this.variantes().every((v) => this.precioDe(v, tipoId) === null);
  }

  /** Cómo se llama la presentación en la tarjeta. */
  nombrePres(v: Variante): string {
    if (v.tipo_presentacion === 'cono') return 'Cono';
    if (v.presentacion?.trim()) return v.presentacion.trim();
    return v.tipo_presentacion === 'paquete' ? 'Paquete' : 'Presentación';
  }

  /** Renglones con existencia de la presentación, `null` si no se pudieron leer. */
  existenciasDe(v: Variante): StockItem[] | null {
    const e = this.existencias();
    if (!e) return null;
    return (e[v.id] ?? []).filter((s) => Number(s.cantidad) > 0);
  }

  /** Bultos disponibles de la presentación que están en ese almacén. */
  bultosEn(v: Variante, almacenId: number): number {
    return (this.codigos()[v.id] ?? []).filter(
      (b) => this.estaDisponible(b) && b.almacen_id === almacenId
    ).length;
  }

  /** Peso de un cono: el que trae la presentación, o el del paquete entre sus piezas. */
  pesoCono(v: Variante): number | null {
    if (v.peso_kg != null && Number(v.peso_kg) > 0) return Number(v.peso_kg);
    const pk = Number(v.paquete_peso_kg ?? 0);
    const piezas = Number(v.piezas_por_origen ?? 0);
    return pk > 0 && piezas > 0 ? pk / piezas : null;
  }

  /** Promedio real de los bultos disponibles, para compararlo con el peso de referencia. */
  promedioBultos(v: Variante): number | null {
    const disp = (this.codigos()[v.id] ?? []).filter((b) => this.estaDisponible(b) && Number(b.peso_kg) > 0);
    if (disp.length === 0) return null;
    return disp.reduce((s, b) => s + Number(b.peso_kg), 0) / disp.length;
  }

  /** Un bulto sin estado (dato viejo) se trata como disponible. */
  estaDisponible(b: VarianteCodigo): boolean {
    return !b.estado || b.estado === 'disponible';
  }

  /** Lo que dice la columna "Estado" de un bulto. */
  estadoBulto(b: VarianteCodigo): { texto: string; clase: string } {
    if (this.estaDisponible(b)) return { texto: 'Disponible', clase: 'verde' };
    if (b.estado === 'vendido') {
      return { texto: 'Vendido' + (b.consumido_folio ? ' · ' + b.consumido_folio : ''), clase: 'azul' };
    }
    return { texto: 'Bajado a conos', clase: 'gris' };
  }

  // ---- Captura manual de la presentación (modal) ----

  abrirManual(): void {
    this.error.set(null);
    this.skuManual = false;
    this.varForm.reset({
      sku: '', presentacion: '', lote: '', codigo_barras: '',
      tipo_presentacion: this.esMultipresentacion() ? 'paquete' : 'simple',
      peso_kg: null, origen_variante_id: null,
      piezas_por_origen: null, modo_precio: 'calculado',
      precio: null, precio_oferta: null, costo: null,
    });
    this.modal.set('manual');
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
    if (!v.sku.trim()) return 'Ponle un SKU a la presentación.';

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
        return 'Con precio manual tienes que capturar el precio por kilo del cono.';
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
    const lleva = v.tipo_presentacion === 'paquete' || v.tipo_presentacion === 'simple';

    this.catalogo
      .crearVariante({
        producto_id: this.id()!,
        sku: v.sku.trim(),
        presentacion: v.presentacion.trim() || undefined,
        codigo_barras: v.codigo_barras.trim() || null,
        lote: v.lote.trim() || null,
        tipo_presentacion: v.tipo_presentacion,
        peso_kg: lleva ? v.peso_kg : null,
        origen_variante_id: esCono ? v.origen_variante_id : null,
        piezas_por_origen: esCono ? v.piezas_por_origen : null,
        modo_precio: esCono ? v.modo_precio : 'manual',
        // Nunca convertir null a texto: String(null) manda "null" y el API
        // lo rechaza con un 422 genérico.
        precio: precioDerivado || v.precio == null ? undefined : String(v.precio),
        precio_oferta: v.precio_oferta != null ? String(v.precio_oferta) : null,
        // El costo solo lo captura quien puede verlo.
        costo: this.puedeVerCostos() && v.costo != null ? String(v.costo) : null,
      })
      .subscribe({
        next: (nv) => {
          this.modal.set(null);
          this.mensaje.set(`Presentación ${nv.sku} guardada.`);
          this.recargar();
        },
        error: (e) => this.error.set(this.msg(e)),
      });
  }

  async eliminarVariante(v: Variante): Promise<void> {
    const si = await this.confirmacion.pedir({
      titulo: `¿Eliminar la presentación ${v.sku}?`,
      mensaje: 'Se van con ella sus bultos y sus precios por lista.',
      aceptar: 'Eliminar',
      peligro: true,
    });
    if (!si) return;
    this.error.set(null);
    this.catalogo.eliminarVariante(v.id).subscribe({
      next: () => {
        this.mensaje.set(`Presentación ${v.sku} eliminada.`);
        this.recargar();
      },
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  // ---- Bultos ----

  abrirBulto(): void {
    this.nuevoCodigo = '';
    this.nuevoLote = '';
    this.nuevoPeso = null;
    this.nuevoConos = null;
    this.avisoBulto.set(null);
    this.error.set(null);
    this.modal.set('bulto');
  }

  /**
   * Da de alta un bulto en la presentación principal. El modal NO se cierra:
   * capturar varios seguidos es lo normal; avisa, se limpia y espera el siguiente.
   */
  agregarCodigoVar(): void {
    const v = this.principal();
    const codigo = this.nuevoCodigo.trim();
    if (!v || !codigo) return;
    this.error.set(null);
    this.catalogo
      .agregarCodigo(v.id, {
        codigo,
        // El peso, el lote y los conos son del bulto; van a sus columnas.
        peso_kg: this.nuevoPeso != null && this.nuevoPeso > 0 ? this.nuevoPeso : undefined,
        lote: this.nuevoLote.trim() || undefined,
        conos: this.nuevoConos != null && this.nuevoConos > 0 ? this.nuevoConos : undefined,
      })
      .subscribe({
        next: (c) => {
          this.codigos.update((m) => ({ ...m, [v.id]: [...(m[v.id] ?? []), c] }));
          this.avisoBulto.set(`Bulto ${c.codigo} añadido.`);
          this.nuevoCodigo = '';
          this.nuevoPeso = null;
          this.nuevoConos = null;
          // El lote se queda: los bultos que se capturan juntos suelen ser del mismo.
        },
        error: (e) => {
          this.avisoBulto.set(null);
          this.error.set(this.msg(e));
        },
      });
  }

  /** Enter del lector: evita submit y agrega el código escaneado. */
  capturarCodigoVar(ev: Event): void {
    ev.preventDefault();
    this.agregarCodigoVar();
  }

  async eliminarCodigoVar(b: BultoFila): Promise<void> {
    const si = await this.confirmacion.pedir({
      titulo: `¿Quitar el bulto ${b.codigo}?`,
      mensaje: 'Solo se borra su registro: quitarlo no mueve el inventario.',
      aceptar: 'Quitar',
      peligro: true,
    });
    if (!si) return;
    this.catalogo.eliminarCodigo(b.id).subscribe({
      next: () =>
        this.codigos.update((m) => ({
          ...m,
          [b.variante_id]: (m[b.variante_id] ?? []).filter((c) => c.id !== b.id),
        })),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  // ---- Imágenes ----

  abrirImagen(): void {
    this.imgForm.reset({ url: '', es_principal: false });
    this.error.set(null);
    this.modal.set('imagen');
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
          this.modal.set(null);
          // Recarga para reflejar el cambio de "principal" en las demás.
          this.recargar();
        },
        error: (e) => this.error.set(this.msg(e)),
      });
  }

  async eliminarImagen(img: Imagen): Promise<void> {
    const si = await this.confirmacion.pedir({ titulo: '¿Quitar esta imagen?', aceptar: 'Quitar', peligro: true });
    if (!si) return;
    this.catalogo.eliminarImagen(img.id).subscribe({
      next: () => this.imagenes.update((arr) => arr.filter((x) => x.id !== img.id)),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  // ---- Precio público y peso (modal) ----

  abrirPrecio(v: Variante): void {
    this.error.set(null);
    this.variantePrecio.set(v);
    this.precioPublico = v.precio != null ? Number(v.precio) : null;
    this.pesoPaquete = v.peso_kg != null ? Number(v.peso_kg) : null;
    this.modal.set('precio');
  }

  /** El cono con precio calculado sigue al paquete: su precio no se edita. */
  precioEditable(v: Variante): boolean {
    return !(v.tipo_presentacion === 'cono' && v.modo_precio === 'calculado');
  }

  /** El peso del cono sale del paquete entre sus piezas: solo se edita el del paquete. */
  pesoEditable(v: Variante): boolean {
    return v.tipo_presentacion !== 'cono';
  }

  guardarPublico(v: Variante): void {
    const body: { precio?: number; peso_kg?: number | null } = {};
    if (this.precioEditable(v)) {
      const p = Number(this.precioPublico);
      if (this.precioPublico == null || !(p >= 0)) {
        this.error.set('Escribe el precio público.');
        return;
      }
      if (p !== Number(v.precio)) body.precio = p;
    }
    if (this.pesoEditable(v)) {
      const w = this.pesoPaquete == null || (this.pesoPaquete as unknown) === '' ? null : Number(this.pesoPaquete);
      if (w !== null && !(w > 0)) {
        this.error.set('El peso tiene que ser mayor que cero, o déjalo vacío.');
        return;
      }
      if (w !== (v.peso_kg != null ? Number(v.peso_kg) : null)) body.peso_kg = w;
    }
    if (Object.keys(body).length === 0) {
      this.cerrarModal();
      this.mensaje.set('No hubo cambios.');
      return;
    }
    this.error.set(null);
    this.guardandoPublico.set(true);
    this.catalogo.actualizarVariante(v.id, body).subscribe({
      next: () => {
        this.guardandoPublico.set(false);
        this.cerrarModal();
        this.mensaje.set(
          v.tipo_presentacion === 'paquete' && this.conos().length > 0 && body.precio != null
            ? `Precio de ${v.sku} actualizado. Los conos de precio calculado también cambiaron.`
            : `${v.sku} actualizado.`
        );
        // Se recarga todo: si cambió el paquete, los conos cambiaron con él.
        this.recargar();
      },
      error: (e) => {
        this.guardandoPublico.set(false);
        this.error.set(this.msg(e));
      },
    });
  }

  // ---- Precios por lista ----

  claveLista(varianteId: number, tipoId: number): string {
    return `${varianteId}:${tipoId}`;
  }

  /** Precio capturado de una variante para un tipo, o null si paga el público. */
  precioDe(v: Variante, tipoId: number): number | null {
    const p = v.precios?.find((x) => x.tipo_cliente_id === tipoId);
    return p ? Number(p.precio) : null;
  }

  private llenarPreciosLista(): void {
    const m: Record<string, number | null> = {};
    for (const v of this.variantes()) {
      for (const t of this.tiposConPrecio()) m[this.claveLista(v.id, t.id)] = this.precioDe(v, t.id);
    }
    this.preciosLista = m;
  }

  /** Lo tecleado que difiere de lo guardado. Método, no `computed`: lee campos de ngModel. */
  cambiosLista(): { v: Variante; tipoId: number; precio: number | null }[] {
    const cambios: { v: Variante; tipoId: number; precio: number | null }[] = [];
    for (const v of this.variantes()) {
      for (const t of this.tiposConPrecio()) {
        const crudo = this.preciosLista[this.claveLista(v.id, t.id)];
        const nuevo = crudo == null || (crudo as unknown) === '' ? null : Number(crudo);
        if (nuevo !== this.precioDe(v, t.id)) cambios.push({ v, tipoId: t.id, precio: nuevo });
      }
    }
    return cambios;
  }

  guardarPreciosLista(): void {
    const cambios = this.cambiosLista();
    if (cambios.length === 0) return;
    if (cambios.some((c) => c.precio !== null && !(c.precio >= 0))) {
      this.error.set('Un precio no puede ser negativo. Déjalo vacío para que esa lista pague el público.');
      return;
    }
    this.error.set(null);
    this.guardandoListas.set(true);
    forkJoin(cambios.map((c) => this.catalogo.fijarPrecioTipo(c.v.id, c.tipoId, c.precio))).subscribe({
      next: () => {
        this.guardandoListas.set(false);
        this.mensaje.set(
          cambios.length === 1 ? 'Precio por lista guardado.' : `${cambios.length} precios por lista guardados.`
        );
        this.recargar();
      },
      error: (e) => {
        this.guardandoListas.set(false);
        this.error.set(this.msg(e));
        // Lo que sí alcanzó a guardarse se ve al recargar.
        this.recargar();
      },
    });
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
