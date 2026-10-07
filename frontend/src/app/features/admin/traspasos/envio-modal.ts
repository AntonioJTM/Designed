import { Component, ElementRef, OnInit, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  CodigoResuelto,
  InventarioService,
  ResultadoTraspaso,
  Traspaso,
  TraspasoLinea,
} from '../../../core/services/inventario.service';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';

/** Un paquete escaneado: su código, de qué hilo es y lo que pesa de verdad. */
export interface PaqueteEscaneado {
  codigo: string;
  variante_id: number;
  peso_kg: number;
  lote: string | null;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * ENVIAR un traspaso escaneando los paquetes que suben a la camioneta.
 *
 * Al surtir se escanea cada paquete que sale (usuario, 2026-10-06: "aquí cuando
 * se surte sí se escanean los paquetes que salen"). Con eso de cada hilo sale el
 * peso REAL de sus paquetes y ESOS quedan en la sucursal, en vez del aproximado
 * que se apartó al pedir. Pueden ser más o menos de los pedidos: sale lo que se
 * subió, y el modal lo dice.
 *
 * Cada código se revisa al escanearlo (que sea un paquete, de un hilo del
 * traspaso, disponible y con peso) para avisar en el momento y no al final; el
 * servidor lo vuelve a revisar al enviar.
 *
 * SIN ESCANEAR NO SE ENVÍA: "aquí cada cosa que sale se escanea, no se puede
 * enviar si no se escanea" (usuario, 2026-10-06). "Enviar" se apaga mientras no
 * haya ni un paquete escaneado; el servidor exige lo mismo.
 *
 * SE MANDA LO QUE HAY: "si pido 20 de negro 1/30 y solo tengo 15, que se envíen
 * esos y nada más". Un hilo con menos sale con los escaneados y uno sin ninguno
 * no sale; el modal lo dice antes de enviar y el servidor lo anota solo en las
 * notas del envío ("…era lo único que había"), junto con lo que se escriba aquí.
 *
 * El traspaso entra por input. No cierra al tocar el fondo: ✕, "Cancelar" o Escape.
 */
@Component({
  selector: 'app-envio-modal',
  imports: [FormsModule, CantidadPipe],
  templateUrl: './envio-modal.html',
  styleUrl: './envio-modal.scss',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class EnvioModal implements OnInit {
  private readonly inv = inject(InventarioService);

  readonly traspaso = input.required<Traspaso>();

  readonly cerrado = output<void>();
  /** Ya salió: la pantalla avisa y recarga. */
  readonly enviado = output<ResultadoTraspaso>();

  private readonly lector = viewChild<ElementRef<HTMLInputElement>>('lector');

  readonly escaneados = signal<PaqueteEscaneado[]>([]);
  readonly error = signal<string | null>(null);
  /** El último que entró, para que quien escanea vea que sí lo leyó. */
  readonly ultimo = signal<string | null>(null);
  readonly enviando = signal(false);
  codigo = '';
  /** Lo que quiera añadir quien surte; lo incompleto se anota solo. */
  notas = '';

  /** Códigos que se están consultando: el lector dispara rápido y no se pierde ninguno. */
  private readonly enCamino = new Set<string>();

  /** El input se lee aquí, no en el constructor: ahí todavía no está puesto. */
  ngOnInit(): void {
    setTimeout(() => this.enfocar());
  }

  lineas(): TraspasoLinea[] {
    return this.traspaso().lineas ?? [];
  }

  /** Color + calibre + material + línea: con el color solo no se sabe qué hilo es. */
  etiqueta(l: { producto: string; calibre?: string | null; material?: string | null; linea?: string | null }): string {
    const nombre = `${l.producto}${l.calibre ? ' ' + l.calibre : ''}`;
    return [nombre, l.material, l.linea].filter(Boolean).join(' · ');
  }

  /** Cuántos paquetes y cuántos kilos lleva escaneados cada hilo. */
  readonly porLinea = computed(() => {
    const m = new Map<number, { paquetes: number; kg: number }>();
    for (const p of this.escaneados()) {
      const a = m.get(p.variante_id) ?? { paquetes: 0, kg: 0 };
      m.set(p.variante_id, { paquetes: a.paquetes + 1, kg: r3(a.kg + p.peso_kg) });
    }
    return m;
  });

  cuantos(l: TraspasoLinea): number {
    return this.porLinea().get(l.variante_id)?.paquetes ?? 0;
  }

  kgDe(l: TraspasoLinea): number {
    return this.porLinea().get(l.variante_id)?.kg ?? 0;
  }

  pedidos(l: TraspasoLinea): number | null {
    const p = l.paquetes_solicitados ?? l.paquetes;
    return p != null ? Number(p) : null;
  }

  /** "Faltan 2" / "2 de más", contra lo pedido; nada si cuadra o no se ha escaneado. */
  diferencia(l: TraspasoLinea): string | null {
    const pedidos = this.pedidos(l);
    const n = this.cuantos(l);
    if (pedidos == null || n === 0 || n === pedidos) return null;
    return n < pedidos ? `faltan ${pedidos - n}` : `${n - pedidos} de más`;
  }

  readonly totalPaquetes = computed(() => this.escaneados().length);
  readonly totalKg = computed(() => r3(this.escaneados().reduce((s, p) => s + p.peso_kg, 0)));

  /**
   * Lo que no sale completo, dicho por hilo: "BLACK 2/30 (15 de 20)" o
   * "OPTIK 2/30 (no sale)". Se manda lo que hay y queda anotado.
   */
  readonly incompletos = computed(() => {
    const m = this.porLinea();
    return this.lineas()
      .map((l) => {
        const n = m.get(l.variante_id)?.paquetes ?? 0;
        const pedidos = this.pedidos(l);
        if (n === 0) return `${this.nombreDe(l.variante_id)} (no sale)`;
        if (pedidos != null && n < pedidos) return `${this.nombreDe(l.variante_id)} (${n} de ${pedidos})`;
        return null;
      })
      .filter((x): x is string => x !== null);
  });

  /** El último escaneado va arriba: es el que se acaba de subir. */
  readonly lista = computed(() => [...this.escaneados()].reverse());

  nombreDe(varianteId: number): string {
    const l = this.lineas().find((x) => x.variante_id === varianteId);
    return l ? `${l.producto}${l.calibre ? ' ' + l.calibre : ''}` : '';
  }

  leer(): void {
    // Se lee y se vacía el campo DIRECTO: el lector teclea tan rápido que el
    // último dígito y el Enter caen en el mismo ciclo de pantalla, y con solo
    // `codigo = ''` Angular no ve cambio (ya valía '') y el texto se queda; el
    // siguiente escaneo se pegaría al anterior.
    const el = this.lector()?.nativeElement;
    const cod = (el?.value || this.codigo).trim();
    this.codigo = '';
    if (el) el.value = '';
    if (!cod) return;
    this.error.set(null);
    if (this.escaneados().some((p) => p.codigo === cod) || this.enCamino.has(cod)) {
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
          return;
        }
        const b = r.bulto!;
        const paquete: PaqueteEscaneado = {
          codigo: cod,
          variante_id: Number(b.variante_id),
          peso_kg: Number(b.peso_kg),
          lote: b.lote ?? null,
        };
        this.escaneados.update((arr) => [...arr, paquete]);
        this.ultimo.set(`${cod} · ${paquete.peso_kg} kg · ${this.nombreDe(paquete.variante_id)}`);
        this.enfocar();
      },
      error: (e) => {
        this.enCamino.delete(cod);
        this.ultimo.set(null);
        this.error.set(
          (e as { status?: number })?.status === 404
            ? `El código ${cod} no está registrado.`
            : this.msg(e)
        );
        this.enfocar();
      },
    });
  }

  /** Por qué no puede salir ese código; null si sí. */
  private motivoRechazo(cod: string, r: CodigoResuelto): string | null {
    const b = r.bulto;
    if (!b) {
      return `El código ${cod} es el de la presentación, no el de un paquete: escanea la etiqueta del paquete.`;
    }
    if (!this.lineas().some((l) => l.variante_id === Number(b.variante_id))) {
      const v = r.variante;
      return `El paquete ${cod} es de ${v.producto}${v.calibre ? ' ' + v.calibre : ''}, que no está en este traspaso.`;
    }
    if (b.estado && b.estado !== 'disponible') {
      if (b.estado === 'apartado') {
        return `El paquete ${cod} está apartado para un pedido${b.consumido_folio ? ` (${b.consumido_folio})` : ''}: escanea otro.`;
      }
      return b.estado === 'vendido'
        ? `El paquete ${cod} ya se vendió${b.consumido_folio ? ` (${b.consumido_folio})` : ''}.`
        : `El paquete ${cod} ya se bajó a conos.`;
    }
    if (!(Number(b.peso_kg) > 0)) {
      return `El paquete ${cod} no tiene peso registrado: no se puede saber cuánto sale.`;
    }
    return null;
  }

  quitar(codigo: string): void {
    this.escaneados.update((arr) => arr.filter((p) => p.codigo !== codigo));
    this.ultimo.set(null);
    this.enfocar();
  }

  confirmar(): void {
    if (this.enviando()) return;
    if (this.totalPaquetes() === 0) {
      this.error.set('Escanea los paquetes que salen: sin escanear no se puede enviar.');
      return;
    }
    this.enviando.set(true);
    this.error.set(null);
    const codigos = this.escaneados().map((p) => p.codigo);
    this.inv.enviarTraspaso(this.traspaso().id, codigos, this.notas.trim() || undefined).subscribe({
      next: (r) => {
        this.enviando.set(false);
        this.enviado.emit(r);
      },
      error: (e) => {
        this.enviando.set(false);
        this.error.set(this.msg(e));
      },
    });
  }

  cerrar(): void {
    if (this.enviando()) return;
    this.cerrado.emit();
  }

  private enfocar(): void {
    this.lector()?.nativeElement.focus();
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
