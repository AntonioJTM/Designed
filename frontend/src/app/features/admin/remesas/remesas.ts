import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  InventarioService,
  PreviaRemesa,
  Remesa,
  ResultadoRemesa,
} from '../../../core/services/inventario.service';
import { AuthService } from '../../../core/services/auth.service';
import { Almacen } from '../../../core/models/inventario.models';
import { Variante } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';
import { cotejarArchivo, hiloDelArchivo, textoAviso } from '../../../shared/remesa-archivo';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { CuandoPipe } from '../inventario/cuando.pipe';
import { FolioPipe } from '../../../shared/folio.pipe';
import { guardarArchivo, mensajeDeError } from '../../../shared/descargar';
import { SE_LLEVA_COSTO } from '../../../core/costos';
import { CargaLista } from './carga-lista';

/** Las dos formas de cargar: la lista completa del proveedor o la de un solo hilo. */
type Modo = 'lista' | 'hilo';
const CLAVE_MODO = 'remesa_modo';

/** Cuántos bultos se ven de entrada en la revisión; el resto, con "Ver todos". */
const BULTOS_A_LA_VISTA = 6;

/**
 * Recepción de remesas: se sube la lista de empaque del proveedor y cada
 * renglón entra como un bulto de la presentación elegida, con su peso real y su
 * lote. El total en kilos se da de entrada al almacén.
 *
 * Tres pasos, como en la tienda: a qué hilo entra, la lista de empaque, y la
 * revisión. Nada se mueve hasta confirmar.
 */
@Component({
  selector: 'app-remesas',
  imports: [FolioPipe, FormsModule, CantidadPipe, FechaPipe, DineroPipe, CuandoPipe, CargaLista],
  templateUrl: './remesas.html',
  styleUrl: './remesas.scss',
})
export class Remesas {
  private readonly inv = inject(InventarioService);
  private readonly auth = inject(AuthService);

  /**
   * Lista completa (varios colores, lo normal) o un solo hilo. Se recuerda en
   * este navegador: quien recibe suele cargar siempre del mismo modo.
   */
  readonly modo = signal<Modo>(Remesas.modoGuardado());
  readonly almacenes = signal<Almacen[]>([]);
  readonly paquetes = signal<Variante[]>([]);
  readonly historial = signal<Remesa[]>([]);
  readonly previa = signal<PreviaRemesa | null>(null);
  readonly ultima = signal<ResultadoRemesa | null>(null);
  readonly leyendo = signal(false);
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  readonly verTodos = signal(false);
  /** El archivo se está arrastrando encima de la caja. */
  readonly arrastrando = signal(false);
  /** La carga cuyo PDF se está generando (para el "Generando…" de su botón). */
  readonly generandoPdf = signal<number | null>(null);

  /**
   * Capturar el precio de compra es de quien recibe la remesa; VER costos ya
   * guardados (el del historial, el promedio que quedó) es de quien tiene
   * `hacer:ver_costos`.
   */
  readonly veCostos = computed(() => this.auth.puede('hacer:ver_costos'));
  /** ¿Se pide el precio de compra al cargar? No: la tienda no lleva el costo (core/costos.ts). */
  readonly seLlevaCosto = SE_LLEVA_COSTO;

  varianteSel: number | '' = '';
  almacenSel: number | '' = '';
  notas = '';
  /**
   * A cómo salió el kilo en esta compra. Vacío = no se captura y el costo del
   * hilo se queda como estaba: es opcional a propósito, para no frenar una
   * entrada de mercancía por no tener la factura a mano.
   */
  costoKg: number | null = null;
  archivo: File | null = null;

  /** Los avisos que impiden cargar (códigos ya registrados). */
  readonly bloqueantes = computed(() =>
    (this.previa()?.avisos ?? []).filter((a) => a.bloqueante)
  );

  /** Los avisos informativos: renglones que se omitieron por estar mal. */
  readonly advertencias = computed(() =>
    (this.previa()?.avisos ?? []).filter((a) => !a.bloqueante)
  );

  /** Bultos que se muestran en la tabla; por omisión solo los primeros. */
  readonly bultosVisibles = computed(() => {
    const b = this.previa()?.bultos ?? [];
    return this.verTodos() ? b : b.slice(0, BULTOS_A_LA_VISTA);
  });

