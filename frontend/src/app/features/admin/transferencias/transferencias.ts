import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { TransferenciasService } from '../../../core/services/transferencias.service';
import { AuthService } from '../../../core/services/auth.service';
import { TiempoRealService } from '../../../core/services/tiempo-real.service';
import {
  CifrasTransferencias,
  DeTransferencia,
  EstadoTransferencia,
  ListaTransferencias,
  Transferencia,
} from '../../../core/models/transferencias.models';
import { ApiError } from '../../../core/models/auth.models';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { FolioPipe } from '../../../shared/folio.pipe';
import { FechaPipe, hoyLocal } from '../../../shared/fecha.pipe';
import { TransferenciaModal } from './transferencia-modal';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** 'YYYY-MM-DD' de hace `dias` días, en hora LOCAL. */
function haceDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DE: Record<DeTransferencia, string> = {
  venta: 'Venta',
  nota: 'Nota pendiente',
  espera: 'Nota en espera',
  abono: 'Abono',
  anticipo: 'Anticipo',
  // Lo abonado que se le regresó por el banco al cancelar una venta a crédito (2026-10-26).
  regreso: 'Se le regresó',
};

/**
 * TRANSFERENCIAS (2026-10-20, usuario: "un apartado en ventas que se llame
 * transferencias", con los datos de su hoja). Todo lo que entró por
 * transferencia —ventas, pagos de notas, abonos y anticipos— sale SOLO, con a
 * qué cuenta llegó, su número de operación, el material de lo que se llevó, el
 * importe, si ya se vio en el banco (Por revisar / Procesada) y si se facturó.
 * Se marcan varias de una vez; la cuenta y el folio se corrigen en su ventana.
 * Suma todas las tiendas: la ve solo quien las ve todas.
 */
@Component({
  selector: 'app-transferencias',
  imports: [FormsModule, RouterLink, DineroPipe, FolioPipe, FechaPipe, TransferenciaModal],
  templateUrl: './transferencias.html',
  styleUrl: './transferencias.scss',
})
export class Transferencias {
  private readonly svc = inject(TransferenciasService);
  private readonly auth = inject(AuthService);

  readonly items = signal<Transferencia[]>([]);
  readonly cifras = signal<CifrasTransferencias | null>(null);
  readonly porCuenta = signal<ListaTransferencias['por_cuenta']>([]);
  readonly total = signal(0);
  readonly cargando = signal(true);
  readonly cargandoMas = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  readonly marcando = signal(false);
  /** Las elegidas para marcarlas juntas (por su clave). */
  readonly elegidas = signal<Set<string>>(new Set());
  /** La que se está corrigiendo en su ventana. */
  readonly editando = signal<Transferencia | null>(null);

  readonly cuentas = this.svc.cuentas;
  readonly puedeMarcar = this.auth.puede('hacer:revisar_transferencias');

  // Filtros (ngModel): lo que dependa de ellos se lee con MÉTODOS.
  q = '';
  desde = '';
  hasta = '';
  cuenta: number | 'sin' | '' = '';
  estado: EstadoTransferencia | '' = '';
  facturada: '' | 'si' | 'no' = '';
  de: DeTransferencia | '' = '';

