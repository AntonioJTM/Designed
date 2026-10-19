import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { VentasService } from '../../../core/services/ventas.service';
import { TicketService } from '../../../core/services/ticket.service';
import { llevaTicket } from '../../../shared/ticket/ticket';
import { AuthService } from '../../../core/services/auth.service';
import {
  DevolucionHecha,
  DevolucionLinea,
  EstadoPedido,
  PagoLinea,
  Pedido,
  PedidoLinea,
  ResultadoDevolucion,
} from '../../../core/models/ventas.models';
import { FechaPipe, hoyLocal } from '../../../shared/fecha.pipe';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { ApiError } from '../../../core/models/auth.models';
import { etiquetaEstado, tonoEstado } from './estados';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';
import { DevolucionModal } from './devolucion-modal';
import { BotonWhatsapp } from '../../../shared/ticket/boton-whatsapp';

/** Una cifra de la franja de arriba del pedido. */
interface CifraPedido {
  etiqueta: string;
  valor: number;
  /** Lo que se debe va en naranja: es lo que hay que perseguir. */
  alerta?: boolean;
  /** Una línea corta debajo de la cifra ("debe $200", "ya está pagado"). */
  pie?: string;
}

/** Un renglón de la tabla de pagos. */
interface FilaPago {
  como: string;
  monto: number;
  estado: string;
  tono: string;
  referencia?: string | null;
  /** En una nota (pendiente de pago, en espera o apartado) cada pago es un abono con su ticket. */
  pagoId?: number;
  /** En efectivo (2026-10-16): lo que entregó y el cambio que se le dio. */
  recibido?: number | null;
  cambio?: number | null;
}

/** Algo que le pasó al pedido, con su fecha. */
interface Suceso {
  t: string;
  que: string;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * DETALLE DEL PEDIDO (rediseño 2026-10). Arriba, una franja con el folio, el
 * estado, quién y dónde, y las acciones (imprimir, devolver, cancelar); abajo
 * los artículos con sus bultos, los pagos y "lo que ha pasado".
 *
 * Cancelar y devolver piden el permiso del puesto (`hacer:cancelar_venta`);
 * sin él los botones no se ofrecen y el servidor también lo rechaza.
 */
@Component({
  selector: 'app-pedido-detalle',
  host: { '(document:keydown.escape)': 'alEscape()' },
  imports: [BotonWhatsapp, FormsModule, RouterLink, FechaPipe, CantidadPipe, DineroPipe, DevolucionModal],
  templateUrl: './pedido-detalle.html',
  styleUrls: ['./pedido-detalle.scss', './pedido-devoluciones.scss'],
})
export class PedidoDetalle implements OnDestroy {
  private readonly ventas = inject(VentasService);
  private readonly tickets = inject(TicketService);
  private readonly confirmacion = inject(ConfirmacionService);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);

  readonly pedido = signal<Pedido | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  readonly puedeCancelar = computed(() => this.auth.puede('hacer:cancelar_venta'));
  readonly veClientes = computed(() => this.auth.puede('ver:clientes'));
  readonly veEncargos = computed(() => this.auth.puede('ver:encargos'));
  readonly veNotas = computed(() => this.auth.puede('ver:notas_pendientes'));
  private readonly fechaPipe = new FechaPipe();

  readonly etiquetaEstado = etiquetaEstado;
  readonly tonoEstado = tonoEstado;

  nuevoEstado: EstadoPedido | '' = '';

  private readonly ESTADOS_VENTA: EstadoPedido[] = [
    'pendiente', 'pagado', 'en_preparacion', 'enviado', 'entregado', 'cancelado', 'devuelto',
  ];

  /**
   * Un APARTADO sin entregar tiene su propio camino y el selector no ofrece
   * atajos: se entrega desde Apartados (exige liquidarlo y ahí se descuenta),
   * aquí solo se cancela, y cancelado se reactiva como apartado. Como
   * "pendiente" o "entregado" quedaba una venta viva sin la mercancía apartada
   * ni descontada. El backend lo valida igual.
   */
  readonly estados = computed<EstadoPedido[]>(() => {
    const p = this.pedido();
    // Un PEDIDO sin entregar está en espera: solo se cancela; cancelado, se
    // reactiva en espera. Se modifica y se ENTREGA desde Pedidos (cobra y descuenta).
    if (p && this.esEncargo(p) && this.esApartadoSinEntregar(p)) {
      if (this.inactivo(p)) return [p.estado, 'en_preparacion'];
      return [p.estado, 'cancelado'];
    }
    if (p && this.esApartadoSinEntregar(p)) {
      return p.estado === 'apartado' ? ['apartado', 'cancelado'] : [p.estado, 'apartado'];
    }
    return this.ESTADOS_VENTA;
  });

