import { Component, OnDestroy, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  DatosCarga,
  EventoCarga,
  HiloLista,
  InventarioService,
  PreviaLista,
  ResultadoLista,
} from '../../../core/services/inventario.service';
import { AuthService } from '../../../core/services/auth.service';
import { DatosCargaCampos, datosCargaVacios, datosParaEnviar } from './datos-carga';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { Almacen } from '../../../core/models/inventario.models';
import { Categoria, Opcion } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { FolioPipe } from '../../../shared/folio.pipe';
import { guardarArchivo, mensajeDeError } from '../../../shared/descargar';

/** Cuántos renglones con problema se ven de entrada; el resto, con "Ver todos". */
const RENGLONES_A_LA_VISTA = 8;

/** El panel de avance mientras se carga la lista. */
interface Avance {
  /** Lo que está haciendo ahora, en palabras. */
  texto: string;
  /** Bultos ya registrados y el total de la lista. */
  hechos: number;
  total: number;
  hilos: { hilo: string; nuevo: boolean; estado: 'espera' | 'cargando' | 'listo'; folio?: string }[];
}

/**
 * La LISTA COMPLETA del proveedor: un archivo con varios colores (el inventario
 * que arma la tienda a partir del PDF, hoja GLOBAL). Cada color + calibre es un
 * hilo: si ya existe se le agregan bultos, y si no, se crea SIN precio —la
 * tienda se lo pone después en Productos y la campana avisa mientras falte—.
 *
 * Vive dentro de Surtir inventario, como la otra forma de cargar. Nada se mueve
 * hasta confirmar, y entra la lista completa o nada.
 */
@Component({
  selector: 'app-carga-lista',
  imports: [FormsModule, RouterLink, CantidadPipe, DineroPipe, FolioPipe, DatosCargaCampos],
  templateUrl: './carga-lista.html',
  styleUrl: './carga-lista.scss',
})
export class CargaLista implements OnDestroy {
  private readonly inv = inject(InventarioService);
  private readonly catalogo = inject(CatalogoService);
  private readonly auth = inject(AuthService);

  /**
   * El costo por kilo, solo para administración y contabilidad (2026-10-06): va
   * por HILO, en una columna de la revisión (cada color pudo costar distinto).
   */
  readonly veCostos = computed(() => this.auth.puede('hacer:ver_costos'));
  /** Proveedor, factura, pedimento, contenedor y fecha: los mismos para toda la lista. */
  readonly datosCarga = signal<DatosCarga>(datosCargaVacios());
  /** El costo por kilo de cada hilo, por su clave. */
  costos: Record<string, number | null> = {};

  /** Los almacenes activos; los trae la pantalla de arriba. */
  readonly almacenes = input<Almacen[]>([]);
  /** Avisa que entró una lista, para que el historial se recargue. */
  readonly cargada = output<ResultadoLista>();

  readonly materiales = signal<Categoria[]>([]);
  readonly lineas = signal<Opcion[]>([]);
  readonly previa = signal<PreviaLista | null>(null);
  readonly ultima = signal<ResultadoLista | null>(null);
  readonly leyendo = signal(false);
  readonly enviando = signal(false);
  readonly generandoPdf = signal(false);
  readonly error = signal<string | null>(null);
  readonly arrastrando = signal(false);
  readonly verTodosErrores = signal(false);
  readonly verTodosAvisos = signal(false);

  almacenSel: number | '' = '';
  materialSel: number | '' = '';
  lineaSel: number | '' = '';
  notas = '';
  archivo: File | null = null;
  /**
   * Lo que va haciendo la carga, mientras dura. Sin precio de compra en esta
   * pantalla: el usuario pone los precios a mano en Productos (2026-10-03).
   */
  readonly avance = signal<Avance | null>(null);
  /** Cuánto lleva cargando, para el contador del panel. */
  readonly segundos = signal(0);
  /** Por qué no entró la lista; se pinta junto al botón, que es donde se está mirando. */
  readonly errorCarga = signal<string | null>(null);
  private reloj: ReturnType<typeof setInterval> | null = null;
  /** El almacén y el archivo de la última lista, para el comprobante y su PDF. */
  almacenUltima = '';
  archivoUltimo = '';

  readonly nuevos = computed(() => (this.previa()?.hilos ?? []).filter((h) => h.estado === 'nuevo'));

  readonly erroresVisibles = computed(() => {
    const e = this.previa()?.errores ?? [];
    return this.verTodosErrores() ? e : e.slice(0, RENGLONES_A_LA_VISTA);
  });

  readonly avisosVisibles = computed(() => {
    const a = this.previa()?.avisos ?? [];
    return this.verTodosAvisos() ? a : a.slice(0, RENGLONES_A_LA_VISTA);
  });