  private paginas = 1;
  /** Sube con cada búsqueda: un refresco que llega tarde se tira. */
  private vuelta = 0;
  private reloj: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.svc.cargarCuentas();
    this.buscar();
    // EN VIVO: lo que se cobra por transferencia en la caja, un abono, un
    // anticipo o lo que marca otra persona aparece sin recargar.
    inject(TiempoRealService)
      .cambios(['ventas', 'clientes', 'transferencias'], 2000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.refrescar());
  }

  private filtros(pagina: number) {
    return {
      desde: this.desde || undefined,
      hasta: this.hasta || undefined,
      q: this.q.trim() || undefined,
      cuenta: this.cuenta || undefined,
      estado: this.estado || undefined,
      facturada: this.facturada === 'si' ? true : this.facturada === 'no' ? false : undefined,
      de: this.de || undefined,
      offset: (pagina - 1) * 100,
    };
  }

  private poner(l: ListaTransferencias, items: Transferencia[]): void {
    this.items.set(items);
    this.total.set(l.total);
    this.cifras.set(l.cifras);
    this.porCuenta.set(l.por_cuenta);
    // Las elegidas que ya no están en la lista se sueltan.
    const claves = new Set(items.map((i) => i.clave));
    this.elegidas.update((s) => new Set([...s].filter((k) => claves.has(k))));
  }

  buscar(): void {
    this.vuelta += 1;
    this.paginas = 1;
    this.cargando.set(true);
    this.error.set(null);
    this.elegidas.set(new Set());
    const vuelta = this.vuelta;
    this.svc.listar(this.filtros(1)).subscribe({
      next: (l) => {
        if (vuelta !== this.vuelta) return;
        this.poner(l, l.items);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  buscarAlTeclear(): void {
    if (this.reloj) clearTimeout(this.reloj);
    this.reloj = setTimeout(() => this.buscar(), 300);
  }

  verMas(): void {
    this.vuelta += 1;
    const vuelta = this.vuelta;
    this.cargandoMas.set(true);
    this.svc.listar(this.filtros(this.paginas + 1)).subscribe({
      next: (l) => {
        if (vuelta !== this.vuelta) return;
        this.paginas += 1;
        this.poner(l, [...this.items(), ...l.items]);
        this.cargandoMas.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargandoMas.set(false);
      },
    });
  }

  /** Callado: las mismas páginas que ya se veían, sin "Cargando…". */
  refrescar(): void {
    if (this.cargando() || this.cargandoMas()) return;
    const vuelta = this.vuelta;
    const pedidas = Array.from({ length: this.paginas }, (_, i) => this.svc.listar(this.filtros(i + 1)));
    forkJoin(pedidas).subscribe({
      next: (ls) => {
        if (vuelta !== this.vuelta || this.cargando() || this.cargandoMas()) return;
        this.poner(ls[ls.length - 1], ls.flatMap((l) => l.items));
      },
      error: () => {},
    });
  }

  // ---- Periodo, como en Ventas ----

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

  // ---- Elegir y marcar varias ----

  elegida(t: Transferencia): boolean {
    return this.elegidas().has(t.clave);
  }

  alternar(t: Transferencia, si: boolean): void {
    this.elegidas.update((s) => {
      const n = new Set(s);
      if (si) n.add(t.clave); else n.delete(t.clave);
      return n;
    });
  }

  todasElegidas(): boolean {
    const it = this.items();
    return it.length > 0 && it.every((t) => this.elegidas().has(t.clave));
  }

  alternarTodas(si: boolean): void {
    this.elegidas.set(si ? new Set(this.items().map((t) => t.clave)) : new Set());
  }

  /** Lo que suman las elegidas. */
  importeElegidas(): number {
    const e = this.elegidas();
    return Math.round(this.items().filter((t) => e.has(t.clave)).reduce((s, t) => s + t.importe, 0) * 100) / 100;
  }

  marcar(cambios: { estado?: EstadoTransferencia; facturada?: boolean }): void {
    const claves = [...this.elegidas()];
    if (!claves.length || this.marcando()) return;
    this.marcando.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    this.svc.marcar(claves, cambios).subscribe({
      next: (r) => {
        this.marcando.set(false);
        const n = r.marcadas;
        const que = cambios.estado === 'procesada' ? (n === 1 ? 'procesada' : 'procesadas')
          : cambios.estado === 'por_revisar' ? 'por revisar'
          : cambios.facturada ? (n === 1 ? 'facturada' : 'facturadas') : 'sin facturar';
        this.mensaje.set(`${n} ${n === 1 ? 'transferencia quedó' : 'transferencias quedaron'} ${que}.`);
        this.elegidas.set(new Set());
        this.refrescar();
      },
      error: (e) => {
        this.marcando.set(false);
        this.error.set(this.msg(e));
      },
    });
  }

  /** Lo que se corrigió en su ventana: se pone el renglón al día y las cifras. */
  alGuardar(t: Transferencia): void {
    this.items.update((it) => it.map((x) => (x.clave === t.clave ? t : x)));
    this.editando.set(null);
    this.mensaje.set('Se guardó la transferencia.');
    this.refrescar();
  }

  // ---- Cómo se dice cada cosa ----

  de_(t: Transferencia): string {
    return DE[t.de] ?? t.de;
  }

  nombreCuenta(t: Transferencia): string {
    return this.svc.nombreCuenta({ banco: t.cuenta, cuenta_ultimos: t.cuenta_ultimos });
  }

  nombreCuentaFila(c: { banco: string | null; ultimos: string | null }): string {
    return this.svc.nombreCuenta(c);
  }

  /** "hoy 13:42", "ayer 18:05" o "30 sep 17:22". */
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

  /** Lo que mide cada barra de "A qué cuenta llegó": su parte del total. */
  anchoCuenta(importe: number): number {
    const t = this.cifras()?.importe ?? 0;
    return t > 0 ? Math.max(1, Math.round((importe / t) * 100)) : 0;
  }

  tituloLista(): string {
    const t = { todo: 'Todas las transferencias', hoy: 'Las de hoy', semana: 'Las de los últimos 7 días', mes: 'Las de este mes' };
    const p = this.periodo();
    if (p) return t[p];
    const f = (s: string) => (s ? s.split('-').reverse().slice(0, 2).join('/') : '…');
    return `Del ${f(this.desde)} al ${f(this.hasta)}`;
  }

  plural(n: number, uno: string, varios: string): string {
    return `${n} ${n === 1 ? uno : varios}`;
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
