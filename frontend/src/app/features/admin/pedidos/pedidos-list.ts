import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { VentasService } from '../../../core/services/ventas.service';
import { RedisenoService } from '../../../core/services/rediseno.service';
import { Caja, CanalVenta, EstadoPedido, Pedido } from '../../../core/models/ventas.models';
import { ResumenPedidos } from '../../../core/models/rediseno.models';
import { hoyLocal } from '../../../shared/fecha.pipe';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { etiquetaEstado, tonoEstado } from './estados';
import { FolioPipe } from '../../../shared/folio.pipe';

/** Una cifra de arriba de la pantalla. */
interface Kpi {
  etiqueta: string;
  valor: string;
  pie: string;
  punto: string;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** 'YYYY-MM-DD' de hace `dias` días, en hora LOCAL (no UTC). */
function haceDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * PEDIDOS (rediseño 2026-10): las ventas del mostrador, con su estado y lo que
 * falta por cobrar. Arriba, las cuatro cifras que se preguntan siempre (hoy,
 * la semana, lo fiado, lo cancelado); abajo, la lista filtrada por folio o
 * cliente, estado, caja y fechas.
 *
 * Por omisión muestra los últimos siete días: la pregunta normal es "qué se
 * vendió esta semana", y la lista completa de meses no se lee.
 */
@Component({
  selector: 'app-pedidos-list',
  imports: [FolioPipe, FormsModule, RouterLink, DineroPipe],
  templateUrl: './pedidos-list.html',
  styles: `
    .kpi-valor { font-size: 28px; }
    td.folio a { font-family: var(--mono); font-size: 13px; text-decoration: none; white-space: nowrap; }
    td.cliente { font-weight: 500; }
    td.tenue { color: var(--tinta-2); }
    td .falta { color: var(--alerta-t); }
    .mas { display: flex; justify-content: center; padding-top: 14px; }
  `,
})
export class PedidosList {
  private readonly ventas = inject(VentasService);
  private readonly rediseno = inject(RedisenoService);

  readonly pedidos = signal<Pedido[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(true);
  readonly cargandoMas = signal(false);
  readonly error = signal<string | null>(null);
  readonly kpis = signal<Kpi[]>([]);
  readonly cajas = signal<Caja[]>([]);

  private pagina = 1;

  // Filtros. Son campos con ngModel: lo que dependa de ellos se lee con
  // MÉTODOS, nunca con computed().
  /*
   * TIENDA EN LÍNEA APAGADA (2026-10): el filtro de canal está comentado en la
   * plantilla porque hoy todo es mostrador. La lógica se queda: al volver a
   * abrir la tienda basta con descomentar el <label> "Canal".
   */
  canal: CanalVenta | '' = '';
  estado: EstadoPedido | '' = '';
  q = '';
  cajaId: number | '' = '';
  desde = haceDias(6);
  hasta = hoyLocal();

  readonly etiquetaEstado = etiquetaEstado;
  readonly tonoEstado = tonoEstado;

  private reloj: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.buscar();
    this.rediseno.resumenPedidos().subscribe({
      next: (r) => this.kpis.set(this.armarKpis(r)),
      error: () => this.kpis.set([]),
    });
    this.ventas.cajas().subscribe({
      next: (c) => this.cajas.set(c),
      error: () => this.cajas.set([]),
    });
  }

