import { Component, DestroyRef, OnDestroy, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VentasService } from '../../../core/services/ventas.service';
import { AuthService } from '../../../core/services/auth.service';
import { TiempoRealService } from '../../../core/services/tiempo-real.service';
import { Gasto, ListaGastos, TipoGasto } from '../../../core/models/ventas.models';
import { ApiError } from '../../../core/models/auth.models';
import { fechaRelativa, hoyLocal } from '../../../shared/fecha.pipe';
import { guardarArchivo, nombreArchivo } from '../../../shared/descargar';
import { nuevaClave } from '../../../core/clave-unica';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';
import { TiposGastoModal } from './tipos-gasto-modal';

type Periodo = 'hoy' | 'semana' | 'mes';

/** El día de hace `n` días, en hora local. */
function haceDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * GASTOS DE LA CAJA (2026-10-20): lo que se pagó con el cajón en sus tiendas,
 * por periodo y por tipo, con lo gastado de cada tipo. Cada gasto dice quién lo
 * registró, si pasó su límite (y quién lo autorizó), su foto del ticket y, con
 * su turno abierto todavía, se puede cancelar (el dinero regresa al cajón).
 */
@Component({
  selector: 'app-gastos-caja',
  imports: [FormsModule, TiposGastoModal],
  styleUrl: './gastos-caja.scss',
  host: { '(document:keydown.escape)': 'cerrarVentanas()' },
  templateUrl: './gastos-caja.html',
})
export class GastosCaja implements OnDestroy {
  private readonly ventas = inject(VentasService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly confirmacion = inject(ConfirmacionService);

  /** Sube cuando la caja registra un gasto: la lista se vuelve a pedir. */
  readonly version = input(0);

  readonly lista = signal<ListaGastos | null>(null);
  readonly tipos = signal<TipoGasto[]>([]);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  readonly cargando = signal(false);
  readonly verTipos = signal(false);
  /** El gasto que se está cancelando (pide el motivo). */
  readonly cancelando = signal<Gasto | null>(null);
  readonly guardando = signal(false);
  /** La foto que se está viendo: su dirección local y su tipo. */
  readonly foto = signal<{ gasto: Gasto; url: string; pdf: boolean } | null>(null);
  readonly subiendoFoto = signal<number | null>(null);

  periodo: Periodo = 'hoy';
  tipoSel: number | '' = '';
  motivo = '';
  private claveCancelar = nuevaClave();

  readonly puedeRegistrar = computed(() => { this.auth.sesion(); return this.auth.puede('hacer:registrar_gasto'); });
  readonly puedeCancelar = computed(() => { this.auth.sesion(); return this.auth.puede('hacer:mover_efectivo'); });
  readonly administraTipos = computed(() => { this.auth.sesion(); return this.auth.puede('hacer:tipos_gasto'); });

  constructor() {
    this.cargarTipos();
    // La caja avisa con `version` (al abrir y cada que registra un gasto).
    effect(() => {
      this.version();
      untracked(() => this.cargar(false));
    });
    // EN VIVO: un gasto registrado o cancelado en otra caja de sus tiendas.
    inject(TiempoRealService)
      .cambios(['caja'])
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.cargar(true));
  }

  ngOnDestroy(): void {
    this.soltarFoto();
  }

  cargarTipos(): void {
    this.ventas.tiposGasto(this.administraTipos()).subscribe({ next: (t) => this.tipos.set(t), error: () => {} });
  }

  cargar(callado: boolean): void {
    if (!callado) this.cargando.set(true);
    const hoy = hoyLocal();
    const desde = this.periodo === 'hoy' ? hoy : this.periodo === 'semana' ? haceDias(6) : hoy.slice(0, 8) + '01';
    const pedido = { periodo: this.periodo, tipo: this.tipoSel };
    this.ventas
      .gastos({ desde, hasta: hoy, tipo_gasto_id: this.tipoSel === '' ? undefined : Number(this.tipoSel) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (l) => {
          // Una respuesta que llega después de cambiar el filtro ya no sirve.
          if (pedido.periodo !== this.periodo || pedido.tipo !== this.tipoSel) return;
          this.lista.set(l);
          this.cargando.set(false);
        },
        error: (e) => {
          this.error.set(this.msg(e));
          this.cargando.set(false);
        },
      });
  }

