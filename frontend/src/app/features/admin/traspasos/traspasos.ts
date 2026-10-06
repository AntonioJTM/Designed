import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
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
import { AuthService } from '../../../core/services/auth.service';
import { Almacen } from '../../../core/models/inventario.models';
import { Variante } from '../../../core/models/catalogo.models';
import { FechaPipe } from '../../../shared/fecha.pipe';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { CuandoPipe } from '../inventario/cuando.pipe';
import { FolioPipe } from '../../../shared/folio.pipe';
import { EnvioModal } from './envio-modal';

/**
 * Línea en captura. Se pide en PAQUETES y la pantalla dice cuántos kilos son
 * (2026-10-06: "las nuevas solicitudes de traspaso se van a hacer con paquetes
 * mostrando el aproximado en kilos"). Del 2026-07-28 a esa fecha se pedía en
 * kilos ("yo mando por kilos"); el usuario lo cambió.
 *
 * Los kilos son un APROXIMADO: paquetes × el peso promedio real de los paquetes
 * que hay en el origen. Quien surte agarra los que tenga a la mano, no los busca
 * por fecha (usuario, 2026-10-06), así que no se puede saber cuáles saldrán.
 */
interface LineaEnvio {
  variante: Variante;
  /** Paquetes que se piden. */
  paquetes: number;
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

/** Un paso del avance (Pedido → En camino → Recibido) y si ya se dio. */
interface Paso {
  texto: string;
  hecho: boolean;
  /** El último que se dio: es donde está el traspaso ahora. */
  actual: boolean;
}

/** Cuántos traspasos se traen: los pendientes y lo del mes para las cifras. */
const HISTORIAL = 100;

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
 * Se pide en PAQUETES (desde el 2026-10-06; antes en kilos) y al lado se dice
 * cuántos kilos son, más o menos. Al ENVIAR se escanean los paquetes que suben a
 * la camioneta (`EnvioModal`) y sale su peso real. Solo se mandan PAQUETES: los
 * conos nacen en la sucursal, al desarmarlos.
 */
@Component({
  selector: 'app-traspasos',
  imports: [FolioPipe, FormsModule, CantidadPipe, FechaPipe, CuandoPipe, EnvioModal],
  templateUrl: './traspasos.html',
  styleUrl: './traspasos.scss',
  // Los dos modales (acuse y cancelación) se cierran con Escape, nunca al
  // tocar el fondo: se perdería lo capturado.
  host: { '(document:keydown.escape)': 'alEscape()' },
})
export class Traspasos {
  private readonly inv = inject(InventarioService);
  private readonly auth = inject(AuthService);
  private readonly cuando = new CuandoPipe();

  /**
   * Enviar y recibir son permisos aparte: la bodega envía y la sucursal firma.
   * Sin el permiso no se ofrece el botón (el servidor lo rechazaría con 403).
   */
  readonly puedeEnviar = computed(() => this.auth.puede('hacer:enviar_traspaso'));
  readonly puedeRecibir = computed(() => this.auth.puede('hacer:recibir_traspaso'));

  /** El buscador de "Nueva solicitud", para llevar ahí el foco desde el encabezado. */
  private readonly buscador = viewChild<ElementRef<HTMLInputElement>>('buscador');

  readonly almacenes = signal<Almacen[]>([]);
  readonly historial = signal<Traspaso[]>([]);
  readonly resultados = signal<Variante[]>([]);
  readonly lineas = signal<LineaEnvio[]>([]);
  readonly ultimo = signal<ResultadoTraspaso | null>(null);
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  /** Traspaso que se está surtiendo: el modal donde se escanean los paquetes. */
  readonly porEnviar = signal<Traspaso | null>(null);

  /** Traspaso que se está cancelando, con su motivo. */
  readonly cancelando = signal<Traspaso | null>(null);
  motivoCancelacion = '';

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

  /** Total de la solicitud: los paquetes que se piden… */
  readonly totalPaquetes = computed(() => this.lineas().reduce((s, l) => s + (Number(l.paquetes) || 0), 0));

  /** …y los kilos que son, con el peso real de esos bultos. */
  readonly totalKg = computed(() => {
    this.pesos(); // depende también de los pesos que van llegando
    return Math.round(this.lineas().reduce((s, l) => s + (this.kgAprox(l) ?? 0), 0) * 1000) / 1000;
  });

  /** Los que están esperando algo: se muestran arriba, son los que hay que atender. */
  readonly pendientes = computed(() =>
    this.historial().filter((t) => t.estado === 'solicitado' || t.estado === 'en_transito')
  );
  readonly cerrados = computed(() =>
    this.historial().filter((t) => t.estado === 'recibido' || t.estado === 'cancelado')
  );