  constructor() {
    this.catalogo.listarCategorias().subscribe({
      next: (p) => this.materiales.set(p.items.filter((c) => c.activo)),
      error: () => {},
    });
    this.catalogo.opciones('lineas').subscribe({ next: (l) => this.lineas.set(l), error: () => {} });
    // La lista suele llegar a la matriz. Con un efecto y no en el constructor:
    // ahí el input todavía no está asignado, y los almacenes pueden llegar
    // después de que la pantalla se dibujó.
    effect(() => {
      const a = this.almacenes();
      if (!this.almacenSel && a.length) this.almacenSel = (a.find((x) => x.es_matriz) ?? a[0]).id;
    });
  }

  /**
   * Los calibres de los hilos nuevos que el material elegido no tiene. Es un
   * MÉTODO: `materialSel` es un campo de ngModel, no una señal.
   */
  calibresFuera(): string[] {
    const m = this.materiales().find((c) => c.id === Number(this.materialSel));
    const validos = (m?.calibres ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!m || !validos.length) return [];
    return [...new Set(this.nuevos().map((h) => h.calibre))].filter((c) => !validos.includes(c));
  }

  nombreAlmacen(): string {
    return this.almacenes().find((a) => a.id === Number(this.almacenSel))?.nombre ?? 'el almacén elegido';
  }

  nombreMaterial(): string {
    return this.materiales().find((c) => c.id === Number(this.materialSel))?.nombre ?? '';
  }

  /** Lo que falta para poder confirmar, dicho en palabras; null si ya se puede. */
  falta(): string | null {
    const p = this.previa();
    if (!p) return null;
    if (!p.se_puede_cargar) return 'Corrige los renglones marcados en el Excel y vuelve a subirlo.';
    if (!this.almacenSel) return 'Elige el almacén donde entra.';
    if (this.nuevos().length && !this.materialSel) return 'Elige el material de los hilos nuevos.';
    if (this.calibresFuera().length) {
      return `${this.nombreMaterial()} no tiene el calibre ${this.calibresFuera().join(', ')}.`;
    }
    return null;
  }

  /** Los lotes del hilo con sus bultos, para el globito de "y 2 más". */
  lotesDe(h: HiloLista): string {
    return h.lotes.map((l) => `${l.lote}: ${l.bultos} bultos, ${l.kg} kg`).join(' · ');
  }

  /** "18.7 a 19.4 kg"; un solo número si todos pesan igual. */
  rango(h: HiloLista): string {
    return h.peso_min === h.peso_max ? `${h.peso_min}` : `${h.peso_min} a ${h.peso_max}`;
  }

  elegirArchivo(e: Event): void {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    // Se limpia para que volver a elegir el MISMO archivo (ya corregido) lo lea.
    input.value = '';
    this.tomarArchivo(f);
  }

  soltar(e: DragEvent): void {
    e.preventDefault();
    this.arrastrando.set(false);
    const f = e.dataTransfer?.files?.[0] ?? null;
    if (f) this.tomarArchivo(f);
  }

  arrastrar(e: DragEvent, encima: boolean): void {
    e.preventDefault();
    this.arrastrando.set(encima);
  }

  private tomarArchivo(f: File | null): void {
    // Con una carga en curso no se cambia el archivo: se perdería de vista.
    if (this.enviando()) return;
    this.archivo = f;
    this.previa.set(null);
    this.ultima.set(null);
    this.error.set(null);
    this.errorCarga.set(null);
    this.verTodosErrores.set(false);
    this.verTodosAvisos.set(false);
    if (!f) return;
    this.leyendo.set(true);
    this.inv.previaLista(f).subscribe({
      next: (p) => {
        this.previa.set(p);
        // El material lo sugiere el ARTÍCULO del proveedor ("%100 ACRYLIC").
        if (!this.materialSel && p.material_sugerido_id) this.materialSel = p.material_sugerido_id;
        this.leyendo.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.leyendo.set(false);
      },
    });
  }

