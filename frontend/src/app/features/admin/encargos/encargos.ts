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
import { ModificarPedidoModal } from './modificar-modal';

type Filtro = 'todos' | 'hoy' | 'atrasados';

/**
 * NOTAS EN ESPERA (2026-10-13: antes "Pedidos"; sin chofer). Antes:
 * PEDIDOS de clientes (encargos) (2026-10-06): "tenemos chofer que los lleva, o
 * hacen el pedido por WhatsApp y después van por él; no es un apartado, es una
 * venta" (usuario). Antes "Pedidos" era la lista de ventas: esa ahora se llama
 * Ventas.
 *
 * Se toman en el punto de venta (botón "Pedido") con la mercancía apartada y
 * quedan EN ESPERA (2026-10-07: "mejor que sean notas en espera, porque hay
 * casos donde el cliente quiere modificar su pedido, agregar o quitar cosas"):
 * "Modificar" (`modificar-modal.ts`) les quita o agrega hilos, escanea sus
 * paquetes y cambia la entrega y las notas, las veces que haga falta; "Entregar
 * y cobrar" (`entregar-modal.ts`) cobra lo que falte o lo fía y ahí sale del
 * inventario. Ya no llevan pasos de preparar ni de chofer. Cancelar va en el
 * detalle de la venta (pide su permiso).
 */
@Component({
  selector: 'app-encargos',
  imports: [FormsModule, RouterLink, DineroPipe, FolioPipe, FechaPipe, EntregarPedidoModal, ModificarPedidoModal],
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

  readonly filtro = signal<Filtro>('todos');
  q = '';
  private temporizador: ReturnType<typeof setTimeout> | null = null;

  /** El pedido que se está entregando (abre la ventana de cobro). */
  readonly entregando = signal<Encargo | null>(null);
  /** El pedido que se está modificando. */
  readonly modificando = signal<Encargo | null>(null);

  readonly puedeVender = computed(() => this.auth.puede('ver:pos'));
  readonly todos = computed(() => this.datos()?.items ?? []);
  readonly cuantos = computed(() => {
    const ts = this.todos();
    return {
      todos: ts.length,
      hoy: ts.filter((e) => e.entrega_para === hoyLocal()).length,
      atrasados: ts.filter((e) => this.atrasado(e)).length,
    };
  });
  readonly items = computed(() => {
    const f = this.filtro();
    return this.todos().filter((e) =>
      f === 'hoy' ? e.entrega_para === hoyLocal()
        : f === 'atrasados' ? this.atrasado(e)
          : true
    );
  });

  constructor() {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.ventas.encargos({ q: this.q.trim() || undefined }).subscribe({
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

  alTeclear(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.cargar(), 350);
  }

  // ---- Cómo se lee cada pedido ----

  quien(e: Encargo): string {
    return e.nombre_comercial || e.cliente || 'Sin cliente';
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

  /** Se modificó: dice qué cambió y cómo quedó el total. */
  alModificar(p: Pedido): void {
    this.modificando.set(null);
    const total = Number(p.total);
    const antes = Number(p.total_antes ?? total);
    const aFavor = Number(p.a_favor ?? 0);
    const falta = Number(p.falta ?? 0);
    const dinero = (n: number) => `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const cambios = (p.cambios ?? []).join('; ');
    this.mensaje.set(
      `${p.numero_pedido} modificada${cambios ? ': ' + cambios : ''}.` +
        (Math.abs(total - antes) > 0.004 ? ` El total queda en ${dinero(total)} (era ${dinero(antes)}).` : '') +
        (aFavor > 0 ? ` Dejó ${dinero(aFavor)} de más: se le devuelven al entregar.` : falta > 0 ? ` Falta cobrar ${dinero(falta)}.` : ' Ya está pagado.')
    );
    this.cargar();
  }

  alEntregar(p: Pedido): void {
    this.entregando.set(null);
    const cambio = Number(p.cambio ?? 0);
    const devuelto = Number(p.devuelto ?? 0);
    this.mensaje.set(
      `${p.numero_pedido} entregada` +
        (p.estado === 'pendiente'
          ? Number(p.nota_pendiente)
            ? ': quedó como nota pendiente de pago.'
            : ': lo que faltaba quedó a crédito en su cuenta.'
          : '.') +
        (cambio > 0 ? ` Su cambio: $${cambio.toFixed(2)}.` : '') +
        (devuelto > 0 ? ` Se le devolvieron $${devuelto.toFixed(2)} (pesó menos de lo que pagó).` : '')
    );
    this.cargar();
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