  /** Los recibidos de este mes: de ahí salen las cifras de "Recibidos" y "Faltó". */
  private readonly recibidosDelMes = computed(() => {
    const hoy = new Date();
    const mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    return this.historial().filter(
      (t) => t.estado === 'recibido' && String(t.recibido_en ?? '').startsWith(mes)
    );
  });

  /** Las cuatro cifras de arriba: qué espera a la bodega, qué va en camino y cómo llegó. */
  readonly kpis = computed(() => {
    const porEnviar = this.historial().filter((t) => t.estado === 'solicitado').length;
    const enCamino = this.historial().filter((t) => t.estado === 'en_transito').length;
    const recibidos = this.recibidosDelMes();
    const falto = Math.round(recibidos.reduce((s, t) => s + this.faltanteDe(t), 0) * 1000) / 1000;
    return [
      { etiqueta: 'Por enviar', valor: String(porEnviar), pie: 'solicitudes esperando a la bodega', punto: '#2457C5' },
      { etiqueta: 'En camino', valor: String(enCamino), pie: 'falta que confirmen que llegó', punto: '#E9A23B' },
      { etiqueta: 'Recibidos', valor: String(recibidos.length), pie: 'este mes', punto: '#1baf7a' },
      {
        etiqueta: 'Faltó al recibir',
        valor: `${falto.toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg`,
        pie: 'este mes · se asentó como merma',
        punto: '#C2410C',
      },
    ];
  });

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
    this.inv.traspasos(undefined, HISTORIAL).subscribe({
      next: (p) => this.historial.set(p.items),
      error: () => {},
    });
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
   * Cuánto pesa, en promedio, un paquete de ese hilo en el origen (o el peso del
   * catálogo si ahí no hay paquetes con peso). Es el mismo peso con que aparta el
   * servidor (`inventario/model.js → pesoPorPaquete`).
   */
  pesoPaquete(l: LineaEnvio): number | null {
    const eq = this.pesos()[l.variante.id];
    return eq ? Number(eq.peso_referencia) : null;
  }

  /** ¿El peso salió del catálogo porque en el origen no hay paquetes con peso? */
  pesoDeCatalogo(l: LineaEnvio): boolean {
    return !!this.pesos()[l.variante.id]?.referencia_nominal;
  }

  /**
   * Cuántos kilos son, más o menos, los paquetes pedidos: paquetes × el peso
   * promedio. Con bultos se multiplica por kilos ÷ paquetes SIN redondear el
   * promedio, igual que el servidor: redondeado, pedir TODOS los paquetes daba
   * unos gramos más de los que hay y no dejaba.
   */
  kgAprox(l: LineaEnvio): number | null {
    const eq = this.pesos()[l.variante.id];
    if (!eq) return null;
    const n = Math.max(0, Math.floor(Number(l.paquetes) || 0));
    const d = eq.disponible;
    const kg = eq.referencia_nominal || !d.paquetes
      ? n * Number(eq.peso_referencia)
      : (n * Number(d.kg_en_bultos)) / d.paquetes;
    return Math.round(kg * 1000) / 1000;
  }

  /** Cuántos paquetes caben en lo LIBRE del origen, con ese mismo peso promedio. */
  paquetesLibres(l: LineaEnvio): number | null {
    const eq = this.pesos()[l.variante.id];
    const libre = this.kilosLibres(l);
    if (!eq || libre == null) return null;
    const d = eq.disponible;
    const porPaquete = eq.referencia_nominal || !d.paquetes
      ? Number(eq.peso_referencia)
      : Number(d.kg_en_bultos) / d.paquetes;
    return porPaquete > 0 ? Math.max(0, Math.floor((libre + 0.0005) / porPaquete)) : 0;
  }

  /** Cuántos paquetes con peso hay en el origen: el promedio sale de ellos. */
  paquetesEnOrigen(l: LineaEnvio): number {
    return this.pesos()[l.variante.id]?.disponible.paquetes ?? 0;
  }

  /** Kilos LIBRES en el origen: la existencia menos lo ya apartado a otras solicitudes. */
  kilosLibres(l: LineaEnvio): number | null {
    const d = this.pesos()[l.variante.id]?.disponible;
    return d ? Number(d.kg_libre ?? d.kg_inventario) : null;
  }

  /** Lo que ya tiene dueño en el origen, para explicar por qué lo libre es menos. */
  kilosApartados(l: LineaEnvio): number {
    return Number(this.pesos()[l.variante.id]?.disponible.kg_apartado ?? 0);
  }