  /**
   * Lo que ofrece el selector de estado. Cancelar y devolver tienen sus propios
   * botones en la cabecera; aquí solo aparecen si el puesto tiene el permiso,
   * para no ofrecer algo que el servidor va a rechazar. El estado actual se
   * queda siempre, para que el selector diga dónde está.
   */
  readonly opcionesEstado = computed<EstadoPedido[]>(() => {
    const p = this.pedido();
    const actual = p?.estado;
    // "En preparación" y "Enviado" son del envío de la tienda en línea: en una
    // venta de mostrador no significan nada (y la tienda está apagada).
    const enLinea = p?.canal === 'tienda_linea';
    // …salvo en un PEDIDO sin entregar, que está en espera.
    const pasosDePedido = !!p && this.esEncargo(p) && this.esApartadoSinEntregar(p);
    // Una venta FIADA se da por pagada sola al abonar: no se ofrece marcarla
    // pagada (o entregada) mientras se deba, ni regresarla a pendiente si ya se
    // pagó. El servidor lo valida igual (VENTA_FIADA_SIN_PAGAR / _PAGADA).
    const fiadaVigente = !!p && this.fiado(p) > 0 && !this.inactivo(p);
    const debe = fiadaVigente ? this.fiadoPorPagar(p!) > 0.004 : false;
    // Una NOTA PENDIENTE DE PAGO igual: se da por pagada sola con sus abonos
    // (NOTA_PENDIENTE_SIN_PAGAR / NOTA_YA_PAGADA en el servidor).
    const nota = !!p && this.esNotaPendiente(p) && !fiadaVigente && !this.inactivo(p);
    const notaDebe = nota ? this.faltaNota(p!) > 0.004 : false;
    // Desde el 2026-10-13 lo que regresa queda A FAVOR del cliente (botón
    // «Devolución»): "devuelto" regresaba el dinero y ya no se ofrece. Y una
    // venta con devoluciones ya no se cancela completa (VENTA_CON_DEVOLUCIONES).
    const conDevoluciones = !!p?.devoluciones?.length;
    return this.estados().filter((e) => {
      if (e === actual) return true;
      if (e === 'devuelto') return false;
      if (conDevoluciones && e === 'cancelado') return false;
      if (!this.puedeCancelar() && e === 'cancelado') return false;
      if (!enLinea && !pasosDePedido && (e === 'en_preparacion' || e === 'enviado')) return false;
      if (fiadaVigente && actual === 'pendiente' && debe && e !== 'cancelado') return false;
      if (fiadaVigente && e === 'pendiente' && !debe) return false;
      if (nota && actual === 'pendiente' && notaDebe && e !== 'cancelado') return false;
      if (nota && e === 'pendiente' && !notaDebe) return false;
      return true;
    });
  });

  /** ¿Es una NOTA EN ESPERA (encargo)? */
  esEncargo(p: Pedido): boolean {
    return !!Number(p.encargo ?? 0);
  }

  /** ¿Salió como NOTA PENDIENTE DE PAGO (se la llevó y paga después)? */
  esNotaPendiente(p: Pedido): boolean {
    return !!Number(p.nota_pendiente ?? 0);
  }

  /** Lo que falta de una nota pendiente de pago (sus abonos son pagos). */
  faltaNota(p: Pedido): number {
    return Math.max(0, Math.round((Number(p.total) - this.pagado(p)) * 100) / 100);
  }

  /** Cómo se entrega un pedido, en palabras: "lo recoge" o "lo lleva el chofer a…", y para cuándo. */
  entregaDelPedido(p: Pedido): string {
    const como = p.metodo_entrega === 'envio'
      ? `lo lleva el chofer${p.entrega_direccion ? ' a ' + p.entrega_direccion : ''}`
      : 'lo recoge en la tienda';
    return p.entrega_para ? `${como} · para el ${this.fechaPipe.transform(p.entrega_para, true)}` : como;
  }

  /** Nunca descontó: es un apartado vigente, o uno que se canceló antes de entregarse. */
  esApartadoSinEntregar(p: Pedido): boolean {
    return !Number(p.inventario_descontado ?? 1);
  }

  /** Ya no cuenta: cancelado o devuelto. */
  inactivo(p: Pedido): boolean {
    return p.estado === 'cancelado' || p.estado === 'devuelto';
  }

  /**
   * Nació como apartado: está apartado, nunca descontó, o se entregó desde
   * Apartados (`entregado_en` solo lo pone esa entrega).
   */
  nacioApartado(p: Pedido): boolean {
    return p.estado === 'apartado' || this.esApartadoSinEntregar(p) || !!p.entregado_en;
  }

  // ---- Las cifras de la franja ----

  /** Lo cobrado: pagos completados. */
  pagado(p: Pedido): number {
    return (p.pagos ?? [])
      .filter((g) => g.estado === 'completado')
      .reduce((s, g) => s + Number(g.monto), 0);
  }

  /** Lo que se cargó a su cuenta con esta venta (el cargo original). */
  fiado(p: Pedido): number {
    return (p.credito ?? [])
      .filter((m) => m.tipo === 'cargo')
      .reduce((s, m) => s + Number(m.monto), 0);
  }

