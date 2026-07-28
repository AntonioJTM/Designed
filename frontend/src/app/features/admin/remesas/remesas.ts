import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  InventarioService,
  PreviaRemesa,
  Remesa,
  ResultadoRemesa,
} from '../../../core/services/inventario.service';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { Almacen } from '../../../core/models/inventario.models';
import { Variante } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';
import { cotejarArchivo, textoAviso } from '../../../shared/remesa-archivo';

/**
 * Recepción de remesas: se sube la lista de empaque del proveedor y cada
 * renglón entra como un bulto de la presentación elegida, con su peso real y su
 * lote. El total en kilos se da de entrada al almacén.
 */
@Component({
  selector: 'app-remesas',
  imports: [FormsModule, CantidadPipe, FechaPipe],
  templateUrl: './remesas.html',
})
export class Remesas {
  private readonly inv = inject(InventarioService);
  private readonly catalogo = inject(CatalogoService);

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

  varianteSel: number | '' = '';
  almacenSel: number | '' = '';
  notas = '';
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
    return this.verTodos() ? b : b.slice(0, 15);
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
    return textoAviso(cotejarArchivo(r.archivo, r));
  }

  /** Cuántas remesas del historial no cuadran con su archivo. */
  readonly sospechosas = computed(
    () => this.historial().filter((r) => this.avisoHistorial(r) !== null).length
  );

  private cargarHistorial(): void {
    this.inv.remesas().subscribe({
      next: (p) => this.historial.set(p.items),
      error: () => {},
    });
  }

  elegirArchivo(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.archivo = input.files?.[0] ?? null;
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
        bultos: p.bultos,
      })
      .subscribe({
        next: (r) => {
          this.ultima.set(r);
          this.mensaje.set(
            `Remesa ${r.folio} recibida: ${r.num_bultos} bultos, ${r.kg_total} kg.`
          );
          this.previa.set(null);
          this.archivo = null;
          this.notas = '';
          this.enviando.set(false);
          this.cargarHistorial();
        },
        error: (e) => {
          this.error.set(this.msg(e));
          this.enviando.set(false);
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