  /**
   * ¿Alcanza? Los kilos que son esos paquetes contra los kilos LIBRES del origen:
   * es lo que valida el servidor. Es la alerta que pidió el usuario: que no deje
   * mandar la solicitud si no hay.
   */
  insuficiente(l: LineaEnvio): boolean {
    const hay = this.kilosLibres(l);
    const kg = this.kgAprox(l);
    return hay != null && kg != null && kg > hay + 0.0005;
  }

  /** Alguna línea no alcanza: la solicitud no se puede mandar. */
  readonly hayInsuficientes = computed(() => this.lineas().some((l) => this.insuficiente(l)));

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
    this.lineas.update((arr) => [...arr, { variante: v, paquetes: 1 }]);
    this.cargarPesos(v.id);
    this.q = '';
    this.resultados.set([]);
  }

  cambiarPaquetes(l: LineaEnvio, paquetes: number): void {
    this.lineas.update((arr) =>
      arr.map((x) => (x.variante.id === l.variante.id ? { ...x, paquetes: Number(paquetes) || 0 } : x))
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
    if (lineas.some((l) => !Number.isInteger(Number(l.paquetes)) || Number(l.paquetes) <= 0)) {
      this.error.set('Todas las líneas necesitan los paquetes que se piden (enteros).');
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

    // En PAQUETES: el servidor toma los bultos que de verdad hay (los más
    // antiguos) y aparta su peso real. Una presentación que no es paquete (la
    // "simple") no lleva bultos por paquete: va en los kilos que son.
    const items: TraspasoItemInput[] = lineas.map((l) =>
      l.variante.tipo_presentacion === 'paquete'
        ? { variante_id: l.variante.id, paquetes: Number(l.paquetes) }
        : { variante_id: l.variante.id, cantidad: this.kgAprox(l) ?? 0 }
    );

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

  /** "Enviar" abre el modal donde se escanean los paquetes que suben. */
  enviarTraspaso(t: Traspaso): void {
    this.error.set(null);
    this.mensaje.set(null);
    this.porEnviar.set(t);
  }

  /** Ya salió: dice qué salió de verdad (lo escaneado) y recarga. */
  alEnviar(r: ResultadoTraspaso): void {
    this.porEnviar.set(null);
    const paq = r.lineas.reduce((s, l) => s + Number(l.paquetes ?? 0), 0);
    const kg = Math.round(r.lineas.reduce((s, l) => s + Number(l.cantidad), 0) * 1000) / 1000;
    const incompletos = r.lineas.filter(
      (l) => l.paquetes_pedidos != null && Number(l.paquetes) < l.paquetes_pedidos
    ).length;
    this.mensaje.set(
      `Traspaso ${r.folio} en camino: ${paq} ${paq === 1 ? 'paquete escaneado' : 'paquetes escaneados'}, ` +
        `${kg.toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg reales.` +
        (incompletos
          ? ` ${incompletos === 1 ? 'Un hilo no salió completo' : `${incompletos} hilos no salieron completos`}: quedó en la nota del envío.`
          : '')
    );
    this.cargarHistorial();
  }

  // ---- Paso 3 · Recibir ----

  /** Abre el acuse con lo enviado precargado: por omisión llegó todo. */
  abrirRecepcion(t: Traspaso): void {
    this.error.set(null);
    this.mensaje.set(null);
    this.notasRecepcion = '';
    this.recibiendo.set(t);
    this.lineasRecepcion.set(
      // Lo que no salió (no había) no se recibe: no viene en la camioneta.
      (t.lineas ?? []).filter((l) => !this.noSalio(l)).map((l) => {
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

  /**
   * Pregunta por qué se cancela, en un modal. Cerrarlo (✕, "No cancelar" o
   * Escape) quiere decir "no cancelo el traspaso"; confirmar sin escribir nada
   * sí cancela, sin motivo. Antes era un `prompt()` y un `?? ''` convertía el
   * "Cancelar" del navegador en motivo vacío: se cancelaba justo lo que se pidió
   * no cancelar.
   */
  cancelar(t: Traspaso): void {
    this.error.set(null);
    this.mensaje.set(null);
    this.motivoCancelacion = '';
    this.cancelando.set(t);
  }

  cerrarCancelacion(): void {
    this.cancelando.set(null);
    this.motivoCancelacion = '';
  }

  confirmarCancelacion(): void {
    const t = this.cancelando();
    if (!t) return;
    this.enviando.set(true);
    this.error.set(null);
    this.inv.cancelarTraspaso(t.id, this.motivoCancelacion.trim() || undefined).subscribe({
      next: (r) => {
        this.enviando.set(false);
        this.mensaje.set(
          `Traspaso ${r.folio} cancelado.` +
            (t.estado === 'en_transito' ? ' La mercancía regresó al origen.' : ' Se liberó lo apartado.')
        );
        this.cerrarCancelacion();
        this.cargarHistorial();
      },
      error: (e) => {
        this.enviando.set(false);
        this.error.set(this.msg(e));
      },
    });
  }

  /** Escape cierra el modal que esté abierto, sin hacer nada. */
  alEscape(): void {
    if (this.enviando()) return;
    if (this.cancelando()) this.cerrarCancelacion();
    else if (this.recibiendo()) this.cerrarRecepcion();
  }

  /** "Nueva solicitud" del encabezado: lleva a la tarjeta y deja listo el buscador. */
  irANueva(): void {
    const input = this.buscador()?.nativeElement;
    input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input?.focus({ preventScroll: true });
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

  /** Lo que le falta a este traspaso, dicho en una frase. */
  siguientePaso(t: Traspaso): string {
    if (t.estado === 'solicitado') return 'Falta enviarlo desde el origen.';
    if (t.estado === 'en_transito') return 'Falta que la sucursal acepte que lo recibió.';
    return '';
  }

  /** Pedido → En camino → Recibido, con lo que ya pasó marcado. */
  pasos(t: Traspaso): Paso[] {
    const n = t.estado === 'solicitado' ? 1 : t.estado === 'en_transito' ? 2 : 3;
    return ['Pedido', 'En camino', 'Recibido'].map((texto, i) => ({
      texto,
      hecho: i < n,
      actual: i === n - 1,
    }));
  }

  /** Lo que lleva, dicho en una línea: cuántos hilos, cuántos kilos y dónde está. */
  resumenLleva(t: Traspaso): string {
    // Lo que no salió no se lleva.
    const lineas = (t.lineas ?? []).filter((l) => !this.noSalio(l));
    const kg = Math.round(lineas.reduce((s, l) => s + Number(l.cantidad), 0) * 1000) / 1000;
    const partes = [
      `${lineas.length} ${lineas.length === 1 ? 'hilo' : 'hilos'}`,
      `${kg.toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg`,
    ];
    if (t.estado === 'solicitado') partes.push(`apartados en ${t.almacen_origen}`);
    const paq = lineas.reduce((s, l) => s + Number(l.paquetes ?? 0), 0);
    if (t.estado === 'en_transito' && paq > 0) {
      partes.push(
        `${paq.toLocaleString('es-MX', { maximumFractionDigits: 2 })} ${paq === 1 ? 'paquete' : 'paquetes'}`
      );
    }
    return partes.join(' · ');
  }

  /** Quién lo movió por última vez y cuándo. */
  quien(t: Traspaso): string {
    if (t.estado === 'en_transito') {
      return (
        `Salió ${this.cuando.transform(t.enviado_en)}` + (t.enviado_por ? ` · lo envió ${t.enviado_por}` : '')
      );
    }
    return `Pidió ${t.usuario || '—'} · ${this.cuando.transform(t.creado_en)}`;
  }

  /** Kilos que no llegaron de un traspaso recibido: se asentaron como merma. */
  faltanteDe(t: Traspaso): number {
    const kg = (t.lineas ?? []).reduce((s, l) => {
      if (l.cantidad_recibida == null) return s;
      return s + Math.max(0, Number(l.cantidad) - Number(l.cantidad_recibida));
    }, 0);
    return Math.round(kg * 1000) / 1000;
  }

  /** La pastilla de un traspaso cerrado: si llegó completo, si faltó algo, o si se canceló. */
  estadoCerrado(t: Traspaso): { texto: string; clase: string } {
    if (t.estado === 'cancelado') return { texto: 'Cancelado', clase: 'gris' };
    const falto = this.faltanteDe(t);
    if (falto > 0) {
      return {
        texto: `Faltaron ${falto.toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg`,
        clase: 'ambar',
      };
    }
    return { texto: 'Recibido', clase: 'verde' };
  }

  /** Lo recibido de una línea ya cerrada, para el historial. */
  /** Un hilo que se pidió y no salió: no había. */
  noSalio(l: TraspasoLinea): boolean {
    return l.paquetes_solicitados != null && Number(l.cantidad) === 0;
  }

  /**
   * Los paquetes de la línea, contra lo pedido cuando no cuadra: "15 de 20 paq"
   * (salió menos) o "21 paq, se pidieron 20".
   */
  paquetesTexto(l: TraspasoLinea): string | null {
    if (l.paquetes == null) return null;
    const p = Number(l.paquetes);
    const s = l.paquetes_solicitados != null ? Number(l.paquetes_solicitados) : null;
    if (s == null || p === s) return `${p} paq`;
    return p < s ? `${p} de ${s} paq` : `${p} paq, se pidieron ${s}`;
  }

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