  /** Lo que sigue en su cuenta por esta venta: el cargo menos lo que se quitó al cancelar. */
  fiadoVigente(p: Pedido): number {
    const neto = (p.credito ?? []).reduce(
      (s, m) => s + (m.tipo === 'abono' ? -1 : 1) * Number(m.monto),
      0
    );
    return Math.max(0, Math.round(neto * 100) / 100);
  }

  /**
   * Lo que todavía se debe de lo fiado en ESTA venta. Los abonos van a la cuenta
   * y se aplican a lo más antiguo primero; el servidor hace esa cuenta
   * (`credito_por_pagar`). Cancelada, no se debe nada.
   */
  fiadoPorPagar(p: Pedido): number {
    if (this.fiadoVigente(p) <= 0) return 0;
    return Math.max(0, Number(p.credito_por_pagar ?? this.fiadoVigente(p)));
  }

  /**
   * Las cuatro cifras de arriba. Cambian según el caso porque las preguntas
   * cambian: de un apartado se pregunta cuánto ha dejado; de una venta fiada,
   * cuánto pagó y cuánto se fió.
   */
  readonly cifras = computed<CifraPedido[]>(() => {
    const p = this.pedido();
    if (!p) return [];
    const total = Number(p.total);
    const pagado = Math.round(this.pagado(p) * 100) / 100;
    if (this.esApartadoSinEntregar(p) && !this.inactivo(p)) {
      return [
        { etiqueta: 'Total', valor: total },
        { etiqueta: 'Ya dejó', valor: pagado },
        { etiqueta: 'Falta', valor: Math.max(0, total - pagado), alerta: total - pagado > 0.004 },
      ];
    }
    if (this.esNotaPendiente(p) && this.fiado(p) <= 0 && !this.inactivo(p)) {
      const falta = this.faltaNota(p);
      return [
        { etiqueta: 'Total', valor: total },
        { etiqueta: 'Ya pagó', valor: pagado, pie: 'en sus abonos' },
        { etiqueta: 'Falta', valor: falta, alerta: falta > 0.004, pie: falta > 0.004 ? 'nota pendiente de pago' : 'ya está pagada' },
      ];
    }
    const fiado = this.fiado(p);
    if (fiado > 0) {
      const debe = this.fiadoPorPagar(p);
      const pie = this.fiadoVigente(p) <= 0
        ? 'se quitó de su cuenta'
        : debe <= 0.004 ? 'ya está pagado' : `debe ${this.dinero(debe)}`;
      return [
        { etiqueta: 'Total', valor: total },
        { etiqueta: 'Pagó al comprar', valor: pagado },
        { etiqueta: 'Se fió a su cuenta', valor: fiado, alerta: debe > 0.004, pie },
      ];
    }
    const falta = this.inactivo(p) ? 0 : Math.max(0, total - pagado);
    return [
      { etiqueta: 'Total', valor: total },
      { etiqueta: 'Pagado', valor: pagado },
      { etiqueta: 'Falta', valor: falta, alerta: falta > 0.004 },
    ];
  });

  /** Las cifras de la franja más lo que el cliente regresó de esta nota (le quedó a favor). */
  readonly cifrasConDevolucion = computed<CifraPedido[]>(() => {
    const p = this.pedido();
    const devuelto = Number(p?.devuelto_total ?? 0);
    if (!p || devuelto <= 0) return this.cifras();
    return [...this.cifras(), { etiqueta: 'Regresó', valor: devuelto, pie: 'le quedó a favor' }];
  });

  /** Pagos, y lo fiado como un renglón más: es la forma en que se pagó esa parte. */
  readonly filasPago = computed<FilaPago[]>(() => {
    const p = this.pedido();
    if (!p) return [];
    // En una nota que se paga en abonos, cada pago cobrado tiene su ticket de abono.
    const enAbonos = this.esNotaPendiente(p) || this.esEncargo(p) || this.esApartadoSinEntregar(p) || p.estado === 'apartado';
    const filas: FilaPago[] = (p.pagos ?? []).map((g) => {
      // Lo que entregó en efectivo y el cambio (se guarda desde el 2026-10-16).
      const recibido = g.recibido != null ? Number(g.recibido) : null;
      const cambio = recibido != null ? Math.round((recibido - Number(g.monto)) * 100) / 100 : null;
      return {
        como: g.metodo,
        monto: Number(g.monto),
        ...this.estadoPago(g.estado),
        // "Saldo a favor" debajo de "Saldo a favor" no dice nada.
        referencia: g.referencia_transaccion && g.referencia_transaccion !== g.metodo ? g.referencia_transaccion : null,
        pagoId: enAbonos && g.estado === 'completado' ? g.id : undefined,
        recibido,
        cambio,
      };
    });
    const fiado = this.fiado(p);
    if (fiado > 0) {
      const vigente = this.fiadoVigente(p);
      const debe = this.fiadoPorPagar(p);
      // Pagado con abonos, a medias ("debe $X") o todo por pagar.
      const estado = vigente <= 0
        ? { estado: 'Sin deuda', tono: 'gris' }
        : debe <= 0.004
          ? { estado: 'Pagado con abonos', tono: 'verde' }
          : debe < fiado - 0.004
            ? { estado: `Debe ${this.dinero(debe)}`, tono: 'ambar' }
            : { estado: 'Por pagar', tono: 'ambar' };
      filas.push({
        como: vigente > 0 ? 'A crédito, a su cuenta' : 'A crédito (se quitó de su cuenta)',
        monto: fiado,
        ...estado,
      });
    }
    return filas;
  });

