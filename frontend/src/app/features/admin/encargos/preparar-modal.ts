import { Component, ElementRef, OnInit, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VentasService } from '../../../core/services/ventas.service';
import { CodigoResuelto, InventarioService } from '../../../core/services/inventario.service';
import { Encargo, LineaPreparada, Pedido, PedidoLinea } from '../../../core/models/ventas.models';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { CantidadPipe } from '../../../shared/cantidad.pipe';

/** Un paquete escaneado para una línea. */
interface PaqueteListo {
  codigo: string;
  peso_kg: number;
  lote: string | null;
}

/** Cómo va quedando cada línea del pedido. */
interface LineaPrep {
  d: PedidoLinea;
  /** Paquete: los que van (escaneados). */
  paquetes: PaqueteListo[];
  /** Cono o por kilo: lo que pesó. */
  kg: number | null;
  /** Cono: cuántos conos son (informativo). */
  conos: number | null;
}

/**
 * PREPARAR un pedido (2026-10-06). "Cuando se pone el pedido se tienen que
 * escanear los paquetes o pesar los conos que pidió, para corroborar que sí esté
 * bien" (usuario). Al tomarlo se puso lo que pidió, aunque fuera aproximado; aquí:
 *
 *   · los PAQUETES se escanean (sin escanear no queda listo): van esos, con su
 *     peso real, y quedan apartados para el pedido;
 *   · los CONOS y lo que va por kilo se pesan: se teclea lo que pesaron (y
 *     cuántos conos son);
 *   · el total se recalcula con el peso real y el precio de cuando se tomó.
 *
 * El servidor recalcula y valida todo (`POST /pedidos/:id/preparar`); lo de aquí
 * es la vista previa. Queda "listo".
 */