  /** Es un MÉTODO: `varianteSel` es un campo de ngModel, no una señal. */
  paqueteSel(): Variante | null {
    return this.paquetes().find((p) => p.id === Number(this.varianteSel)) ?? null;
  }

  /** Cómo se identifica un hilo en el selector: color, calibre, material y línea. */
  etiquetaPaquete(p: Variante): string {
    const partes = [p.producto];
    if (p.calibre) partes.push(p.calibre);
    const clas = [p.material, p.linea].filter(Boolean).join(' · ');
    return clas ? `${partes.join(' ')} — ${clas}` : partes.join(' ');
  }

  /**
   * Coteja el nombre del archivo contra el hilo elegido. El proveedor nombra sus
   * listas "COLOR CALIBRE.xlsx", así que se puede avisar cuando no cuadran: ya se
   * cargaron tres al producto equivocado, una de ellas con el color bueno y el
   * calibre malo. Solo AVISA: la convención no es garantía.
   */
  avisoArchivo(): string | null {
    const p = this.paqueteSel();
    if (!p || !this.archivo) return null;
    return textoAviso(cotejarArchivo(this.archivo.name, p));
  }

  /**
   * Para la etiqueta de la caja del archivo: 'coincide' solo si de verdad se pudo
   * leer el hilo del nombre y cuadra; null si no hay nada que cotejar (sin hilo
   * elegido o un archivo con otro nombre), y entonces no se opina.
   */
  cotejo(): 'coincide' | 'no' | null {
    const p = this.paqueteSel();
    if (!p || !this.archivo || !hiloDelArchivo(this.archivo.name)) return null;
    return this.avisoArchivo() ? 'no' : 'coincide';
  }

  /**
   * Al elegir el archivo, si todavía no hay presentación elegida y el nombre
   * apunta a una sola, se preselecciona. No pisa una elección hecha a mano.
   */
  private sugerirPorArchivo(): void {
    if (this.varianteSel || !this.archivo) return;
    const candidatos = this.paquetes().filter(
      (p) => cotejarArchivo(this.archivo!.name, p).length === 0
    );
    if (candidatos.length === 1) {
      this.varianteSel = candidatos[0].id;
      this.mensaje.set(
        `Por el nombre del archivo se eligió ${this.etiquetaPaquete(candidatos[0])}. ` +
          `Cámbialo si no es.`
      );
    }
  }

  constructor() {
    this.inv.almacenes().subscribe({
      next: (a) => {
        const activos = a.filter((x) => x.activo);
        this.almacenes.set(activos);
        // La remesa suele llegar a la matriz.
        this.almacenSel = (activos.find((x) => x.es_matriz) ?? activos[0])?.id ?? '';
      },
      error: (e) => this.error.set(this.msg(e)),
    });
    // Solo las presentaciones de tipo paquete reciben remesas: entran en kilos.
    this.inv.variantesPorTipo('paquete').subscribe({
      next: (vs) => this.paquetes.set(vs),
      error: (e) => this.error.set(this.msg(e)),
    });
    this.cargarHistorial();
  }

  /**
   * Cotejo de una remesa YA cargada. Sirve para señalar en el historial las que
   * entraron al hilo equivocado: hay tres del 2026-07-28 y a ojo no se ven.
   */
  avisoHistorial(r: Remesa): string | null {
    // Un archivo que entró en VARIAS cargas es una lista con varios colores: su
    // nombre no dice un hilo y no hay nada que cotejar.
    if (r.archivo && this.archivosDeLista().has(r.archivo)) return null;
    return textoAviso(cotejarArchivo(r.archivo, r));
  }

  /** Los archivos del historial que dejaron más de una carga (listas con varios colores). */
  private readonly archivosDeLista = computed(() => {
    const veces = new Map<string, number>();
    for (const r of this.historial()) if (r.archivo) veces.set(r.archivo, (veces.get(r.archivo) ?? 0) + 1);
    return new Set([...veces].filter(([, n]) => n > 1).map(([a]) => a));
  });

  /** El nombre del archivo, sin la extensión: "ROJO 1-30". Para la pastilla corta. */
  nombreArchivo(r: Remesa): string {
    return (r.archivo ?? '').split(/[\\/]/).pop()!.replace(/\.(xlsx|xls)$/i, '');
  }