  elegirPeriodo(p: Periodo): void {
    this.periodo = p;
    this.cargar(false);
  }

  textoPeriodo(): string {
    return this.periodo === 'hoy' ? 'hoy' : this.periodo === 'semana' ? 'en los últimos 7 días' : 'este mes';
  }

  /** Lo de cada tipo como parte del total, para su barra. */
  pct(total: number): number {
    const t = this.lista()?.total ?? 0;
    return t > 0 ? Math.round((total / t) * 100) : 0;
  }

  cuando(iso: string): string {
    return fechaRelativa(iso);
  }

  dinero(v: unknown): string {
    return Number(v ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });
  }

  // ---- Cancelar ----
  abrirCancelar(g: Gasto): void {
    this.motivo = '';
    this.error.set(null);
    this.cancelando.set(g);
  }

  cancelar(): void {
    const g = this.cancelando();
    const motivo = this.motivo.trim();
    if (!g || motivo.length < 3) return;
    this.guardando.set(true);
    this.ventas.cancelarGasto(g.id, motivo, this.claveCancelar).subscribe({
      next: () => {
        this.claveCancelar = nuevaClave();
        this.guardando.set(false);
        this.cancelando.set(null);
        this.mensaje.set(`Se canceló el gasto de ${g.tipo} por ${this.dinero(g.monto)}: el dinero regresó al cajón.`);
        this.cargar(true);
      },
      error: (e) => {
        this.guardando.set(false);
        this.error.set(this.msg(e));
      },
    });
  }

  // ---- La foto del ticket ----
  verFoto(g: Gasto): void {
    this.ventas.fotoGasto(g.id).subscribe({
      next: (blob) => {
        if (blob.type === 'application/pdf') {
          guardarArchivo(blob, nombreArchivo(g.comprobante_nombre || `Ticket gasto ${g.id}.pdf`));
          return;
        }
        this.soltarFoto();
        this.foto.set({ gasto: g, url: URL.createObjectURL(blob), pdf: false });
      },
      error: () => this.error.set('No se pudo abrir la foto del ticket.'),
    });
  }

  soltarFoto(): void {
    const f = this.foto();
    if (f) URL.revokeObjectURL(f.url);
    this.foto.set(null);
  }

  subirFoto(g: Gasto, e: Event): void {
    const input = e.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    this.subiendoFoto.set(g.id);
    this.ventas.subirFotoGasto(g.id, archivo).subscribe({
      next: () => {
        this.subiendoFoto.set(null);
        this.mensaje.set(`Se subió la foto del ticket del gasto de ${g.tipo}.`);
        this.cargar(true);
      },
      error: (er) => {
        this.subiendoFoto.set(null);
        this.error.set(this.msg(er));
      },
    });
  }

  /**
   * Cambiar o quitar la foto: quien registró el gasto mientras su turno siga
   * abierto, o quien saca efectivo (lo mismo revisa el servidor).
   */
  puedeCambiarFoto(g: Gasto): boolean {
    if (g.estado !== 'registrado') return false;
    const suyo = g.usuario_id === this.auth.sesion()?.id && g.turno_estado === 'abierta';
    return suyo || this.puedeCancelar();
  }

  async quitarFoto(g: Gasto): Promise<void> {
    const si = await this.confirmacion.pedir({
      titulo: 'Quitar la foto del ticket',
      mensaje: `El gasto de ${g.tipo} por ${this.dinero(g.monto)} se queda sin su prueba.`,
      aceptar: 'Quitar la foto',
      peligro: true,
    });
    if (!si) return;
    this.ventas.quitarFotoGasto(g.id).subscribe({
      next: () => {
        this.soltarFoto();
        this.cargar(true);
      },
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  cerrarVentanas(): void {
    if (this.verTipos()) return; // la ventana de tipos atiende su propio Escape
    if (this.foto()) this.soltarFoto();
    else if (this.cancelando()) this.cancelando.set(null);
  }

  alCerrarTipos(cambio: boolean): void {
    this.verTipos.set(false);
    if (cambio) {
      this.cargarTipos();
      this.cargar(true);
    }
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