  private armarKpis(r: ResumenPedidos): Kpi[] {
    const d = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
    const ventas = (n: number) => `${n} ${n === 1 ? 'venta' : 'ventas'}`;
    return [
      { etiqueta: 'Hoy', valor: d(r.hoy.total), pie: ventas(r.hoy.ventas), punto: 'var(--acento)' },
      { etiqueta: 'Esta semana', valor: d(r.semana.total), pie: `${ventas(r.semana.ventas)} desde el lunes`, punto: '#2a78d6' },
      {
        etiqueta: 'Por cobrar',
        valor: d(r.por_cobrar.total),
        // Lo fiado se debe en la CUENTA del cliente, no venta por venta: por eso
        // se cuentan clientes, no ventas.
        pie: `${r.por_cobrar.ventas} ${r.por_cobrar.ventas === 1 ? 'cliente debe' : 'clientes deben'} en su cuenta`,
        punto: '#E9A23B',
      },
      {
        etiqueta: 'Canceladas',
        valor: String(r.canceladas_mes.ventas),
        // Es lo que valían esas ventas, no dinero devuelto: en una fiada o un
        // apartado no se devolvió eso.
        pie: `este mes · ${d(r.canceladas_mes.total)} en ventas`,
        punto: '#C2410C',
      },
    ];
  }

  /** Vuelve a pedir la lista desde la primera página. */
  buscar(): void {
    this.pagina = 1;
    this.cargando.set(true);
    this.error.set(null);
    this.pedir().subscribe({
      next: (p) => {
        this.pedidos.set(p.items);
        this.total.set(p.total);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  /** El buscador espera a que deje de teclear: no una consulta por letra. */
  buscarAlTeclear(): void {
    if (this.reloj) clearTimeout(this.reloj);
    this.reloj = setTimeout(() => this.buscar(), 300);
  }

  /** Las siguientes 50. Antes solo se veían las primeras, sin forma de pasar. */
  verMas(): void {
    this.pagina += 1;
    this.cargandoMas.set(true);
    this.pedir().subscribe({
      next: (p) => {
        this.pedidos.update((a) => [...a, ...p.items]);
        this.total.set(p.total);
        this.cargandoMas.set(false);
      },
      error: (e) => {
        this.pagina -= 1;
        this.error.set(this.msg(e));
        this.cargandoMas.set(false);
      },
    });
  }

  private pedir() {
    return this.ventas.listarPedidos({
      canal: this.canal || undefined,
      estado: this.estado || undefined,
      q: this.q.trim() || undefined,
      caja_id: this.cajaId ? Number(this.cajaId) : undefined,
      desde: this.desde || undefined,
      hasta: this.hasta || undefined,
      page: this.pagina,
    });
  }

  /** El título de la tabla dice qué periodo se está viendo. Método: lee ngModel. */
  tituloLista(): string {
    if (!this.desde && !this.hasta) return 'Todas las ventas';
    if (this.desde === haceDias(6) && this.hasta === hoyLocal()) return 'Ventas de la semana';
    const f = (s: string) => (s ? s.split('-').reverse().slice(0, 2).join('/') : '…');
    return `Ventas del ${f(this.desde)} al ${f(this.hasta)}`;
  }

  /** "hoy 13:42", "ayer 18:05" o "30 sep 17:22": como se dice en la tienda. */
  cuando(fecha: string): string {
    const [dia, hora] = String(fecha ?? '').replace('T', ' ').split(' ');
    const hhmm = (hora ?? '').slice(0, 5);
    if (dia === hoyLocal()) return `hoy ${hhmm}`;
    if (dia === haceDias(1)) return `ayer ${hhmm}`;
    const [a, m, d] = dia.split('-').map(Number);
    if (!a || !m || !d) return String(fecha ?? '');
    const anio = String(a) === hoyLocal().slice(0, 4) ? '' : ` ${a}`;
    return `${d} ${MESES[m - 1]}${anio} ${hhmm}`;
  }

  /** "BLANCO 2/30", "NEGRO 2/30, BLANCO 2/30" o "CARAMEL 1/30 y 2 más". */
  queSeLlevo(p: Pedido): string {
    const h = p.hilos ?? [];
    if (h.length === 0) return '—';
    if (h.length <= 2) return h.join(', ');
    return `${h[0]} y ${h.length - 1} más`;
  }

  /** Quien compró, con como le dicen; "Cliente de paso" si no se identificó. */
  cliente(p: Pedido): string {
    return p.cliente_nombre_comercial || p.cliente || 'Cliente de paso';
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
