import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  EquivalenciaPaquetes,
  EstadoTraspaso,
  InventarioService,
  ResultadoTraspaso,
  Traspaso,
  TraspasoItemInput,
  TraspasoLinea,
} from '../../../core/services/inventario.service';
import { Almacen } from '../../../core/models/inventario.models';
import { Variante } from '../../../core/models/catalogo.models';
import { FechaPipe } from '../../../shared/fecha.pipe';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';

/**
 * Línea en captura. La cantidad va en KILOS, siempre: así es como pide la
 * sucursal ("mándame 100 kg de negro") y así se lleva el inventario. Antes se
 * capturaba en paquetes y se convertía; lo corrigió el usuario el 2026-07-28:
 * "cuando me hacen un pedido no me dicen cuántos paquetes, yo mando por kilos".
 */
interface LineaEnvio {
  variante: Variante;
  /** Kilos que se piden. */
  kg: number;
}

/** Lo que el responsable declara de una línea al recibir. */
interface LineaRecepcion {
  detalle_id: number;
  etiqueta: string;
  /** En paquetes si así se pidió; si no, en kilos. */
  enPaquetes: boolean;
  enviado: number;
  recibido: number;
}

/**
 * Surtir sucursales. El traspaso tiene TRES pasos, no uno:
 *   1. Se SOLICITA — se valida que haya existencia y se aparta en el origen.
 *   2. Se ENVÍA — sale del origen y queda en camino.
 *   3. Se RECIBE — el responsable acepta, dice qué llegó y queda su nombre.
 *
 * Antes era inmediato (salía y entraba de golpe). Lo pidió el usuario el
 * 2026-07-28: "necesito un status de en tránsito y así pendiente de envío, y que
 * el responsable acepte de que recibió y que diga qué recibió, para que no haya
 * problemas".
 *
 * Se pide en KILOS —"cuando me hacen un pedido no me dicen cuántos paquetes, yo
 * mando por kilos"— y al lado se muestra a cuántos paquetes equivale, con el peso
 * real de los bultos. Solo se mandan PAQUETES: los conos nacen en la sucursal, al
 * desarmarlos.
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

  /** Traspaso cuya recepción se está capturando, con lo que se declara. */
  readonly recibiendo = signal<Traspaso | null>(null);
  readonly lineasRecepcion = signal<LineaRecepcion[]>([]);
  notasRecepcion = '';

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

  /** Total de la solicitud, en kilos: es la unidad de todo el flujo. */
  readonly totalKg = computed(() =>
    Math.round(this.lineas().reduce((s, l) => s + (Number(l.kg) || 0), 0) * 1000) / 1000
  );

  /** Los que están esperando algo: se muestran arriba, son los que hay que atender. */
  readonly pendientes = computed(() =>
    this.historial().filter((t) => t.estado === 'solicitado' || t.estado === 'en_transito')
  );
  readonly cerrados = computed(() =>
    this.historial().filter((t) => t.estado === 'recibido' || t.estado === 'cancelado')
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
    this.inv.traspasos(undefined, 50).subscribe({
      next: (p) => this.historial.set(p.items),
      error: () => {},
    });
  }

  esPaquete(v: Variante): boolean {
    return v.tipo_presentacion === 'paquete';
  }

  /** Cómo se identifica el hilo: el color solo no alcanza. */
  etiquetaHilo(v: {
    producto?: string | null;
    calibre?: string | null;
    material?: string | null;
    linea?: string | null;
  }): string {
    const base = [v.producto, v.calibre].filter(Boolean).join(' ');
    const clas = [v.material, v.linea].filter(Boolean).join(' · ');
    return clas ? `${base} — ${clas}` : base;
  }


  /**
   * Peso real de los bultos que hay en el origen, por variante. Se consulta al
   * agregar la línea: el peso NOMINAL de la presentación no sirve para estimar,
   * porque los bultos varían mucho entre sí.
   */
  readonly pesos = signal<Record<number, EquivalenciaPaquetes>>({});

  /**
   * A cuántos paquetes equivalen los kilos pedidos, con el peso promedio REAL de
   * los bultos que hay en el origen. Es solo para leerlo como lo cuenta la tienda;
   * lo que se manda son los kilos.
   */
  enPaquetes(l: LineaEnvio): number | null {
    const eq = this.pesos()[l.variante.id];
    if (!eq || !eq.peso_referencia || !l.kg) return null;
    return Math.round((Number(l.kg) / eq.peso_referencia) * 100) / 100;
  }

  /** Cuántos bultos hay en el origen, como referencia. */
  disponibles(l: LineaEnvio): number | null {
    return this.pesos()[l.variante.id]?.disponible.paquetes ?? null;
  }

  /** Kilos LIBRES en el origen: la existencia menos lo ya apartado a otras solicitudes. */
  kilosLibres(l: LineaEnvio): number | null {
    const d = this.pesos()[l.variante.id]?.disponible;
    return d ? Number(d.kg_inventario) : null;
  }

  /**
   * ¿Alcanza? Todo en KILOS: es lo que se pide y es la unidad del inventario. Es
   * la alerta que pidió el usuario: que no deje mandar la solicitud si no hay.
   */
  insuficiente(l: LineaEnvio): boolean {
    const hay = this.kilosLibres(l);
    return hay != null && Number(l.kg) > hay;
  }

  /** Alguna línea no alcanza: la solicitud no se puede mandar. */
  readonly hayInsuficientes = computed(() => this.lineas().some((l) => this.insuficiente(l)));

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

  buscar(): void {
    if (!this.q.trim()) return;
    this.error.set(null);
    this.inv.buscarVariantes(this.q.trim()).subscribe({
      // A la sucursal se le mandan PAQUETES cerrados: el cono se hace allá.
      next: (vs) => this.resultados.set(vs.filter((v) => v.tipo_presentacion !== 'cono')),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  agregar(v: Variante): void {
    if (this.lineas().some((l) => l.variante.id === v.id)) {
      this.error.set(`"${v.sku}" ya está en la solicitud.`);
      return;
    }
    this.error.set(null);
    this.lineas.update((arr) => [...arr, { variante: v, kg: 0 }]);
    this.cargarPesos(v.id);
    this.q = '';
    this.resultados.set([]);
  }

  cambiarKg(l: LineaEnvio, kg: number): void {
    this.lineas.update((arr) =>
      arr.map((x) => (x.variante.id === l.variante.id ? { ...x, kg } : x))
    );
  }

  quitar(l: LineaEnvio): void {
    this.lineas.update((arr) => arr.filter((x) => x.variante.id !== l.variante.id));
  }

  // ---- Paso 1 · Solicitar ----

  solicitar(): void {
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
    if (lineas.some((l) => !l.kg || Number(l.kg) <= 0)) {
      this.error.set('Todas las líneas necesitan los kilos que se piden.');
      return;
    }
    // La alerta la da la pantalla antes de molestar al servidor; el backend la
    // vuelve a validar de todos modos.
    if (this.hayInsuficientes()) {
      this.error.set(
        'Hay líneas sin existencia suficiente en el origen. Ajusta las cantidades o quítalas.'
      );
      return;
    }

    this.enviando.set(true);
    this.error.set(null);
    this.mensaje.set(null);

    // Siempre en kilos: el backend acepta `cantidad` para cualquier presentación
    // y ya no hay que convertir nada aquí.
    const items: TraspasoItemInput[] = lineas.map((l) => ({
      variante_id: l.variante.id,
      cantidad: Number(l.kg),
    }));

    this.inv
      .solicitarTraspaso({
        almacen_origen_id: Number(this.origen),
        almacen_destino_id: Number(this.destino),
        notas: this.notas.trim() || undefined,
        items,
      })
      .subscribe({
        next: (r) => {
          this.ultimo.set(r);
          this.mensaje.set(
            `Solicitud ${r.folio} creada con ${r.lineas.length} producto(s). La mercancía quedó ` +
              `apartada; ahora hay que enviarla.`
          );
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

  // ---- Paso 2 · Enviar ----

  enviarTraspaso(t: Traspaso): void {
    this.error.set(null);
    this.mensaje.set(null);
    this.inv.enviarTraspaso(t.id).subscribe({
      next: (r) => {
        const ajustadas = r.lineas.filter((l) => l.ajustado).length;
        this.mensaje.set(
          `Traspaso ${r.folio} en camino.` +
            (ajustadas > 0
              ? ` ${ajustadas} línea(s) cambiaron de peso: salieron los bultos que de verdad había.`
              : '')
        );
        this.cargarHistorial();
      },
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  // ---- Paso 3 · Recibir ----

  /** Abre el acuse con lo enviado precargado: por omisión llegó todo. */
  abrirRecepcion(t: Traspaso): void {
    this.error.set(null);
    this.mensaje.set(null);
    this.notasRecepcion = '';
    this.recibiendo.set(t);
    this.lineasRecepcion.set(
      (t.lineas ?? []).map((l) => {
        const enPaquetes = l.paquetes != null;
        const enviado = enPaquetes ? Number(l.paquetes) : Number(l.cantidad);
        return {
          detalle_id: Number(l.detalle_id),
          etiqueta: this.etiquetaHilo(l),
          enPaquetes,
          enviado,
          recibido: enviado,
        };
      })
    );
  }

  cerrarRecepcion(): void {
    this.recibiendo.set(null);
    this.lineasRecepcion.set([]);
  }

  cambiarRecibido(detalleId: number, valor: number): void {
    this.lineasRecepcion.update((arr) =>
      arr.map((l) => (l.detalle_id === detalleId ? { ...l, recibido: valor } : l))
    );
  }

  /** Cuántas líneas llegan incompletas: se avisa antes de firmar. */
  readonly faltantesRecepcion = computed(() =>
    this.lineasRecepcion().filter((l) => l.recibido < l.enviado)
  );

  confirmarRecepcion(): void {
    const t = this.recibiendo();
    if (!t) return;
    const lineas = this.lineasRecepcion();
    if (lineas.some((l) => l.recibido < 0 || l.recibido > l.enviado)) {
      this.error.set('Lo recibido no puede ser negativo ni mayor a lo que se envió.');
      return;
    }
    this.enviando.set(true);
    this.error.set(null);
    this.inv
      .recibirTraspaso(t.id, {
        notas: this.notasRecepcion.trim() || undefined,
        recibido: lineas.map((l) =>
          l.enPaquetes
            ? { detalle_id: l.detalle_id, paquetes: l.recibido }
            : { detalle_id: l.detalle_id, cantidad: l.recibido }
        ),
      })
      .subscribe({
        next: (r) => {
          this.mensaje.set(
            `Traspaso ${r.folio} recibido.` +
              (r.faltantes
                ? ` ${r.faltantes} línea(s) llegaron incompletas: la diferencia quedó como faltante en el kardex.`
                : ' Llegó completo.')
          );
          this.enviando.set(false);
          this.cerrarRecepcion();
          this.cargarHistorial();
        },
        error: (e) => {
          this.error.set(this.msg(e));
          this.enviando.set(false);
        },
      });
  }

  cancelar(t: Traspaso): void {
    const motivo = prompt(`¿Por qué se cancela el traspaso ${t.folio}?`) ?? '';
    if (motivo === null) return;
    this.error.set(null);
    this.inv.cancelarTraspaso(t.id, motivo.trim() || undefined).subscribe({
      next: (r) => {
        this.mensaje.set(
          `Traspaso ${r.folio} cancelado.` +
            (t.estado === 'en_transito' ? ' La mercancía regresó al origen.' : ' Se liberó lo apartado.')
        );
        this.cargarHistorial();
      },
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  // ---- Etiquetas de estado ----

  textoEstado(e: EstadoTraspaso): string {
    return {
      solicitado: 'Pendiente de envío',
      en_transito: 'En tránsito',
      recibido: 'Recibido',
      cancelado: 'Cancelado',
    }[e];
  }

  /** Clase de la pastilla: verde recibido, ámbar en camino, rojo cancelado. */
  claseEstado(e: EstadoTraspaso): string {
    return { solicitado: 'warn', en_transito: 'warn', recibido: 'ok', cancelado: 'off' }[e];
  }

  /** Lo que le falta a este traspaso, dicho en una frase. */
  siguientePaso(t: Traspaso): string {
    if (t.estado === 'solicitado') return 'Falta enviarlo desde el origen.';
    if (t.estado === 'en_transito') return 'Falta que la sucursal acepte que lo recibió.';
    return '';
  }

  /** Lo recibido de una línea ya cerrada, para el historial. */
  recibidoDe(l: TraspasoLinea): string | null {
    if (l.cantidad_recibida == null) return null;
    const rec = Number(l.cantidad_recibida);
    const env = Number(l.cantidad);
    return rec === env ? 'completo' : `llegaron ${rec} de ${env} kg`;
  }

  nombreAlmacen(id: number | ''): string {
    return this.almacenes().find((a) => a.id === Number(id))?.nombre ?? '';
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