  /** Cuántas remesas del historial no cuadran con su archivo. */
  readonly sospechosas = computed(
    () => this.historial().filter((r) => this.avisoHistorial(r) !== null).length
  );

  /** Una remesa sin precio de compra no mueve el costo: el margen de ese hilo no es de fiar. */
  sinCosto(r: Remesa): boolean {
    // Sin llevar costo, que una carga no lo traiga es lo normal: no se avisa.
    if (!this.seLlevaCosto) return false;
    // La lista con varios colores ya no pide precio de compra (los precios se
    // ponen en Productos): avisar en cada una de sus cargas sería ruido.
    if (r.archivo && this.archivosDeLista().has(r.archivo)) return false;
    return r.costo_kg == null;
  }

  private static modoGuardado(): Modo {
    try {
      return localStorage.getItem(CLAVE_MODO) === 'hilo' ? 'hilo' : 'lista';
    } catch {
      return 'lista';
    }
  }

  cambiarModo(m: Modo): void {
    this.modo.set(m);
    this.error.set(null);
    this.mensaje.set(null);
    try {
      localStorage.setItem(CLAVE_MODO, m);
    } catch {
      /* sin almacenamiento: se queda solo en esta visita */
    }
  }

  cargarHistorial(): void {
    this.inv.remesas().subscribe({
      next: (p) => this.historial.set(p.items),
      error: () => {},
    });
  }

  elegirArchivo(e: Event): void {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    // Se limpia para que volver a elegir el MISMO archivo (ya corregido) vuelva
    // a leerlo; si no, el navegador no avisa del cambio.
    input.value = '';
    this.tomarArchivo(f);
  }

  /** Lo arrastran a la caja: es lo mismo que elegirlo. */
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
    this.archivo = f;
    this.previa.set(null);
    this.ultima.set(null);
    this.error.set(null);
    this.mensaje.set(null);
    if (this.archivo) {
      this.sugerirPorArchivo();
      this.leerArchivo();
    }
  }

  leerArchivo(): void {
    if (!this.archivo) return;
    this.leyendo.set(true);
    this.error.set(null);
    this.verTodos.set(false);
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

  confirmar(): void {
    const p = this.previa();
    if (!p) return;
    if (!this.varianteSel || !this.almacenSel) {
      this.error.set('Elige la presentación y el almacén al que entra la remesa.');
      return;
    }
    if (!p.se_puede_cargar) {
      this.error.set('Hay códigos que ya están registrados. Revisa los avisos.');
      return;
    }
    this.enviando.set(true);
    this.error.set(null);
    this.inv
      .confirmarRemesa({
        variante_id: Number(this.varianteSel),
        almacen_id: Number(this.almacenSel),
        archivo: p.archivo,
        notas: this.notas.trim() || undefined,
        costo_kg: this.costoKg != null && this.costoKg > 0 ? Number(this.costoKg) : null,
        bultos: p.bultos,
      })
      .subscribe({
        next: (r) => {
          this.ultima.set(r);
          this.mensaje.set(null);
          // Cada carga deja su comprobante en PDF: se baja solo al terminar, y se
          // puede volver a sacar cuando sea desde el historial.
          this.descargarPdf(r.id, r.folio);
          this.previa.set(null);
          this.archivo = null;
          this.notas = '';
          this.costoKg = null;
          this.enviando.set(false);
          this.cargarHistorial();
        },
        error: (e) => {
          this.error.set(this.msg(e));
          this.enviando.set(false);
        },
      });
  }

  /** El PDF de una carga: el hilo, el almacén y cada bulto con su peso real. */
  descargarPdf(id: number, folio: string): void {
    this.generandoPdf.set(id);
    this.inv.pdfCarga(id).subscribe({
      next: (blob) => {
        this.generandoPdf.set(null);
        guardarArchivo(blob, `Carga ${folio}.pdf`);
      },
      error: async (e) => {
        this.generandoPdf.set(null);
        this.error.set(await mensajeDeError(e));
      },
    });
  }

  nombreAlmacen(): string {
    return this.almacenes().find((a) => a.id === Number(this.almacenSel))?.nombre ?? '';
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