  private estadoPago(e: string): { estado: string; tono: string } {
    switch (e) {
      case 'completado': return { estado: 'Cobrado', tono: 'verde' };
      case 'pendiente': return { estado: 'Por cobrar', tono: 'ambar' };
      case 'procesando': return { estado: 'En proceso', tono: 'azul' };
      case 'reembolsado': return { estado: 'Reembolsado', tono: 'gris' };
      case 'fallido': return { estado: 'Falló', tono: 'rojo' };
      default: return { estado: e, tono: 'gris' };
    }
  }

  /**
   * Lo que le ha pasado al pedido, en orden. Se arma con lo que ya guarda la
   * base —la venta, los pagos, lo fiado, el comprobante, la entrega— porque no
   * hay una bitácora de estados. La fecha de una cancelación es la de la última
   * modificación del pedido: es lo último que se le hace.
   */
  readonly historia = computed<Suceso[]>(() => {
    const p = this.pedido();
    if (!p) return [];
    const ev: Suceso[] = [];
    const donde = p.canal === 'tienda_linea'
      ? 'en la tienda en línea'
      : p.caja ? `en ${p.caja}` : 'en el mostrador';
    const quien = p.cliente_nombre_comercial || p.cliente || 'el cliente';
    const apartado = this.nacioApartado(p);

    ev.push({
      t: p.creado_en,
      que: apartado
        ? `Se apartó ${donde}`
        : p.canal === 'tienda_linea' ? 'Se hizo el pedido en la tienda en línea' : `Se vendió ${donde}`,
    });

    const pagos = [...(p.pagos ?? [])].sort((a, b) => String(a.creado_en).localeCompare(String(b.creado_en)));
    pagos.forEach((g, i) => {
      const m = this.dinero(g.monto);
      const metodo = g.metodo.toLowerCase();
      let que: string;
      if (g.estado === 'pendiente' || g.estado === 'procesando') que = `Quedó por cobrar ${m} por ${metodo}`;
      else if (apartado) que = i === 0 ? `Dejó ${m} de anticipo en ${metodo}` : `Abonó ${m} en ${metodo}`;
      else que = `Pagó ${m} en ${metodo}`;
      if (g.estado === 'reembolsado') que += ' (se le devolvió)';
      ev.push({ t: g.creado_en, que });
      if (g.comprobante_subido_en) {
        ev.push({
          t: g.comprobante_subido_en,
          que: `Se subió el comprobante del depósito${g.comprobante_subido_por ? ' · ' + g.comprobante_subido_por : ''}`,
        });
      }
    });

    for (const c of p.credito ?? []) {
      const m = this.dinero(Math.abs(Number(c.monto)));
      if (c.tipo === 'cargo') ev.push({ t: c.creado_en, que: `Se cargaron ${m} a la cuenta de ${quien}` });
      else ev.push({ t: c.creado_en, que: c.notas || (Number(c.monto) < 0 ? `Se quitaron ${m} de su cuenta` : `Se cargaron ${m} a su cuenta`) });
    }
    for (const a of p.abonos_cuenta ?? []) {
      ev.push({ t: a.creado_en, que: `${quien} abonó ${this.dinero(a.monto)} a su cuenta (se aplica a lo más antiguo que deba)` });
    }
    if (p.entregado_en) ev.push({ t: p.entregado_en, que: 'Se le entregó la mercancía' });
    for (const d of p.devoluciones ?? []) {
      const kg = d.lineas.reduce((s, l) => s + Number(l.kg), 0);
      const a = d.nombre_comercial || d.cliente || quien;
      let que = `Regresó ${kg.toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg (${d.folio}): ` +
        `${this.dinero(d.total)} a favor de ${a}`;
      if (Number(d.aplicado_a_deuda) > 0) que += `; se descontaron ${this.dinero(d.aplicado_a_deuda)} de lo que debía`;
      ev.push({ t: d.creado_en, que });
    }
    if (this.inactivo(p) && p.actualizado_en) {
      const verbo = p.estado === 'devuelto' ? 'Se devolvió' : 'Se canceló';
      ev.push({
        t: p.actualizado_en,
        que: this.esApartadoSinEntregar(p)
          ? `${verbo} y se liberó lo apartado`
          : `${verbo}; la mercancía regresó a ${p.almacen ?? 'su almacén'}`,
      });
    }
    // Las fechas vienen como 'YYYY-MM-DD HH:MM:SS': ordenarlas como texto es
    // ordenarlas en el tiempo. El orden es estable: lo del mismo minuto queda
    // en el orden en que se armó.
    return ev.sort((a, b) => String(a.t).localeCompare(String(b.t)));
  });

