import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  EquivalenciaPaquetes,
  InventarioService,
  ResultadoTraspaso,
  Traspaso,
  TraspasoItemInput,
} from '../../../core/services/inventario.service';
import { Almacen } from '../../../core/models/inventario.models';
import { Variante } from '../../../core/models/catalogo.models';
import { FechaPipe } from '../../../shared/fecha.pipe';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';

/** Línea en captura: lo que el almacenista está armando antes de enviar. */
interface LineaEnvio {
  variante: Variante;
  /** Paquetes si la variante es un paquete; si no, cantidad en su unidad. */
  cantidad: number;
}

/**
 * Traspasos de matriz a sucursal. Se manda mercancía por paquetes ("70 de azul
 * marino, 30 de verde") en un solo documento con folio; la sucursal decide
 * después si los desarma en conos o los vende por paquete.
 */
@Component({
  selector: 'app-traspasos',
  imports: [FormsModule, CantidadPipe, FechaPipe],
  templateUrl: './traspasos.html',
})
export class Traspasos {
  private readonly inv = inject(InventarioService);

  readonly almacenes = signal<Almacen[]>([]);
  readonly historial = signal<Traspaso[]>([]);
  readonly resultados = signal<Variante[]>([]);
  readonly lineas = signal<LineaEnvio[]>([]);
  readonly ultimo = signal<ResultadoTraspaso | null>(null);
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  origen: number | '' = '';
  destino: number | '' = '';
  notas = '';
  q = '';

  /** Solo tiene sentido mandar a un almacén distinto del que surte. */
  readonly destinos = computed(() =>
    this.almacenes().filter((a) => a.id !== Number(this.origen) && a.activo)
  );

  /** La matriz, para señalarla en el selector de origen. */
  readonly matriz = computed(() => this.almacenes().find((a) => a.es_matriz) ?? null);

  readonly totalPaquetes = computed(() =>
    this.lineas()
      .filter((l) => this.esPaquete(l.variante))
      .reduce((s, l) => s + l.cantidad, 0)
  );

  constructor() {
    this.inv.almacenes().subscribe({
      next: (a) => {
        this.almacenes.set(a.filter((x) => x.activo));
        const activos = this.almacenes();
        // El origen que se propone es la matriz; si no hay, el primero activo.
        const matriz = activos.find((x) => x.es_matriz);
        this.origen = (matriz ?? activos[0])?.id ?? '';
        const otro = activos.find((x) => x.id !== Number(this.origen));
        if (otro) this.destino = otro.id;
      },
      error: (e) => this.error.set(this.msg(e)),
    });
    this.cargarHistorial();
  }

  private cargarHistorial(): void {
    this.inv.traspasos().subscribe({
      next: (p) => this.historial.set(p.items),
      error: () => {},
    });
  }

  esPaquete(v: Variante): boolean {
    return v.tipo_presentacion === 'paquete';
  }

  /** Etiqueta de lo que se captura: paquetes, o la unidad de la variante. */
  unidadCaptura(v: Variante): string {
    return this.esPaquete(v) ? 'paquetes' : (v.unidad_venta ?? 'kg');
  }

  /**
   * Peso real de los bultos que hay en el origen, por variante. Se consulta al
   * agregar la línea: el peso NOMINAL de la presentación no sirve para estimar,
   * porque los bultos varían mucho entre sí.
   */
  readonly pesos = signal<Record<number, EquivalenciaPaquetes>>({});

  /** Kilos que van a salir, con el peso real promedio de la bodega. */
  kilosReales(l: LineaEnvio): number | null {
    const eq = this.pesos()[l.variante.id];
    if (!eq || !eq.peso_referencia) return null;
    return Math.round(l.cantidad * eq.peso_referencia * 1000) / 1000;
  }

  /** Cuántos paquetes hay en el origen, para no pedir más. */
  disponibles(l: LineaEnvio): number | null {
    return this.pesos()[l.variante.id]?.disponible.paquetes ?? null;
  }

