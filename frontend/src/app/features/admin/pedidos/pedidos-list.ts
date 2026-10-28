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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TiempoRealService } from '../../../core/services/tiempo-real.service';
import { forkJoin } from 'rxjs';
import { vendioOtraPersona } from '../../../shared/vendedor';

/** Una cifra de arriba de la pantalla. */
interface Kpi {
  etiqueta: string;
  valor: string;
  pie: string;
  /** El punto va por clase (`.punto.tono-*`), no con style= (DESIGN.md). */
  tono: string;
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
    .kpi-valor { font-size: 1.75rem; }
    td.folio a { font-family: var(--mono); font-size: 0.8125rem; text-decoration: none; white-space: nowrap; }
    td.cliente { font-weight: 500; }
    td.cliente .num-cli { display: block; font-family: var(--mono); font-size: 0.75rem; font-weight: 400; color: var(--tinta-3); }
    td .no-contado { color: var(--aviso-t); }
    td .porque { display: block; font-size: 0.75rem; color: var(--tinta-3); }
    td .porque .debe { color: var(--aviso-t); font-weight: 600; }
    td .porque .vencida { color: var(--alerta-t); font-weight: 600; }
    .periodos { flex: 0 0 auto; }
    td.tenue { color: var(--tinta-2); }
    td .vendio { display: block; font-size: 0.75rem; color: var(--tinta-3); }
    td .falta { color: var(--alerta-t); }
    .mas { display: flex; justify-content: center; padding-top: 14px; }
  `,
})
export class PedidosList {
  /** Bajo «Elaboró», "vendió X" si la vendió otra persona (2026-10-23). */
  protected readonly vendioOtra = vendioOtraPersona;
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
  /** Sube con cada búsqueda o "Ver más": un refresco en vivo que llega tarde se tira. */
  private vuelta = 0;

  // Filtros. Son campos con ngModel: lo que dependa de ellos se lee con
  // MÉTODOS, nunca con computed().
  /*
   * TIENDA EN LÍNEA APAGADA (2026-10): el filtro de canal está comentado en la
   * plantilla porque hoy todo es mostrador. La lógica se queda: al volver a
   * abrir la tienda basta con descomentar el <label> "Canal".
   */
  canal: CanalVenta | '' = '';
  estado: EstadoPedido | '' = '';
  /** Emitidas, con devolución o canceladas (2026-10-16). Vacío = todas. */
  situacion: 'emitidas' | 'canceladas' | 'con_devolucion' | '' = '';
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
    // EN VIVO (2026-10-19, etapa 2): lo que se vende, cancela o devuelve en otra
    // caja aparece aquí sin recargar (solo lo de sus tiendas). También un abono a
    // la cuenta del cliente: cambia el "falta $X" de sus ventas a crédito.
    inject(TiempoRealService)
      .cambios(['ventas', 'clientes'])
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.refrescarEnVivo());
  }

  /**
   * Las cifras de arriba y la lista con las páginas que ya se cargaron con "Ver
   * más" (se vuelven a pedir todas y se reemplazan juntas). Si se está pidiendo
   * algo, se deja: ya llega.
   */
  private refrescarEnVivo(): void {
    this.rediseno.resumenPedidos().subscribe({
      next: (r) => this.kpis.set(this.armarKpis(r)),
      error: () => {},
    });
    if (this.cargando() || this.cargandoMas()) return;
    const vuelta = this.vuelta;
    const paginas = this.pagina;
    const pedidas = [];
    for (let p = 1; p <= paginas; p++) {
      this.pagina = p;
      pedidas.push(this.pedir());
    }
    this.pagina = paginas;
    forkJoin(pedidas).subscribe({
      next: (ps) => {
        if (vuelta !== this.vuelta || this.cargando() || this.cargandoMas()) return;
        this.pedidos.set(ps.flatMap((p) => p.items));
        this.total.set(ps[ps.length - 1]?.total ?? 0);
      },
      error: () => {},
    });
  }

  private armarKpis(r: ResumenPedidos): Kpi[] {
    const d = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const ventas = (n: number) => `${n} ${n === 1 ? 'venta' : 'ventas'}`;
    return [
      { etiqueta: 'Hoy', valor: d(r.hoy.total), pie: ventas(r.hoy.ventas), tono: 'tono-acento' },
      { etiqueta: 'Esta semana', valor: d(r.semana.total), pie: `${ventas(r.semana.ventas)} desde el lunes`, tono: 'tono-acento' },
      {
        etiqueta: 'Por cobrar',
        valor: d(r.por_cobrar.total),
        // Lo fiado se debe en la CUENTA del cliente, no venta por venta: por eso
        // se cuentan clientes, no ventas.
        pie: `${r.por_cobrar.ventas} ${r.por_cobrar.ventas === 1 ? 'cliente debe' : 'clientes deben'} en su cuenta`,
        tono: 'tono-aviso',
      },
      {
        etiqueta: 'Canceladas',
        valor: String(r.canceladas_mes.ventas),
        // Es lo que valían esas ventas, no dinero devuelto: en una fiada o un
        // apartado no se devolvió eso.
        pie: `este mes · ${d(r.canceladas_mes.total)} en ventas`,
        tono: 'tono-alerta',
      },
    ];
  }

  /** Vuelve a pedir la lista desde la primera página. */
  buscar(): void {
    this.vuelta += 1;
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
    this.vuelta += 1;
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
      situacion: this.situacion || undefined,
      q: this.q.trim() || undefined,
      caja_id: this.cajaId ? Number(this.cajaId) : undefined,
      desde: this.desde || undefined,
      hasta: this.hasta || undefined,
      page: this.pagina,
    });
  }

  // ---- Atajos de fechas (2026-10-16): hoy, la semana, el mes o todo ----

  /** Cuál atajo está puesto (para pintarlo elegido); null si son fechas a mano. */
  periodo(): 'hoy' | 'semana' | 'mes' | 'todo' | null {
    const hoy = hoyLocal();
    if (!this.desde && !this.hasta) return 'todo';
    if (this.hasta !== hoy) return null;
    if (this.desde === hoy) return 'hoy';
    if (this.desde === haceDias(6)) return 'semana';
    if (this.desde === hoy.slice(0, 8) + '01') return 'mes';
    return null;
  }

  ponerPeriodo(p: 'hoy' | 'semana' | 'mes' | 'todo'): void {
    const hoy = hoyLocal();
    this.desde = p === 'todo' ? '' : p === 'hoy' ? hoy : p === 'semana' ? haceDias(6) : hoy.slice(0, 8) + '01';
    this.hasta = p === 'todo' ? '' : hoy;
    this.buscar();
  }

  /** "Emitida", "Cancelada", "Devolución" o "Devolución parcial", con su color. */
  situacionDe(p: Pedido): { texto: string; tono: string } {
    switch (p.situacion) {
      case 'cancelada': return { texto: 'Cancelada', tono: 'rojo' };
      case 'devolucion': return { texto: 'Devolución', tono: 'ambar' };
      case 'devolucion_parcial': return { texto: 'Devolución parcial', tono: 'ambar' };
      default: return { texto: 'Emitida', tono: 'azul' };
    }
  }

  /** "Sí", o "No" con por qué: a crédito, pendiente de pago, en espera o apartado. */
  /**
   * De contado: Sí, o No y por qué. Y cuando es No, CUÁNTO FALTA (2026-10-16: "ve
   * tres que dicen No · a crédito y tiene que abrir cada una para saber si ya la
   * pagaron"): "falta $1,200.00" o "ya liquidada". Lo que falta es el mismo que
   * calcula el servidor (en una fiada, con sus abonos repartidos de lo más
   * antiguo a lo más nuevo). Una cancelada no debe nada: solo dice por qué.
   */
  contadoDe(p: Pedido): { si: boolean; porque: string; falta: number | null } {
    if (p.contado) return { si: true, porque: '', falta: null };
    const porque = p.fiada ? 'a crédito'
      : Number(p.nota_pendiente) ? 'pendiente de pago'
      : Number(p.encargo) ? 'en espera'
      : p.estado === 'apartado' ? 'apartado' : '';
    const viva = p.estado !== 'cancelado' && p.estado !== 'devuelto';
    return { si: false, porque, falta: viva ? Math.max(0, Number(p.falta ?? 0)) : null };
  }

  /** El título de la tabla dice qué periodo se está viendo. Método: lee ngModel. */
  tituloLista(): string {
    const titulos = { todo: 'Todas las ventas', hoy: 'Ventas de hoy', semana: 'Ventas de los últimos 7 días', mes: 'Ventas de este mes' };
    const p = this.periodo();
    if (p) return titulos[p];
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