  /** "8 sep 11:24", o con el año si no es de este. */
  fechaCorta(s: string | null | undefined): string {
    const [dia, hora] = String(s ?? '').replace('T', ' ').split(' ');
    const [a, m, d] = (dia ?? '').split('-').map(Number);
    if (!a || !m || !d) return '—';
    const anio = String(a) === hoyLocal().slice(0, 4) ? '' : ` ${a}`;
    return `${d} ${MESES[m - 1]}${anio} ${(hora ?? '').slice(0, 5)}`.trim();
  }

  /** "8 de septiembre, 11:24", con el año si no es de este. */
  fechaLarga(s: string | null | undefined): string {
    const [dia, hora] = String(s ?? '').replace('T', ' ').split(' ');
    const [a, m, d] = (dia ?? '').split('-').map(Number);
    if (!a || !m || !d) return '—';
    const anio = String(a) === hoyLocal().slice(0, 4) ? '' : ` de ${a}`;
    return `${d} de ${MESES_LARGOS[m - 1]}${anio}, ${(hora ?? '').slice(0, 5)}`;
  }

  /** "Punto de venta · Caja Cuautepec · atendió Lupita R." */
  dondeYQuien(p: Pedido): string {
    const partes = [p.canal === 'punto_venta' ? 'Punto de venta' : 'Tienda en línea'];
    if (p.caja) partes.push(p.caja);
    // De qué almacén salió el hilo (2026-10-16).
    if (p.almacen) partes.push(`salió de ${p.almacen}`);
    if (p.usuario) partes.push(`la elaboró ${p.usuario}`);
    return partes.join(' · ');
  }

  /**
   * ¿Fue de contado? (2026-10-16) Se pagó ese mismo día: no a crédito, como nota
   * pendiente de pago, en espera ni apartada. Si no, por qué.
   */
  contado(p: Pedido): { si: boolean; porque: string } {
    if (this.fiado(p) > 0) return { si: false, porque: 'parte se fue a su cuenta de crédito' };
    if (this.esNotaPendiente(p) || Number(p.nota_pendiente)) return { si: false, porque: 'salió como nota pendiente de pago' };
    if (Number(p.encargo)) return { si: false, porque: 'fue una nota en espera' };
    if (p.estado === 'apartado' || this.esApartadoSinEntregar(p)) return { si: false, porque: 'es un apartado' };
    return { si: true, porque: '' };
  }