  /** Rango de peso de esos bultos: explica por qué el total es aproximado. */
  rangoPeso(l: LineaEnvio): string | null {
    const d = this.pesos()[l.variante.id]?.disponible;
    if (!d || !d.paquetes) return null;
    if (d.peso_min === d.peso_max) return `${d.peso_min} kg cada uno`;
    return `de ${d.peso_min} a ${d.peso_max} kg cada uno`;
  }

  /** Consulta los pesos reales de una variante en el almacén de origen. */
  private cargarPesos(varianteId: number): void {
    if (!this.origen) return;
    this.inv.equivalenciaPaquetes(varianteId, Number(this.origen)).subscribe({
      next: (eq) => this.pesos.update((m) => ({ ...m, [varianteId]: eq })),
      error: () => {},
    });
  }

  /** Al cambiar el origen cambian los pesos: se vuelven a consultar. */
  alCambiarOrigen(): void {
    this.pesos.set({});
    for (const l of this.lineas()) this.cargarPesos(l.variante.id);
  }

  /** Kilos que representan N paquetes según el peso NOMINAL (referencia vieja). */
  kilosDe(l: LineaEnvio): number | null {
    if (!this.esPaquete(l.variante) || !l.variante.peso_kg) return null;
    return Math.round(l.cantidad * Number(l.variante.peso_kg) * 1000) / 1000;
  }

  buscar(): void {
    if (!this.q.trim()) return;
    this.error.set(null);
    this.inv.buscarVariantes(this.q.trim()).subscribe({
      next: (vs) => this.resultados.set(vs),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  agregar(v: Variante): void {
    if (this.lineas().some((l) => l.variante.id === v.id)) {
      this.error.set(`"${v.sku}" ya está en el traspaso.`);
      return;
    }
    this.error.set(null);
    this.lineas.update((arr) => [...arr, { variante: v, cantidad: 1 }]);
    this.cargarPesos(v.id);
    this.q = '';
    this.resultados.set([]);
  }

  cambiarCantidad(l: LineaEnvio, cantidad: number): void {
    this.lineas.update((arr) =>
      arr.map((x) => (x.variante.id === l.variante.id ? { ...x, cantidad } : x))
    );
  }

  quitar(l: LineaEnvio): void {
    this.lineas.update((arr) => arr.filter((x) => x.variante.id !== l.variante.id));
  }

  enviar(): void {
    if (!this.origen || !this.destino) {
      this.error.set('Elige de dónde sale y a dónde llega el traspaso.');
      return;
    }
    if (this.origen === this.destino) {
      this.error.set('El origen y el destino tienen que ser distintos.');
      return;
    }
    const lineas = this.lineas();
    if (lineas.length === 0) {
      this.error.set('Agrega al menos un producto.');
      return;
    }
    if (lineas.some((l) => !l.cantidad || l.cantidad <= 0)) {
      this.error.set('Todas las líneas necesitan una cantidad mayor a cero.');
      return;
    }

    this.enviando.set(true);
    this.error.set(null);
    this.mensaje.set(null);

    const items: TraspasoItemInput[] = lineas.map((l) =>
      this.esPaquete(l.variante)
        ? { variante_id: l.variante.id, paquetes: l.cantidad }
        : { variante_id: l.variante.id, cantidad: l.cantidad }
    );

    this.inv
      .crearTraspaso({
        almacen_origen_id: Number(this.origen),
        almacen_destino_id: Number(this.destino),
        notas: this.notas.trim() || undefined,
        items,
      })
      .subscribe({
        next: (r) => {
          this.ultimo.set(r);
          this.mensaje.set(`Traspaso ${r.folio} enviado con ${r.lineas.length} producto(s).`);
          this.lineas.set([]);
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

  nombreAlmacen(id: number | ''): string {
    return this.almacenes().find((a) => a.id === Number(id))?.nombre ?? '';
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