@Component({
  selector: 'app-preparar-pedido-modal',
  imports: [FormsModule, DineroPipe, CantidadPipe],
  templateUrl: './preparar-modal.html',
  styleUrl: './preparar-modal.scss',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class PrepararPedidoModal implements OnInit {
  private readonly ventas = inject(VentasService);
  private readonly inv = inject(InventarioService);

  readonly pedido = input.required<Encargo>();
  readonly cerrado = output<void>();
  readonly preparado = output<Pedido>();

  private readonly lector = viewChild<ElementRef<HTMLInputElement>>('lector');

  readonly detalle = signal<Pedido | null>(null);
  readonly lineas = signal<LineaPrep[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly ultimo = signal<string | null>(null);

  codigo = '';
  /** Códigos que se están consultando: el lector dispara rápido y no se pierde ninguno. */
  private readonly enCamino = new Set<string>();

  ngOnInit(): void {
    this.ventas.obtenerPedido(this.pedido().id).subscribe({
      next: (p) => {
        this.detalle.set(p);
        // Al volver a prepararlo (ya estaba listo) se ve lo que se puso; la
        // primera vez, lo que va por kilo se pesa (el campo va vacío).
        const yaListo = p.estado === 'listo';
        this.lineas.set(
          (p.detalle ?? []).map((d) => ({
            d,
            paquetes: (d.bultos ?? []).map((b) => ({ codigo: b.codigo, peso_kg: Number(b.peso_kg), lote: b.lote ?? null })),
            kg: yaListo && d.tipo_presentacion !== 'paquete' ? Number(d.cantidad) : null,
            conos: d.piezas ?? null,
          }))
        );
        this.cargando.set(false);
        this.enfocar();
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  // ---- Cómo se lee cada línea ----

  hilo(d: PedidoLinea): string {
    return `${d.producto ?? d.descripcion}${d.calibre ? ' ' + d.calibre : ''}`;
  }

  esPaquete(l: LineaPrep): boolean {
    return l.d.tipo_presentacion === 'paquete';
  }

  /** Lo que pidió: "38 kg (≈ 2 paquetes)" o "6 conos · ≈ 9 kg". */
  pidio(l: LineaPrep): string {
    const kg = Number(l.d.cantidad).toLocaleString('es-MX', { maximumFractionDigits: 3 });
    if (l.d.tipo_presentacion === 'cono' && l.d.piezas) return `${l.d.piezas} ${l.d.piezas === 1 ? 'cono' : 'conos'} · ≈ ${kg} kg`;
    const peso = Number(l.d.peso_kg ?? 0);
    if (this.esPaquete(l) && peso > 0) {
      const n = Math.max(1, Math.round(Number(l.d.cantidad) / peso));
      return `${kg} kg (≈ ${n} ${n === 1 ? 'paquete' : 'paquetes'})`;
    }
    return `${kg} kg`;
  }

  /** Los kilos con que va a quedar la línea (null = todavía no se pesa). */
  kgDe(l: LineaPrep): number | null {
    if (this.esPaquete(l)) {
      return l.paquetes.length ? this.round3(l.paquetes.reduce((s, p) => s + p.peso_kg, 0)) : null;
    }
    const kg = Number(l.kg);
    return l.kg != null && (l.kg as unknown) !== '' && kg > 0 ? this.round3(kg) : null;
  }

  /** El importe de la línea con el peso real (precio de cuando se tomó). */
  importe(l: LineaPrep): number {
    const kg = this.kgDe(l) ?? Number(l.d.cantidad);
    const sub = this.round2(this.round2(Number(l.d.precio_unitario) * kg) - Number(l.d.descuento ?? 0));
    const subAntes = Number(l.d.subtotal);
    const tasa = Number(l.d.impuesto) > 0 && subAntes > 0 ? Number(l.d.impuesto) / subAntes : 0;
    return this.round2(sub + this.round2(sub * tasa));
  }

  /** El total con el peso real. Método (no computed): lee campos de ngModel. */
  total(): number {
    const p = this.detalle();
    if (!p) return 0;
    const lineas = this.lineas().reduce((s, l) => s + this.importe(l), 0);
    return this.round2(lineas - Number(p.descuento ?? 0) + Number(p.costo_envio ?? 0));
  }

  pagado(): number {
    return Number(this.pedido().pagado ?? 0);
  }

  /** Por qué no puede quedar listo todavía, o null. */
  motivo(): string | null {
    for (const l of this.lineas()) {
      if (this.esPaquete(l) && l.paquetes.length === 0) return `Escanea los paquetes de ${this.hilo(l.d)}.`;
      if (!this.esPaquete(l) && this.kgDe(l) === null) {
        return `Pesa ${l.d.tipo_presentacion === 'cono' ? 'los conos' : 'el hilo'} de ${this.hilo(l.d)} y escribe los kilos.`;
      }
    }
    return null;
  }

  // ---- El lector ----

  leer(): void {
    // Se lee y se vacía el campo DIRECTO (como al surtir): el último dígito y el
    // Enter del lector caen en el mismo ciclo y `codigo = ''` no se vería.
    const el = this.lector()?.nativeElement;
    const cod = (el?.value || this.codigo).trim();
    this.codigo = '';
    if (el) el.value = '';
    if (!cod) return;
    this.error.set(null);
    if (this.lineas().some((l) => l.paquetes.some((p) => p.codigo === cod)) || this.enCamino.has(cod)) {
      this.error.set(`El paquete ${cod} ya está en la lista.`);
      return;
    }
    this.enCamino.add(cod);
    this.inv.resolverCodigo(cod).subscribe({
      next: (r) => {
        this.enCamino.delete(cod);
        const motivo = this.motivoRechazo(cod, r);
        if (motivo) {
          this.error.set(motivo);
          this.ultimo.set(null);
          this.enfocar();
          return;
        }
        const b = r.bulto!;
        const paquete: PaqueteListo = { codigo: cod, peso_kg: Number(b.peso_kg), lote: b.lote ?? null };
        const vid = Number(b.variante_id);
        this.lineas.update((ls) => {
          // Si el mismo hilo viene en dos líneas, llena primero la que lleva menos.
          const candidatas = ls.filter((l) => this.esPaquete(l) && Number(l.d.variante_id) === vid);
          const destino = candidatas.find((l) => (this.kgDe(l) ?? 0) < Number(l.d.cantidad)) ?? candidatas[0];
          return ls.map((l) => (l === destino ? { ...l, paquetes: [...l.paquetes, paquete] } : l));
        });
        this.ultimo.set(`${cod} · ${paquete.peso_kg.toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg`);
        this.enfocar();
      },
      error: (e) => {
        this.enCamino.delete(cod);
        this.ultimo.set(null);
        this.error.set((e as { status?: number })?.status === 404 ? `El código ${cod} no está registrado.` : this.msg(e));
        this.enfocar();
      },
    });
  }

  /** Por qué ese código no puede ir en el pedido; null si sí. */
  private motivoRechazo(cod: string, r: CodigoResuelto): string | null {
    const b = r.bulto;
    if (!b) return `El código ${cod} es el de la presentación, no el de un paquete: escanea la etiqueta del paquete.`;
    const linea = this.lineas().find((l) => this.esPaquete(l) && Number(l.d.variante_id) === Number(b.variante_id));
    if (!linea) {
      const v = r.variante;
      return `El paquete ${cod} es de ${v.producto}${v.calibre ? ' ' + v.calibre : ''}, que no viene en este pedido.`;
    }
    // Ya apartado para ESTE pedido (se escaneó al tomarlo y se quitó de la lista): sí puede.
    const deEste = b.estado === 'apartado' && b.consumido_folio === this.pedido().numero_pedido;
    if (b.estado && b.estado !== 'disponible' && !deEste) {
      if (b.estado === 'apartado') {
        return `El paquete ${cod} está apartado para otro pedido${b.consumido_folio ? ` (${b.consumido_folio})` : ''}: escanea otro.`;
      }
      return b.estado === 'vendido' ? `El paquete ${cod} ya se vendió.` : `El paquete ${cod} ya se bajó a conos.`;
    }
    if (!(Number(b.peso_kg) > 0)) return `El paquete ${cod} no tiene peso registrado.`;
    return null;
  }

  quitar(l: LineaPrep, codigo: string): void {
    this.lineas.update((ls) => ls.map((x) => (x === l ? { ...x, paquetes: x.paquetes.filter((p) => p.codigo !== codigo) } : x)));
    this.ultimo.set(null);
    this.enfocar();
  }

  hayPaquetes(): boolean {
    return this.lineas().some((l) => this.esPaquete(l));
  }

  // ---- Guardar ----

  guardar(): void {
    const m = this.motivo();
    if (m) {
      this.error.set(m);
      return;
    }
    const lineas: LineaPreparada[] = this.lineas().map((l) =>
      this.esPaquete(l)
        ? { detalle_id: l.d.id, codigos: l.paquetes.map((p) => p.codigo) }
        : {
            detalle_id: l.d.id,
            cantidad: this.kgDe(l)!,
            ...(l.d.tipo_presentacion === 'cono' ? { piezas: l.conos != null && (l.conos as unknown) !== '' ? Number(l.conos) : null } : {}),
          }
    );
    this.guardando.set(true);
    this.error.set(null);
    this.ventas.prepararPedido(this.pedido().id, lineas).subscribe({
      next: (p) => {
        this.guardando.set(false);
        this.preparado.emit(p);
      },
      error: (e) => {
        this.guardando.set(false);
        this.error.set(this.msg(e));
      },
    });
  }

  cerrar(): void {
    this.cerrado.emit();
  }

  private enfocar(): void {
    setTimeout(() => this.lector()?.nativeElement.focus());
  }

  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  private round3(n: number): number {
    return Math.round((n + Number.EPSILON) * 1000) / 1000;
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