  constructor() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.cargar(id);
  }

  private cargar(id: number): void {
    this.cargando.set(true);
    this.ventas.obtenerPedido(id).subscribe({
      next: (p) => {
        this.pedido.set(p);
        this.nuevoEstado = p.estado;
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  cambiarEstado(): void {
    const p = this.pedido();
    if (!p || !this.nuevoEstado || this.nuevoEstado === p.estado) return;

    // Cancelar y devolver mueven mercancía y dinero: se confirma antes,
    // mostrando exactamente qué va a pasar.
    if (this.nuevoEstado === 'cancelado' || this.nuevoEstado === 'devuelto') {
      this.abrirDevolucion();
      return;
    }
    this.aplicarEstado(this.nuevoEstado);
  }

  // ---- Cancelación / devolución ----

  readonly confirmando = signal(false);
  readonly aplicando = signal(false);
  readonly mensaje = signal<string | null>(null);
  /** Presentación elegida por línea: detalle_id → variante_id. */
  retornoPresentacion: Record<number, number> = {};
  /** Cantidad que de verdad regresa, por línea. */
  retornoCantidad: Record<number, number> = {};

  /** Prepara el panel con lo que regresa tal como se vendió. */
  abrirDevolucion(): void {
    const p = this.pedido();
    if (!p?.detalle) return;
    this.retornoPresentacion = {};
    this.retornoCantidad = {};
    for (const d of p.detalle) {
      this.retornoPresentacion[d.id] = d.variante_id;
      this.retornoCantidad[d.id] = Number(d.cantidad);
    }
    this.error.set(null);
    this.confirmando.set(true);
  }

  cerrarDevolucion(): void {
    this.confirmando.set(false);
    this.nuevoEstado = this.pedido()?.estado ?? '';
  }

  /** El botón "Cancelar venta" (o "Cancelar apartado") de la cabecera. */
  abrirCancelar(): void {
    this.nuevoEstado = 'cancelado';
    this.abrirDevolucion();
  }

  /**
   * La DEVOLUCIÓN con saldo a favor (2026-10-13): la ventana dice qué puede
   * regresar, se escanean los paquetes cerrados y se pesa lo suelto.
   */
  readonly devolviendo = signal(false);

  /** Terminó la devolución: se dice cuánto le quedó a favor y se recarga la nota. */
  alDevolver(r: ResultadoDevolucion): void {
    this.devolviendo.set(false);
    this.error.set(null);
    const kg = r.kg.toLocaleString('es-MX', { maximumFractionDigits: 3 });
    const deEsta = Number(r.descontado_de_esta ?? 0);
    const deOtras = Math.round((r.aplicado_a_deuda - deEsta) * 100) / 100;
    let txt = `Devolución ${r.folio}: regresaron ${kg} kg (${this.dinero(r.total)}).`;
    if (deEsta > 0) txt += ` Se descontaron ${this.dinero(deEsta)} de esta nota.`;
    if (deOtras > 0) txt += ` Se descontaron ${this.dinero(deOtras)} de lo demás que debía.`;
    txt += ` A ${r.cliente} le quedan ${this.dinero(r.saldo_favor)} a favor.`;
    this.mensaje.set(txt);
    this.ultimaDevolucion.set({ id: r.devolucion_id, texto: txt });
    this.cargar(r.pedido_id);
  }

  /**
   * La devolución que se acaba de registrar: su aviso trae el botón de su
   * ticket. En cuanto el aviso cambia por otro, el botón se va con él.
   */
  private readonly ultimaDevolucion = signal<{ id: number; texto: string } | null>(null);
  readonly devolucionDelAviso = computed(() => {
    const u = this.ultimaDevolucion();
    if (!u || this.mensaje() !== u.texto) return null;
    return this.pedido()?.devoluciones?.find((d) => d.id === u.id) ?? null;
  });

  /**
   * Se puede cancelar: el puesto tiene el permiso, el pedido sigue vivo y no
   * tiene devoluciones (lo que regresó ya quedó a favor; lo demás también se
   * regresa con «Devolución»).
   */
  puedeCancelarEste(p: Pedido): boolean {
    return this.puedeCancelar() && !this.inactivo(p) && !p.devoluciones?.length;
  }

  /** Devolver solo aplica a mercancía entregada: una nota en espera nunca salió. */
  puedeDevolverEste(p: Pedido): boolean {
    return this.puedeCancelar() && !this.inactivo(p) && !this.esApartadoSinEntregar(p);
  }

  /** Escape cierra el panel de cancelación, salvo mientras se aplica. */
  alEscape(): void {
    if (this.confirmando() && !this.aplicando()) this.cerrarDevolucion();
  }

  // ---- Ticket ----

  /**
   * Imprime el ticket del pedido, el mismo que sale en la caja
   * (`shared/ticket/ticket.ts`): angosto como el papel de la térmica y con la
   * hoja del largo exacto del ticket, para que la impresora corte al terminar.
   */
  imprimirTicket(): void {
    const p = this.pedido();
    if (!p) return;
    this.tickets.imprimirPedido(p).subscribe({
      error: (e) => this.error.set(e instanceof Error ? e.message : this.msg(e)),
    });
  }

  /**
   * El ticket de UNA devolución (2026-10-15): dice "Devolución", qué regresó,
   * cuánto le quedó a favor y su saldo a favor de hoy. El de la venta sigue
   * saliendo con su propio botón.
   */
  imprimirDevolucion(d: DevolucionHecha): void {
    const p = this.pedido();
    if (!p) return;
    this.tickets.imprimirDevolucion(p, d).subscribe({
      error: (e) => this.error.set(e instanceof Error ? e.message : this.msg(e)),
    });
  }

  /** El ticket de un abono a esta nota (uno de sus pagos): sale igual que el día que se pagó. */
  imprimirPago(pagoId: number): void {
    const p = this.pedido();
    if (!p) return;
    this.tickets.imprimirPagoNota(p.id, pagoId).subscribe({
      error: (e) => this.error.set(e instanceof Error ? e.message : this.msg(e)),
    });
  }

  /**
   * MANDAR EL TICKET POR WHATSAPP (2026-10-16): el mismo que se imprime, en PDF.
   * Abre la ventana que lo prepara, con el teléfono del cliente (`WhatsappService`).
   */
  whatsappTicket(): void {
    const p = this.pedido();
    if (p) this.tickets.whatsappPedido(p);
  }

  whatsappDevolucion(d: DevolucionHecha): void {
    const p = this.pedido();
    if (p) this.tickets.whatsappDevolucion(p, d);
  }

  whatsappPago(pagoId: number): void {
    const p = this.pedido();
    if (p) this.tickets.whatsappPagoNota(p.id, pagoId);
  }

  /** Una nota en espera no lleva ticket (todavía se puede modificar): no se ofrece el botón. */
  llevaTicket(): boolean {
    const p = this.pedido();
    return !!p && llevaTicket(p);
  }

  /**
   * Al cambiar la presentación se propone la cantidad equivalente que calculó el
   * backend (19 kg de paquete → 12 conos). Sigue siendo editable: puede que el
   * cliente regrese menos de lo que se llevó.
   */
  alCambiarPresentacion(linea: PedidoLinea): void {
    const elegida = Number(this.retornoPresentacion[linea.id]);
    if (elegida === linea.variante_id) {
      this.retornoCantidad[linea.id] = Number(linea.cantidad);
      return;
    }
    const alt = linea.alternativas_devolucion?.find((a) => a.variante_id === elegida);
    if (alt) this.retornoCantidad[linea.id] = alt.cantidad_equivalente;
  }

  /** Unidad en que se captura lo que regresa de esta línea. */
  unidadRetorno(linea: PedidoLinea): string {
    const elegida = Number(this.retornoPresentacion[linea.id]);
    if (elegida === linea.variante_id) return '';
    return linea.alternativas_devolucion?.find((a) => a.variante_id === elegida)?.unidad ?? '';
  }

  /** True si esta línea va a regresar en otra presentación. */
  hayCambio(linea: PedidoLinea): boolean {
    return Number(this.retornoPresentacion[linea.id]) !== linea.variante_id;
  }

  /**
   * Efectivo que va a salir de la caja, para avisarlo antes de confirmar. Es
   * informativo: el monto real lo calcula el backend con los pagos del pedido.
   */
  efectivoADevolver(): number {
    const p = this.pedido();
    if (!p || p.canal !== 'punto_venta') return 0;
    return (p.pagos ?? [])
      .filter((g) => g.estado === 'completado' && /efectivo/i.test(g.metodo))
      .reduce((s, g) => s + Number(g.monto), 0);
  }

  confirmarDevolucion(): void {
    const p = this.pedido();
    if (!p?.detalle || !this.nuevoEstado) return;

    // Un apartado nunca salió de la bodega: no hay nada que regrese ni en qué
    // presentación, solo se libera lo apartado.
    if (this.esApartadoSinEntregar(p)) {
      this.aplicarEstado(this.nuevoEstado);
      return;
    }

    const devoluciones: DevolucionLinea[] = p.detalle.map((d) => ({
      detalle_id: d.id,
      variante_id: Number(this.retornoPresentacion[d.id]),
      cantidad: Number(this.retornoCantidad[d.id]),
    }));
    this.aplicarEstado(this.nuevoEstado, devoluciones);
  }

  private aplicarEstado(estado: EstadoPedido, devoluciones?: DevolucionLinea[]): void {
    const p = this.pedido();
    if (!p) return;
    this.aplicando.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    this.ventas.cambiarEstado(p.id, estado, devoluciones).subscribe({
      next: () => {
        this.aplicando.set(false);
        this.confirmando.set(false);
        const almacen = p.almacen ?? 'su almacén';
        this.mensaje.set(
          this.esApartadoSinEntregar(p)
            ? estado === 'apartado'
              ? `Se volvió a apartar la mercancía en ${almacen}.`
              : `Apartado cancelado. Se liberó lo apartado en ${almacen}.`
            : estado === 'cancelado' || estado === 'devuelto'
              ? `${estado === 'cancelado' ? 'Venta cancelada' : 'Mercancía devuelta'}. Regresó al inventario de ${almacen}.`
              : `Pedido marcado como ${etiquetaEstado(estado, p.canal, p.encargo).toLowerCase()}.`
        );
        // Se recarga: cambiaron los bultos, los pagos y las alternativas.
        this.cargar(p.id);
      },
      error: (e) => {
        this.aplicando.set(false);
        this.error.set(this.msg(e));
      },
    });
  }

  // ---- Comprobante de pago ----
  //
  // La captura que el cliente manda al depositar. La sube SOLO el personal —el
  // cliente se la manda por WhatsApp o correo— y subirla da el pedido por
  // pagado en un paso, que es como lo pidió el usuario el 2026-09-05.

  readonly subiendoComprobante = signal(false);
  readonly errorComprobante = signal<string | null>(null);
  /** URL local del archivo bajado, para pintarlo. Se libera al salir. */
  readonly comprobanteUrl = signal<string | null>(null);
  readonly cargandoComprobante = signal(false);

  /** El pago que trae la captura, si alguno la tiene. */
  pagoConComprobante(): PagoLinea | null {
    return (this.pedido()?.pagos ?? []).find((g) => g.tiene_comprobante) ?? null;
  }

  /**
   * Si a este pedido se le puede subir una captura. No a un apartado (se paga
   * con abonos) ni a uno cancelado, y tampoco a una venta ya cobrada completa
   * sin transferencia: ahí no hay pago al cual pegarla, y antes el backend
   * creaba otro por el total. El backend lo valida igual.
   */
  aceptaComprobante(): boolean {
    const p = this.pedido();
    if (!p || p.estado === 'apartado' || p.estado === 'cancelado' || p.estado === 'devuelto') {
      return false;
    }
    const pagos = p.pagos ?? [];
    const hayAQuienPegarla = pagos.some(
      (g) =>
        g.estado === 'pendiente' ||
        g.estado === 'procesando' ||
        (g.estado === 'completado' && /transferencia/i.test(g.metodo))
    );
    const cobrado = pagos
      .filter((g) => g.estado === 'completado')
      .reduce((s, g) => s + Number(g.monto), 0);
    return hayAQuienPegarla || Number(p.total) - cobrado > 0.004;
  }

  /** Un PDF no se puede pintar con `<img>`: se ofrece abrirlo aparte. */
  comprobanteEsPdf(): boolean {
    return this.pagoConComprobante()?.comprobante_tipo === 'application/pdf';
  }

  /**
   * Baja el archivo y lo deja listo para mostrar. Va por HttpClient porque el
   * endpoint exige sesión y un `<img src>` no manda el token.
   */
  verComprobante(): void {
    const p = this.pedido();
    if (!p || this.cargandoComprobante() || this.comprobanteUrl()) return;
    this.cargandoComprobante.set(true);
    this.errorComprobante.set(null);
    this.ventas.comprobante(p.id).subscribe({
      next: (blob) => {
        this.liberarComprobante();
        this.comprobanteUrl.set(URL.createObjectURL(blob));
        this.cargandoComprobante.set(false);
      },
      error: (e) => {
        this.errorComprobante.set(this.msg(e));
        this.cargandoComprobante.set(false);
      },
    });
  }

  /** Abre el archivo en otra pestaña. Es la única forma de leer un PDF aquí. */
  abrirComprobante(): void {
    const url = this.comprobanteUrl();
    if (url) window.open(url, '_blank');
  }

  elegirArchivo(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    // El input se limpia siempre: si no, volver a elegir el MISMO archivo no
    // dispara el evento y parecería que el botón dejó de funcionar.
    input.value = '';
    if (archivo) this.subirComprobante(archivo);
  }

  private subirComprobante(archivo: File): void {
    const p = this.pedido();
    if (!p) return;
    this.subiendoComprobante.set(true);
    this.errorComprobante.set(null);
    this.mensaje.set(null);

    this.ventas.subirComprobante(p.id, archivo).subscribe({
      next: (actualizado) => {
        this.pedido.set(actualizado);
        this.nuevoEstado = actualizado.estado;
        this.subiendoComprobante.set(false);
        // La captura anterior ya no vale: se descarta para que el siguiente
        // "Ver" baje la nueva.
        this.liberarComprobante();
        this.mensaje.set(
          actualizado.estado === 'pagado'
            ? 'Comprobante guardado. El pedido quedó PAGADO.'
            : 'Comprobante guardado.'
        );
      },
      error: (e) => {
        this.errorComprobante.set(this.msg(e));
        this.subiendoComprobante.set(false);
      },
    });
  }

  async quitarComprobante(): Promise<void> {
    const p = this.pedido();
    if (!p) return;
    const si = await this.confirmacion.pedir({
      titulo: '¿Quitar la captura del depósito?',
      mensaje: 'El pedido sigue marcado como pagado: para deshacer el cobro está el cambio de estado.',
      aceptar: 'Quitar',
      peligro: true,
    });
    if (!si) return;

    this.errorComprobante.set(null);
    this.ventas.eliminarComprobante(p.id).subscribe({
      next: (actualizado) => {
        this.pedido.set(actualizado);
        this.liberarComprobante();
        this.mensaje.set('Se quitó la captura.');
      },
      error: (e) => this.errorComprobante.set(this.msg(e)),
    });
  }

  /** Un object URL que no se revoca deja el archivo en memoria del navegador. */
  private liberarComprobante(): void {
    const url = this.comprobanteUrl();
    if (url) URL.revokeObjectURL(url);
    this.comprobanteUrl.set(null);
  }

  ngOnDestroy(): void {
    this.liberarComprobante();
  }

  // ---- Artículos ----

  /** Pesos con separador de miles: "$12,450.00", no "$12450.00". */
  dinero(v: unknown): string {
    return Number(v ?? 0).toLocaleString('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  /**
   * El hilo con su CALIBRE y su presentación: "MARINO OSCURO 1/30 · Paquete".
   * El color solo no basta: el mismo color en dos calibres son dos productos.
   */
  nombreDelHilo(d: PedidoLinea): string {
    const hilo = `${d.producto || d.descripcion}${d.producto && d.calibre ? ' ' + d.calibre : ''}`;
    return d.producto && d.presentacion ? `${hilo} · ${d.presentacion}` : hilo;
  }

  /**
   * De qué es el hilo, debajo del nombre: "ACRILAN · Turco". Se arma aquí y no
   * en la plantilla para no repetir la lógica de los guiones cuando falta uno.
   * El calibre ya va en el nombre.
   */
  fichaDelHilo(d: PedidoLinea): string {
    return [d.material, d.linea].filter(Boolean).join(' · ');
  }

  /**
   * Por qué una línea no muestra bultos. Un pedido en línea no escanea nada, y
   * decirlo evita que se lea como un dato perdido.
   */
  porQueSinBultos(): string {
    return this.pedido()?.canal === 'tienda_linea'
      ? 'Venta en línea: no se escanearon bultos.'
      : 'No se escanearon bultos en esta línea.';
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Error';
  }
}
