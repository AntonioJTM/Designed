import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { VentasService } from '../../../core/services/ventas.service';
import { AuthService } from '../../../core/services/auth.service';
import { Encargo, EncargoHilo, Encargos, Pedido } from '../../../core/models/ventas.models';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { FolioPipe } from '../../../shared/folio.pipe';
import { FechaPipe, hoyLocal } from '../../../shared/fecha.pipe';
import { EntregarPedidoModal } from './entregar-modal';
import { PrepararPedidoModal } from './preparar-modal';

type Paso = '' | 'en_preparacion' | 'listo' | 'enviado';

/**
 * PEDIDOS de clientes (encargos) (2026-10-06): "tenemos chofer que los lleva, o
 * hacen el pedido por WhatsApp y después van por él; no es un apartado, es una
 * venta" (usuario). Antes "Pedidos" era la lista de ventas: esa ahora se llama
 * Ventas.
 *
 * Se toman en el punto de venta (botón "Pedido") con la mercancía apartada. Aquí
 * se siguen: por preparar → listo → en camino (si lo lleva el chofer) → se
 * ENTREGA cobrando lo que falte o fiándolo (`entregar-modal.ts`), que es cuando
 * sale del inventario. Cancelar va en el detalle de la venta (pide su permiso).
 *
 * Queda LISTO al PREPARARLO (`preparar-modal.ts`): se escanean los paquetes que
 * van y se pesan los conos, y el total queda con el peso real. Sin prepararlo no
 * se entrega.
 */
@Component({
  selector: 'app-encargos',
  imports: [FormsModule, RouterLink, DineroPipe, FolioPipe, FechaPipe, EntregarPedidoModal, PrepararPedidoModal],
  templateUrl: './encargos.html',
  styleUrl: './encargos.scss',
})
export class EncargosPantalla {
  private readonly ventas = inject(VentasService);
  private readonly auth = inject(AuthService);

  readonly datos = signal<Encargos | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  readonly paso = signal<Paso>('');
  q = '';
  private temporizador: ReturnType<typeof setTimeout> | null = null;

  /** El pedido que se está entregando (abre la ventana de cobro). */
  readonly entregando = signal<Encargo | null>(null);
  /** El pedido que se está preparando (abre la ventana de escanear y pesar). */
  readonly preparando = signal<Encargo | null>(null);
  /** El pedido que está cambiando de paso, para no mandar dos veces. */
  readonly moviendo = signal<number | null>(null);

  readonly puedeVender = computed(() => this.auth.puede('ver:pos'));
  readonly items = computed(() => this.datos()?.items ?? []);
  readonly conteo = computed(() => this.datos()?.conteo ?? { en_preparacion: 0, listo: 0, enviado: 0 });
  readonly totalPedidos = computed(() => {
    const c = this.conteo();
    return c.en_preparacion + c.listo + c.enviado;
  });

  constructor() {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.ventas.encargos({ estado: this.paso() || undefined, q: this.q.trim() || undefined }).subscribe({
      next: (d) => {
        this.datos.set(d);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  elegirPaso(p: Paso): void {
    this.paso.set(p);
    this.cargar();
  }

  alTeclear(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.cargar(), 350);
  }

  // ---- Cómo se lee cada pedido ----

  quien(e: Encargo): string {
    return e.nombre_comercial || e.cliente || 'Sin cliente';
  }

  nombrePaso(estado: string): string {
    return estado === 'en_preparacion' ? 'Por preparar' : estado === 'listo' ? 'Listo' : 'En camino';
  }

  tonoPaso(estado: string): string {
    return estado === 'en_preparacion' ? 'ambar' : estado === 'listo' ? 'verde' : 'azul';
  }

  /**
   * "ROJO 2/30 · 20 kg (≈ 1 paquete)", "· 2 paquetes" (ya escaneados: son los
   * que van) o "· 6 conos".
   */
  queLleva(h: EncargoHilo): string {
    const kg = `${h.kg.toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg`;
    const paq = (n: number) => `${n} ${n === 1 ? 'paquete' : 'paquetes'}`;
    const extra = h.piezas
      ? ` · ${h.piezas} ${h.piezas === 1 ? 'cono' : 'conos'}`
      : h.escaneados
        ? ` · ${paq(h.escaneados)}`
        : h.paquetes
          ? ` (≈ ${paq(h.paquetes)})`
          : '';
    return `${h.hilo} · ${kg}${extra}`;
  }

  /** Para cuándo, en palabras: hoy, mañana, o la fecha. */
  paraCuando(e: Encargo): string {
    if (!e.entrega_para) return '';
    const hoy = hoyLocal();
    if (e.entrega_para === hoy) return 'para hoy';
    const manana = new Date(`${hoy}T12:00:00`);
    manana.setDate(manana.getDate() + 1);
    const p = (n: number) => String(n).padStart(2, '0');
    if (e.entrega_para === `${manana.getFullYear()}-${p(manana.getMonth() + 1)}-${p(manana.getDate())}`) return 'para mañana';
    return `para el ${new FechaPipe().transform(e.entrega_para, true)}`;
  }

  /** Ya pasó el día en que lo quería y no se ha entregado. */
  atrasado(e: Encargo): boolean {
    return !!e.entrega_para && e.entrega_para < hoyLocal();
  }

  /**
   * El siguiente paso que se le puede dar desde aquí (preparar y entregar van
   * aparte). Queda listo al PREPARARLO, no con un botón.
   */
  siguiente(e: Encargo): { estado: 'enviado'; texto: string } | null {
    if (e.estado === 'listo' && e.metodo_entrega === 'envio') return { estado: 'enviado', texto: 'Salió con el chofer' };
    return null;
  }

  alPreparar(p: Pedido): void {
    this.preparando.set(null);
    const total = Number(p.total);
    const antes = Number(p.total_antes ?? total);
    const aFavor = Number(p.a_favor ?? 0);
    const falta = Number(p.falta ?? 0);
    const dinero = (n: number) => `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    this.mensaje.set(
      `${p.numero_pedido} listo` +
        (Math.abs(total - antes) > 0.004 ? `: con el peso real queda en ${dinero(total)} (era ${dinero(antes)})` : '') +
        (aFavor > 0 ? `. Pagó ${dinero(aFavor)} de más: se le devuelven al entregar.` : falta > 0 ? `. Falta cobrar ${dinero(falta)}.` : '. Ya está pagado.')
    );
    this.cargar();
  }

  avanzar(e: Encargo, estado: 'enviado' | 'en_preparacion'): void {
    this.moviendo.set(e.id);
    this.error.set(null);
    this.ventas.cambiarEstado(e.id, estado).subscribe({
      next: () => {
        this.moviendo.set(null);
        this.mensaje.set(`${e.numero_pedido}: ${this.nombrePaso(estado).toLowerCase()}.`);
        this.cargar();
      },
      error: (err) => {
        this.moviendo.set(null);
        this.error.set(this.msg(err));
      },
    });
  }

  alEntregar(p: Pedido): void {
    this.entregando.set(null);
    const cambio = Number(p.cambio ?? 0);
    const devuelto = Number(p.devuelto ?? 0);
    this.mensaje.set(
      `${p.numero_pedido} entregado` +
        (p.estado === 'pendiente' ? ': lo que faltaba quedó en su cuenta.' : '.') +
        (cambio > 0 ? ` Su cambio: $${cambio.toFixed(2)}.` : '') +
        (devuelto > 0 ? ` Se le devolvieron $${devuelto.toFixed(2)} (pesó menos de lo que pagó).` : '')
    );
    this.cargar();
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
