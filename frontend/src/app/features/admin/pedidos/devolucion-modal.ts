import {
  Component, ElementRef, Injector, OnDestroy, OnInit, afterNextRender, inject, input, output, signal, viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VentasService } from '../../../core/services/ventas.service';
import { ClientesService } from '../../../core/services/clientes.service';
import {
  LineaDevolvible,
  PreviaDevolucion,
  ResultadoDevolucion,
} from '../../../core/models/ventas.models';
import { ClienteParaVenta } from '../../../core/models/clientes.models';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { FolioPipe } from '../../../shared/folio.pipe';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * DEVOLUCIÓN CON SALDO A FAVOR (2026-10-13): "un cliente te compra hilo y
 * regresa una parte o todo: no le quiero regresar dinero, lo que se le tiene
 * que agregar es como un saldo a favor de lo que regresó" (usuario).
 *
 * Se hace desde la nota, línea por línea, como en su ejemplo ("me llevé 3
 * paquetes de 12 conos y regreso 2 paquetes intactos y del otro solo 2 conos"):
 *   · los paquetes CERRADOS se escanean (con el lector de arriba): vuelven como
 *     paquetes, con su peso, y se pueden volver a vender;
 *   · lo SUELTO se pesa —lo que marque la báscula, sin restar tubos— y entra
 *     como conos.
 * Lo que regresa queda a favor al precio con que se vendió. Si ESTA venta
 * todavía se debe (a crédito o pendiente de pago), primero se descuenta de ella,
 * sin preguntar (2026-10-14). Si debe algo más, se elige si lo que sobra se
 * descuenta de eso o se queda a favor para sus compras.
 */
@Component({
  selector: 'app-devolucion-modal',
  imports: [FormsModule, CantidadPipe, DineroPipe, FolioPipe],
  templateUrl: './devolucion-modal.html',
  styleUrl: './devolucion-modal.scss',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class DevolucionModal implements OnInit, OnDestroy {
  private readonly ventas = inject(VentasService);
  private readonly clientes = inject(ClientesService);
  private readonly injector = inject(Injector);

  readonly pedidoId = input.required<number>();
  readonly numero = input<string>('');
  readonly hecho = output<ResultadoDevolucion>();
  readonly cerrado = output<void>();

  private readonly lector = viewChild<ElementRef<HTMLInputElement>>('lector');

  readonly previa = signal<PreviaDevolucion | null>(null);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  /** Lo último que se escaneó, para que el cajero vea que entró. */
  readonly ultimo = signal<string | null>(null);
  /**
   * El resumen ("Regresan 40.7 kg: $8,140 a favor") para el lector de pantalla.
   * Se dice cuando se deja de teclear, no en cada número: con el resumen entero
   * en una región viva, repetía todo en cada tecla de los kilos.
   */
  readonly anuncio = signal('');
  private anuncioTimer: ReturnType<typeof setTimeout> | null = null;

  codigo = '';
  /** Los paquetes cerrados que regresan, por línea (detalle_id → códigos). */
  codigos: Record<number, string[]> = {};
  /** Lo suelto que regresa, en kg, por línea. */
  kgSueltos: Record<number, number | null> = {};
  /** Cuántos conos eran (informativo). */
  conos: Record<number, number | null> = {};
  destino: 'favor' | 'deuda' = 'favor';
  notas = '';

  // La venta sin cliente: a quién se le pone el saldo a favor.
  readonly clienteElegido = signal<ClienteParaVenta | null>(null);
  readonly resultados = signal<ClienteParaVenta[]>([]);
  readonly buscando = signal(false);
  busqueda = '';
  private buscarTimer: ReturnType<typeof setTimeout> | null = null;

  /** Una línea con paquetes que todavía pueden regresar cerrados (para mostrar el lector). */
  readonly lineaConPaquetes = (l: LineaDevolvible): boolean => l.bultos.some((b) => b.devolvible);

  ngOnInit(): void {
    this.cargar();
  }

  ngOnDestroy(): void {
    if (this.anuncioTimer) clearTimeout(this.anuncioTimer);
    if (this.buscarTimer) clearTimeout(this.buscarTimer);
  }

  /** Cambió lo que regresa: el resumen se anuncia un momento después de la última tecla. */
  cambio(): void {
    if (this.anuncioTimer) clearTimeout(this.anuncioTimer);
    this.anuncioTimer = setTimeout(() => {
      const total = this.total();
      const deEsta = this.descuentaDeEsta();
      this.anuncio.set(total > 0
        ? `Regresan ${this.kg(this.kgTotal())}: ${this.dinero(total)}.` +
          (deEsta > 0 ? ` Se descuentan ${this.dinero(deEsta)} de esta nota.` : '') +
          ` Le queda ${this.dinero(this.quedaAFavor())} a favor.`
        : '');
    }, 900);
  }

  /** El cursor al lector (al elegir el cliente, el buscador desaparece). Con el dedo, no: abriría el teclado. */
  private enfocarLector(): void {
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return;
    afterNextRender(() => this.lector()?.nativeElement.focus(), { injector: this.injector });
  }

  private cargar(clienteId?: number): void {
    this.cargando.set(true);
    this.ventas.previaDevolucion(this.pedidoId(), clienteId).subscribe({
      next: (p) => {
        this.previa.set(p);
        for (const l of p.lineas) {
          this.codigos[l.detalle_id] ??= [];
          if (!(l.detalle_id in this.kgSueltos)) this.kgSueltos[l.detalle_id] = null;
          if (!(l.detalle_id in this.conos)) this.conos[l.detalle_id] = null;
        }
        if (this.otrasDeudas() <= 0.004) this.destino = 'favor';
        this.cargando.set(false);
        if (clienteId) this.enfocarLector();
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  // ---- El lector ----

  leer(): void {
    // Se lee y se vacía el campo DIRECTO (como en la ventana de envío): el lector
    // teclea tan rápido que el último dígito y el Enter caen en el mismo ciclo y
    // con solo `codigo = ''` el texto se quedaría pegado al siguiente escaneo.
    const el = this.lector()?.nativeElement;
    const cod = (el?.value || this.codigo).trim();
    this.codigo = '';
    if (el) el.value = '';
    if (!cod) return;
    this.error.set(null);
    this.ultimo.set(null);
    const p = this.previa();
    if (!p) return;
    const linea = p.lineas.find((l) => l.bultos.some((b) => b.codigo === cod));
    const bulto = linea?.bultos.find((b) => b.codigo === cod);
    if (!linea || !bulto) {
      this.error.set(`El paquete ${cod} no salió en esta nota.`);
      return;
    }
    if (this.codigos[linea.detalle_id].includes(cod)) {
      this.error.set(`El paquete ${cod} ya está en la lista.`);
      return;
    }
    if (bulto.devuelto) {
      this.error.set(`El paquete ${cod} ya se había devuelto.`);
      return;
    }
    if (bulto.abierto) {
      this.error.set(`El paquete ${cod} se bajó a conos: ya no regresa cerrado. Pesa los conos que regresan.`);
      return;
    }
    if (!bulto.devolvible) {
      this.error.set(`El paquete ${cod} no puede regresar cerrado.`);
      return;
    }
    this.codigos[linea.detalle_id] = [...this.codigos[linea.detalle_id], cod];
    this.ultimo.set(`${cod} · ${this.kg(bulto.peso_kg)} · ${linea.hilo}`);
    this.cambio();
  }

  quitar(l: LineaDevolvible, cod: string): void {
    this.codigos[l.detalle_id] = this.codigos[l.detalle_id].filter((c) => c !== cod);
    this.lector()?.nativeElement.focus();
    this.cambio();
  }

  pesoDe(l: LineaDevolvible, cod: string): number {
    return Number(l.bultos.find((b) => b.codigo === cod)?.peso_kg ?? 0);
  }

  /** Los paquetes de la línea que todavía pueden regresar cerrados. */
  porEscanear(l: LineaDevolvible): number {
    return l.bultos.filter((b) => b.devolvible && !this.codigos[l.detalle_id]?.includes(b.codigo)).length;
  }

  // ---- Las cuentas (métodos, no computed: dependen de campos con ngModel) ----

  kgPaquetes(l: LineaDevolvible): number {
    return r3((this.codigos[l.detalle_id] ?? []).reduce((s, c) => s + this.pesoDe(l, c), 0));
  }

  kgSuelto(l: LineaDevolvible): number {
    const v = Number(this.kgSueltos[l.detalle_id]);
    return Number.isFinite(v) && v > 0 ? r3(v) : 0;
  }

  kgLinea(l: LineaDevolvible): number {
    return r3(this.kgPaquetes(l) + this.kgSuelto(l));
  }

  /** Lo que regresa de esta línea pasa de lo que todavía puede regresar. */
  excede(l: LineaDevolvible): boolean {
    return this.kgLinea(l) > l.disponible + 0.0005;
  }

  /** A favor por esta línea, redondeado igual que el servidor (paquetes y suelto por separado). */
  importe(l: LineaDevolvible): number {
    return r2(r2(this.kgPaquetes(l) * l.precio_kg) + r2(this.kgSuelto(l) * l.precio_kg));
  }

  total(): number {
    return r2((this.previa()?.lineas ?? []).reduce((s, l) => s + this.importe(l), 0));
  }

  kgTotal(): number {
    return r3((this.previa()?.lineas ?? []).reduce((s, l) => s + this.kgLinea(l), 0));
  }

  /** Hay a quién ponerle el saldo: la venta tiene cliente, o ya se eligió uno. */
  hayCliente(): boolean {
    return !!this.previa()?.cliente_id || !!this.clienteElegido();
  }

  nombreCliente(): string {
    const p = this.previa();
    if (p?.cliente) return p.cliente;
    const c = this.clienteElegido();
    return c ? c.nombre_comercial || c.nombre : '';
  }

  /** Por qué todavía no se puede registrar (o null si ya se puede). */
  motivoNoListo(): string | null {
    const p = this.previa();
    if (!p) return 'Cargando…';
    if (!p.se_puede) return 'Esta nota no se puede devolver.';
    if (!this.hayCliente()) return 'Elige a quién se le pone el saldo a favor.';
    const excede = p.lineas.find((l) => this.excede(l));
    if (excede) return `De ${excede.hilo} a lo más regresan ${this.kg(excede.disponible)}.`;
    if (this.total() <= 0) return 'Escanea los paquetes cerrados o pesa lo que regresa suelto.';
    return null;
  }

  /** Lo que todavía debe ESTA venta: de ahí se descuenta primero lo que regresa. */
  debeEsta(): number {
    return Math.max(0, Number(this.previa()?.debe_esta ?? 0));
  }

  /** Lo que debe aparte de esta venta (sus otras notas y su cuenta). */
  otrasDeudas(): number {
    const p = this.previa();
    return p ? r2(Math.max(0, p.deuda.total - this.debeEsta())) : 0;
  }

  /**
   * Se pregunta qué hacer con lo que sobra solo si debe algo más y de verdad
   * sobra algo (si esta nota se debe, lo que regresa se descuenta de ella primero).
   */
  preguntaDestino(): boolean {
    if (!this.hayCliente() || this.otrasDeudas() <= 0.004) return false;
    return this.debeEsta() <= 0 || this.total() > this.debeEsta() + 0.004;
  }

  /** Lo que se descuenta de esta venta: lo que regresa, hasta lo que debe. */
  descuentaDeEsta(): number {
    return r2(Math.min(this.total(), this.debeEsta()));
  }

  /** De lo que sobra, lo que se descuenta de lo demás que debe (si así se eligió). */
  descuentaDeOtras(): number {
    const sobra = r2(this.total() - this.descuentaDeEsta());
    return this.destino === 'deuda' ? r2(Math.min(sobra, this.otrasDeudas())) : 0;
  }

  /** Lo que le queda a favor después de esta devolución. */
  quedaAFavor(): number {
    const p = this.previa();
    if (!p) return 0;
    return r2(p.saldo_favor + this.total() - this.descuentaDeEsta() - this.descuentaDeOtras());
  }

  // ---- El cliente, si la venta no tenía ----

  alBuscar(): void {
    if (this.buscarTimer) clearTimeout(this.buscarTimer);
    const q = this.busqueda.trim();
    if (q.length < 2) {
      this.resultados.set([]);
      return;
    }
    this.buscarTimer = setTimeout(() => {
      this.buscando.set(true);
      this.clientes.buscar(q).subscribe({
        next: (r) => {
          this.resultados.set(r);
          this.buscando.set(false);
        },
        error: () => this.buscando.set(false),
      });
    }, 250);
  }

  elegir(c: ClienteParaVenta): void {
    this.clienteElegido.set(c);
    this.resultados.set([]);
    this.busqueda = '';
    // Para decir cuánto debe ESE cliente y su saldo a favor.
    this.cargar(c.id);
  }

  cambiarCliente(): void {
    this.clienteElegido.set(null);
    this.destino = 'favor';
    this.cargar();
  }

  // ---- Registrar ----

  registrar(): void {
    const p = this.previa();
    if (!p || this.motivoNoListo() || this.guardando()) return;
    this.guardando.set(true);
    this.error.set(null);
    const lineas = p.lineas
      .map((l) => ({
        detalle_id: l.detalle_id,
        codigos: this.codigos[l.detalle_id]?.length ? this.codigos[l.detalle_id] : undefined,
        kg_sueltos: this.kgSuelto(l) || undefined,
        conos: this.kgSuelto(l) && Number(this.conos[l.detalle_id]) > 0 ? Math.round(Number(this.conos[l.detalle_id])) : undefined,
      }))
      .filter((l) => l.codigos || l.kg_sueltos);
    this.ventas
      .devolver(this.pedidoId(), {
        destino: this.preguntaDestino() ? this.destino : 'favor',
        cliente_id: p.cliente_id ? undefined : this.clienteElegido()?.id,
        notas: this.notas.trim() || undefined,
        lineas,
      })
      .subscribe({
        next: (r) => {
          this.guardando.set(false);
          this.hecho.emit(r);
        },
        error: (e) => {
          this.guardando.set(false);
          this.error.set(this.msg(e));
        },
      });
  }

  cerrar(): void {
    if (!this.guardando()) this.cerrado.emit();
  }

  kg(v: number): string {
    return `${Number(v).toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg`;
  }

  private dinero(v: number): string {
    return Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'No se pudo registrar la devolución.';
  }
}
