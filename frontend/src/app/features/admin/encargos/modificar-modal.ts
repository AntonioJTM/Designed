import { Component, ElementRef, OnInit, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VentasService } from '../../../core/services/ventas.service';
import { CodigoResuelto, InventarioService } from '../../../core/services/inventario.service';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';
import { Encargo, LineaPedidoEdit, Pedido } from '../../../core/models/ventas.models';
import { Variante } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { paqueteFueraDeAqui } from '../../../shared/paquete-aqui';

/** Un paquete escaneado de una línea. */
interface PaqueteDeLinea {
  codigo: string;
  peso_kg: number;
  lote: string | null;
}

/** Una línea del pedido mientras se modifica. */
export interface LineaEdit {
  /** null = hilo nuevo, todavía no guardado. */
  detalle_id: number | null;
  variante_id: number;
  hilo: string;
  tipo: string;
  /** Precio por kilo: el congelado de la línea; en lo nuevo, el público (aproximado). */
  precio: number;
  descuento: number;
  /** Tasa de impuesto (0.16 = 16 %). */
  tasa: number;
  /** Los kilos con que estaba (0 si es nueva). */
  antes: number;
  paquetes: PaqueteDeLinea[];
  /** Kilos tecleados cuando la línea no lleva paquetes escaneados. */
  kg: number | null;
  conos: number | null;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * MODIFICAR un pedido en espera (2026-10-07: "mejor que sean notas en espera,
 * porque hay casos donde el cliente quiere modificar su pedido, agregar o quitar
 * cosas"). Mientras no se entrega se le puede:
 *   · quitar un hilo (lo apartado queda libre) o cambiarle los kilos o los conos;
 *   · escanear paquetes (entra su peso real y quedan apartados para el cliente;
 *     un código de un hilo que no llevaba lo agrega);
 *   · agregar un hilo buscándolo, por kilos;
 *   · cambiar la entrega, la dirección, el envío, para cuándo y las notas.
 * El servidor rehace el total (`PUT /pedidos/:id/encargo`): lo que ya llevaba
 * conserva su precio; lo nuevo se cobra con la lista del cliente. Aquí el total
 * es la vista previa.
 *
 * No se cierra al tocar el fondo: ✕, "Cancelar" o Escape (si hay cambios sin
 * guardar, pregunta).
 */
@Component({
  selector: 'app-modificar-pedido-modal',
  imports: [FormsModule, DineroPipe, CantidadPipe],
  templateUrl: './modificar-modal.html',
  styleUrl: './modificar-modal.scss',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class ModificarPedidoModal implements OnInit {
  private readonly ventas = inject(VentasService);
  private readonly inv = inject(InventarioService);
  private readonly confirmacion = inject(ConfirmacionService);

  readonly pedido = input.required<Encargo>();
  readonly cerrado = output<void>();
  readonly guardado = output<Pedido>();

  private readonly lector = viewChild<ElementRef<HTMLInputElement>>('lector');

  readonly detalle = signal<Pedido | null>(null);
  readonly lineas = signal<LineaEdit[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly ultimo = signal<string | null>(null);
  readonly resultados = signal<Variante[]>([]);

  codigo = '';
  q = '';
  // La entrega, como notas.
  entrega: 'recoger' | 'envio' = 'recoger';
  direccion = '';
  costoEnvio: number | null = null;
  paraCuando = '';
  notas = '';
  /** Para saber si algo cambió (y preguntar antes de salir). */
  private original = '';

  ngOnInit(): void {
    const e = this.pedido();
    this.entrega = e.metodo_entrega === 'envio' ? 'envio' : 'recoger';
    this.direccion = e.entrega_direccion ?? '';
    this.costoEnvio = Number(e.costo_envio ?? 0) || null;
    this.paraCuando = e.entrega_para ?? '';
    this.notas = e.notas ?? '';
    this.ventas.obtenerPedido(e.id).subscribe({
      next: (p) => {
        this.detalle.set(p);
        this.lineas.set(
          (p.detalle ?? []).map((d) => {
            const sub = Number(d.subtotal);
            return {
              detalle_id: d.id,
              variante_id: d.variante_id,
              hilo: `${d.producto ?? d.descripcion}${d.calibre ? ' ' + d.calibre : ''}`,
              tipo: d.tipo_presentacion ?? 'simple',
              precio: Number(d.precio_unitario),
              descuento: Number(d.descuento ?? 0),
              tasa: sub > 0 ? Number(d.impuesto) / sub : 0,
              antes: Number(d.cantidad),
              paquetes: (d.bultos ?? []).map((b) => ({ codigo: b.codigo, peso_kg: Number(b.peso_kg), lote: b.lote ?? null })),
              kg: (d.bultos ?? []).length ? null : Number(d.cantidad),
              conos: d.piezas ?? null,
            };
          })
        );
        this.original = this.firma();
        this.cargando.set(false);
      },
      error: (err) => {
        this.error.set(this.msg(err));
        this.cargando.set(false);
      },
    });
  }

  // ---- Cómo va quedando ----

  /** Los kilos de la línea: lo que pesan sus paquetes, o lo tecleado. */
  kgDe(l: LineaEdit): number | null {
    if (l.paquetes.length) return r3(l.paquetes.reduce((s, p) => s + p.peso_kg, 0));
    const kg = Number(l.kg);
    return l.kg != null && (l.kg as unknown) !== '' && kg > 0 ? r3(kg) : null;
  }

  importe(l: LineaEdit): number {
    const sub = r2(r2(l.precio * (this.kgDe(l) ?? 0)) - l.descuento);
    return r2(sub + r2(sub * l.tasa));
  }

  /** El total con lo que se lleva ahora. Método (no computed): lee campos de ngModel. */
  total(): number {
    const p = this.detalle();
    const lineas = this.lineas().reduce((s, l) => s + this.importe(l), 0);
    const envio = this.entrega === 'envio' ? Number(this.costoEnvio ?? 0) : 0;
    return r2(lineas - Number(p?.descuento ?? 0) + envio);
  }

  pagado(): number {
    return Number(this.pedido().pagado ?? 0);
  }

  /** Hay hilos nuevos: su precio lo pone la lista del cliente al guardar. */
  hayNuevos(): boolean {
    return this.lineas().some((l) => l.detalle_id == null);
  }

  tipoTexto(l: LineaEdit): string {
    return l.tipo === 'cono' ? 'conos' : l.tipo === 'paquete' ? 'paquete' : 'por kilo';
  }

  /** Por qué todavía no se puede guardar, o null. */
  motivo(): string | null {
    if (!this.lineas().length) return 'El pedido se quedaría sin nada: si ya no lo quiere, cancélalo.';
    const sinKg = this.lineas().find((l) => this.kgDe(l) === null);
    if (sinKg) {
      return sinKg.tipo === 'paquete'
        ? `Escanea los paquetes de ${sinKg.hilo} o escribe sus kilos.`
        : `Escribe cuántos kilos van de ${sinKg.hilo}.`;
    }
    if (this.entrega === 'envio' && !this.direccion.trim()) return 'Si lo lleva el chofer, di a dónde.';
    return null;
  }

  // ---- Quitar y agregar ----

  quitarLinea(l: LineaEdit): void {
    this.lineas.update((ls) => ls.filter((x) => x !== l));
    this.ultimo.set(null);
  }

  quitarPaquete(l: LineaEdit, codigo: string): void {
    this.lineas.update((ls) => ls.map((x) => (x === l ? { ...x, paquetes: x.paquetes.filter((p) => p.codigo !== codigo) } : x)));
  }

  /** Busca hilos para agregar (con lo que hay en el almacén del pedido). */
  buscar(): void {
    const q = this.q.trim();
    if (!q) return;
    this.inv.buscarVariantes(q, this.pedido().almacen_id).subscribe({
      next: (vs) => this.resultados.set(vs.filter((v) => v.activo !== false && (v.activo as unknown) !== 0)),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  hayAqui(v: Variante): string {
    const kg = Number(v.aqui?.cantidad ?? 0);
    if (!(kg > 0)) return 'no hay en el almacén del pedido';
    const kilos = `${kg.toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg`;
    return v.aqui?.paquetes ? `${v.aqui.paquetes} paq · ${kilos}` : kilos;
  }

  nombreDe(v: { producto?: string | null; calibre?: string | null }): string {
    return `${v.producto ?? ''}${v.calibre ? ' ' + v.calibre : ''}`;
  }

  /** Agrega un hilo de la búsqueda (sin kilos todavía: se teclean o se escanean sus paquetes). */
  agregar(v: Variante): void {
    if (this.lineas().some((l) => l.variante_id === v.id)) {
      this.error.set(`${this.nombreDe(v)} ya viene en el pedido: cámbiale los kilos ahí.`);
      return;
    }
    this.error.set(null);
    this.lineas.update((ls) => [...ls, this.lineaNueva(v)]);
    this.resultados.set([]);
    this.q = '';
  }

  private lineaNueva(v: Variante): LineaEdit {
    return {
      detalle_id: null,
      variante_id: v.id,
      hilo: this.nombreDe(v),
      tipo: v.tipo_presentacion ?? 'simple',
      precio: Number(v.precio_oferta ?? v.precio ?? 0),
      descuento: 0,
      tasa: 0,
      antes: 0,
      paquetes: [],
      kg: null,
      conos: null,
    };
  }

  // ---- El lector ----

  leer(): void {
    // Se lee y se vacía el campo DIRECTO: el último dígito y el Enter del lector
    // caen en el mismo ciclo y `codigo = ''` no se vería.
    const el = this.lector()?.nativeElement;
    const cod = (el?.value || this.codigo).trim();
    this.codigo = '';
    if (el) el.value = '';
    if (!cod) return;
    this.error.set(null);
    if (this.lineas().some((l) => l.paquetes.some((p) => p.codigo === cod))) {
      this.error.set(`El paquete ${cod} ya está en el pedido.`);
      return;
    }
    this.inv.resolverCodigo(cod).subscribe({
      next: (r) => {
        const motivo = this.motivoRechazo(cod, r);
        if (motivo) {
          this.error.set(motivo);
          this.ultimo.set(null);
          return;
        }
        const b = r.bulto!;
        const paquete: PaqueteDeLinea = { codigo: cod, peso_kg: Number(b.peso_kg), lote: b.lote ?? null };
        const vid = Number(b.variante_id);
        this.lineas.update((ls) => {
          const linea = ls.find((l) => l.variante_id === vid);
          // Un paquete de un hilo que no llevaba: se agrega ese hilo.
          if (!linea) return [...ls, { ...this.lineaNueva(r.variante), paquetes: [paquete] }];
          return ls.map((l) => (l === linea ? { ...l, paquetes: [...l.paquetes, paquete], kg: null } : l));
        });
        this.ultimo.set(`${cod} · ${paquete.peso_kg.toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg · ${this.nombreDe(r.variante)}`);
        setTimeout(() => this.lector()?.nativeElement.focus());
      },
      error: (e) => {
        this.ultimo.set(null);
        this.error.set((e as { status?: number })?.status === 404 ? `El código ${cod} no está registrado.` : this.msg(e));
      },
    });
  }

  /** Por qué ese código no puede ir en el pedido; null si sí. */
  private motivoRechazo(cod: string, r: CodigoResuelto): string | null {
    const b = r.bulto;
    if (!b) return `El código ${cod} es el de la presentación, no el de un paquete: escanea la etiqueta del paquete.`;
    // Ya apartado para ESTE pedido (se quitó de la lista y se vuelve a escanear): sí puede.
    const delMismo = b.estado === 'apartado' && b.consumido_folio === this.pedido().numero_pedido;
    if (b.estado && b.estado !== 'disponible' && !delMismo) {
      if (b.estado === 'apartado') {
        const de = b.consumido_folio?.startsWith('TRA') ? 'un envío a sucursal' : 'otro pedido';
        return `El paquete ${cod} está apartado para ${de}${b.consumido_folio ? ` (${b.consumido_folio})` : ''}: escanea otro.`;
      }
      return b.estado === 'vendido' ? `El paquete ${cod} ya se vendió.`
        : b.estado === 'faltante' ? `El paquete ${cod} se dio por faltante al recibir un envío (no llegó).`
          : `El paquete ${cod} ya se bajó a conos.`;
    }
    if (!(Number(b.peso_kg) > 0)) return `El paquete ${cod} no tiene peso registrado.`;
    // Solo los paquetes de la tienda del pedido (2026-10-07); los que ya eran
    // de este pedido ya se revisaron al ponerlos.
    if (!delMismo) return paqueteFueraDeAqui(b, this.pedido().almacen_id, this.pedido().almacen);
    return null;
  }

  // ---- Guardar y salir ----

  guardar(): void {
    const m = this.motivo();
    if (m) {
      this.error.set(m);
      return;
    }
    const lineas: LineaPedidoEdit[] = this.lineas().map((l) => ({
      ...(l.detalle_id != null ? { detalle_id: l.detalle_id } : { variante_id: l.variante_id }),
      codigos: l.paquetes.map((p) => p.codigo),
      cantidad: this.kgDe(l)!,
      ...(l.tipo === 'cono' ? { piezas: l.conos != null && (l.conos as unknown) !== '' ? Number(l.conos) : null } : {}),
    }));
    this.guardando.set(true);
    this.error.set(null);
    this.ventas
      .modificarPedido(this.pedido().id, {
        lineas,
        metodo_entrega: this.entrega,
        entrega_direccion: this.entrega === 'envio' ? this.direccion.trim() : null,
        costo_envio: this.entrega === 'envio' ? Number(this.costoEnvio ?? 0) : 0,
        entrega_para: this.paraCuando || null,
        notas: this.notas.trim() || null,
      })
      .subscribe({
        next: (p) => {
          this.guardando.set(false);
          this.original = this.firma();
          this.guardado.emit(p);
        },
        error: (e) => {
          this.guardando.set(false);
          this.error.set(this.msg(e));
        },
      });
  }

  async cerrar(): Promise<void> {
    if (this.guardando()) return;
    if (!this.cargando() && this.firma() !== this.original) {
      const si = await this.confirmacion.pedir({
        titulo: '¿Salir sin guardar los cambios?',
        mensaje: 'Lo que cambiaste del pedido no se ha guardado: si sales, se pierde.',
        aceptar: 'Salir sin guardar',
        cancelar: 'Seguir modificando',
        peligro: true,
      });
      if (!si) return;
    }
    this.cerrado.emit();
  }

  /** Una huella de lo que está en pantalla, para saber si cambió algo. */
  private firma(): string {
    return JSON.stringify({
      l: this.lineas().map((l) => [l.detalle_id, l.variante_id, l.paquetes.map((p) => p.codigo), this.kgDe(l), l.conos]),
      e: [this.entrega, this.direccion.trim(), Number(this.costoEnvio ?? 0), this.paraCuando, this.notas.trim()],
    });
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