  /**
   * Carga la lista. El servidor va diciendo qué hace (hilo por hilo y los
   * bultos que van) y la pantalla lo pinta en el panel de avance: con un
   * "Cargando…" mudo parecía que no pasaba nada (lo dijo el usuario).
   */
  confirmar(): void {
    const p = this.previa();
    if (!p || this.falta()) return;
    this.enviando.set(true);
    this.error.set(null);
    this.errorCarga.set(null);
    this.avance.set({
      texto: 'Enviando la lista al servidor',
      hechos: 0,
      total: p.resumen.num_bultos,
      hilos: p.hilos.map((h) => ({ hilo: `${h.nombre} ${h.calibre}`, nuevo: h.estado === 'nuevo', estado: 'espera' })),
    });
    this.segundos.set(0);
    this.pararReloj();
    this.reloj = setInterval(() => this.segundos.update((s) => s + 1), 1000);

    const almacen = this.almacenes().find((a) => a.id === Number(this.almacenSel));
    let termino = false;
    this.inv
      .cargarLista({
        almacen_id: Number(this.almacenSel),
        archivo: p.archivo,
        notas: this.notas.trim() || undefined,
        categoria_id: this.materialSel ? Number(this.materialSel) : null,
        linea_id: this.lineaSel ? Number(this.lineaSel) : null,
        documento: p.documento,
        // Los datos de la lista; el costo NO (va por hilo, abajo).
        ...datosParaEnviar(this.datosCarga(), false),
        hilos: p.hilos.map((h) => ({
          nombre: h.nombre,
          calibre: h.calibre,
          ...(this.veCostos() && Number(this.costos[h.clave]) > 0 ? { costo_kg: Number(this.costos[h.clave]) } : {}),
          bultos: h.bultos,
        })),
      })
      .subscribe({
        next: (ev) => {
          if (ev.tipo === 'fin') {
            termino = true;
            this.terminar(null);
            this.ultima.set(ev.data);
            this.almacenUltima = almacen?.nombre ?? '';
            this.archivoUltimo = (p.archivo ?? '').replace(/\.(xlsx|xls)$/i, '');
            // El comprobante de toda la lista se baja solo, como el de una carga.
            this.descargarPdf();
            this.previa.set(null);
            this.archivo = null;
            this.notas = '';
            this.datosCarga.set(datosCargaVacios());
            this.costos = {};
            this.cargada.emit(ev.data);
            // El comprobante queda arriba: se sube para que se vea.
            window.scrollTo?.({ top: 0, behavior: 'smooth' });
          } else if (ev.tipo === 'error') {
            termino = true;
            this.terminar(`${ev.error.message} No se guardó nada.`);
          } else {
            this.alAvanzar(ev);
          }
        },
        error: (e) => {
          termino = true;
          this.terminar(this.msg(e));
        },
        complete: () => {
          // Se cortó sin decir ni "listo" ni "error": pudo haber entrado o no.
          if (!termino) {
            this.terminar(
              'Se cortó la comunicación con el servidor antes de terminar. Revisa el historial de abajo ' +
                'antes de volver a cargarla: si entró, ahí aparece.'
            );
          }
        },
      });
  }

  /** Lo que va diciendo el servidor, pintado en el panel de avance. */
  private alAvanzar(ev: EventoCarga): void {
    const a = this.avance();
    if (!a) return;
    const hilos = [...a.hilos];
    switch (ev.tipo) {
      case 'paso':
        this.avance.set({ ...a, texto: ev.texto });
        break;
      case 'hilo':
        hilos[ev.i] = { ...hilos[ev.i], estado: 'cargando' };
        this.avance.set({
          ...a,
          hilos,
          texto: ev.nuevo ? `Creando ${ev.hilo} y registrando sus bultos` : `Agregando los bultos de ${ev.hilo}`,
        });
        break;
      case 'bultos':
        this.avance.set({ ...a, hechos: ev.hechos, total: ev.total });
        break;
      case 'hilo_listo':
        hilos[ev.i] = { ...hilos[ev.i], estado: 'listo', folio: ev.folio };
        this.avance.set({ ...a, hilos });
        break;
    }
  }

  private terminar(error: string | null): void {
    this.pararReloj();
    this.enviando.set(false);
    this.avance.set(null);
    this.errorCarga.set(error);
  }

  private pararReloj(): void {
    if (this.reloj) clearInterval(this.reloj);
    this.reloj = null;
  }

  ngOnDestroy(): void {
    this.pararReloj();
  }

  /** Qué tanto lleva la barra: los bultos registrados contra el total. */
  pct(a: Avance): number {
    return a.total > 0 ? Math.min(100, Math.round((a.hechos / a.total) * 100)) : 0;
  }

  /** El PDF de la lista: el resumen y luego cada hilo con sus bultos. */
  descargarPdf(): void {
    const u = this.ultima();
    if (!u) return;
    this.generandoPdf.set(true);
    this.inv.pdfCargas(u.ids).subscribe({
      next: (blob) => {
        this.generandoPdf.set(false);
        guardarArchivo(blob, `Carga ${this.archivoUltimo || u.num_hilos + ' hilos'}.pdf`);
      },
      error: async (e) => {
        this.generandoPdf.set(false);
        this.error.set(await mensajeDeError(e));
      },
    });
  }

  /** "CAMEL 2/30, OPTIK 2/30 y MARINO 2/30". */
  enLista(xs: string[]): string {
    return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`;
  }

  hilosSinPrecio(u: ResultadoLista): string[] {
    return u.sin_precio.map((s) => s.hilo);
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
