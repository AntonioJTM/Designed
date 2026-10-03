import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { VentasService } from '../../../core/services/ventas.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { AuthService } from '../../../core/services/auth.service';
import { Almacen } from '../../../core/models/inventario.models';
import { Caja, MovimientoCaja, SesionCaja } from '../../../core/models/ventas.models';
import { ApiError } from '../../../core/models/auth.models';
import { fechaRelativa } from '../../../shared/fecha.pipe';
import { folioCorto } from '../../../shared/folio.pipe';
import { MovimientoCajaModal } from './movimiento-caja-modal';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';

/**
 * La caja con que se trabaja. La MISMA clave la usa el punto de venta, para que
 * las dos pantallas abran la misma caja: el cajero abre el turno aquí y cobra
 * allá sin volver a elegir.
 */
const CLAVE_CAJA = 'caja_sel';

function leerCajaGuardada(): number | null {
  try {
    const v = Number(localStorage.getItem(CLAVE_CAJA));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function guardarCaja(id: number): void {
  try {
    localStorage.setItem(CLAVE_CAJA, String(id));
  } catch {
    /* sin almacenamiento local solo se pierde el recordatorio */
  }
}

/** Cómo se nombra cada movimiento del cajón, y de qué color va. */
interface FilaMovimiento {
  id: number;
  hora: string;
  tipo: string;
  tono: 'azul' | 'verde' | 'naranja' | 'rojo' | 'gris';
  detalle: string;
  monto: number;
  entra: boolean;
}

/**
 * CAJA (rediseño 2026-10): el turno, el efectivo y el corte. Antes vivían
 * dentro del punto de venta, abajo del cobro, y el corte quedaba escondido
 * debajo del carrito. Ahora el POS solo cobra y aquí se abre el turno, se saca
 * o mete efectivo y se cierra con el corte.
 *
 * Dar de alta o editar cajas es configuración (Permisos → «Almacenes y Listas
 * de precio»); sacar o meter efectivo, su propio permiso. Las dos cosas las
 * valida también el servidor.
 */
@Component({
  selector: 'app-caja',
  imports: [FormsModule, RouterLink, MovimientoCajaModal],
  templateUrl: './caja.html',
  host: { '(document:keydown.escape)': 'cerrarModalCaja()' },
  styles: `
    .corte-resumen { display: flex; flex-direction: column; gap: 8px; padding: 14px; border-radius: 8px; background: var(--fondo); font-size: 14px; }
    .corte-resumen > div { display: flex; justify-content: space-between; gap: 12px; }
    .corte-resumen > div > span:first-child { color: var(--tinta-3); }
    .corte-resumen .total { border-top: 1px solid #DDE1E7; padding-top: 8px; font-size: 16px; }
    .corte-resumen .total > span:first-child { color: var(--tinta); }
    .caja-fila { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--borde-suave); }
    .caja-fila .que { display: flex; flex-direction: column; gap: 3px; min-width: 0; text-align: left; background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; }
    .caja-fila .que b { font-size: 15px; font-weight: 500; }
    .caja-fila .que > span:not(.pill) { font-size: 13px; color: var(--tinta-3); }
    .caja-fila .que .pill { align-self: flex-start; margin-top: 4px; }
    .caja-fila.elegida .que b { color: var(--acento-oscuro); }
    .cajas-lista { display: flex; flex-direction: column; }
    .cajas-lista .caja-fila:first-child { border-top: 0; }
    .resultado-corte { display: flex; flex-wrap: wrap; gap: 24px; }
    .resultado-corte > div { display: flex; flex-direction: column; gap: 2px; }
    .resultado-corte span { font-size: 13px; color: var(--tinta-3); }
    .resultado-corte b { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
  `,
})
export class CajaPantalla {
  private readonly ventas = inject(VentasService);
  private readonly confirmacion = inject(ConfirmacionService);
  private readonly inv = inject(InventarioService);
  private readonly auth = inject(AuthService);

  readonly cajas = signal<Caja[]>([]);
  readonly cajaSel = signal<number | null>(null);
  readonly sesion = signal<SesionCaja | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  /** El corte recién hecho: la pantalla vuelve a "abrir turno" y el resultado no se pierde. */
  readonly ultimoCorte = signal<SesionCaja | null>(null);
  readonly movAbierto = signal(false);
  readonly cerrando = signal(false);

  montoInicial: number | null = 0;
  montoFinal: number | null = null;

  readonly puedeMoverEfectivo = computed(() => {
    this.auth.sesion();
    return this.auth.puede('hacer:mover_efectivo');
  });
  readonly administraCajas = computed(() => {
    this.auth.sesion();
    return this.auth.puede('ver:almacenes');
  });
  readonly vePos = computed(() => {
    this.auth.sesion();
    return this.auth.puede('ver:pos');
  });

  readonly caja = computed(() => this.cajas().find((c) => c.id === this.cajaSel()) ?? null);
  readonly abierta = computed(() => {
    const s = this.sesion();
    return !!s && s.estado === 'abierta';
  });

  /** Los movimientos del turno, del más reciente al más viejo. */
  readonly movimientos = computed<FilaMovimiento[]>(() =>
    [...(this.sesion()?.movimientos ?? [])].reverse().map((m) => this.fila(m))
  );

  /** Las cuatro cifras del turno, sacadas de sus movimientos. */
  readonly kpis = computed(() => {
    const s = this.sesion();
    const movs = s?.movimientos ?? [];
    const suma = (lista: MovimientoCaja[]) => lista.reduce((t, m) => t + Number(m.monto), 0);
    const ventas = movs.filter((m) => m.tipo === 'venta');
    const abonos = movs.filter((m) => m.tipo === 'ingreso' && this.esAbono(m));
    const retiros = movs.filter((m) => m.tipo === 'retiro');
    const devoluciones = movs.filter((m) => m.tipo === 'devolucion');
    const salio = [...retiros, ...devoluciones];
    const partes: string[] = [];
    if (retiros.length) partes.push(`${retiros.length} ${retiros.length === 1 ? 'retiro' : 'retiros'}`);
    if (devoluciones.length) partes.push(`${devoluciones.length} ${devoluciones.length === 1 ? 'devolución' : 'devoluciones'}`);
    return [
      { etiqueta: 'Debería haber', valor: this.pesos(s?.esperado_actual), pie: 'en el cajón ahora mismo', punto: '#2457C5' },
      {
        etiqueta: 'Ventas en efectivo',
        valor: this.pesos(suma(ventas)),
        pie: `${ventas.length} ${ventas.length === 1 ? 'venta' : 'ventas'}`,
        punto: '#1baf7a',
      },
      {
        etiqueta: 'Abonos',
        valor: this.pesos(suma(abonos)),
        pie: abonos.length === 0 ? 'nadie ha abonado en este turno' : `${abonos.length} ${abonos.length === 1 ? 'abono' : 'abonos'} en efectivo`,
        punto: '#2a78d6',
      },
      {
        etiqueta: 'Salió del cajón',
        valor: this.pesos(suma(salio)),
        pie: partes.length ? partes.join(' · ') : 'no ha salido dinero',
        punto: '#C2410C',
      },
    ];
  });

  /** Cuadre del corte mientras se teclea. Método, no `computed`: lee ngModel. */
  diferenciaPrevia(): number | null {
    if (this.montoFinal == null || (this.montoFinal as unknown) === '') return null;
    const esperado = Number(this.sesion()?.esperado_actual ?? 0);
    return Math.round((Number(this.montoFinal) - esperado) * 100) / 100;
  }

  // ---- Alta y edición de cajas ----
  readonly almacenes = signal<Almacen[]>([]);
  /** null = cerrado; 0 = caja nueva; >0 = editando esa caja. */
  readonly modalCaja = signal<number | null>(null);
  readonly guardandoCaja = signal(false);
  readonly errorCaja = signal<string | null>(null);
  formCaja = { nombre: '', almacen_id: '' as number | '', activo: true };

  constructor() {
    this.cargarCajas(true);
  }

  private cargarCajas(elegir: boolean): void {
    this.ventas.cajas().subscribe({
      next: (cs) => {
        this.cajas.set(cs);
        this.cargando.set(false);
        if (!elegir && cs.some((c) => c.id === this.cajaSel())) return;
        // La que se usó la última vez; si ya no existe, la primera con turno
        // abierto; si ninguna lo tiene, la primera activa.
        const guardada = leerCajaGuardada();
        const elegida =
          cs.find((c) => c.id === guardada) ??
          cs.find((c) => c.turno_id) ??
          cs.find((c) => c.activo) ??
          cs[0];
        if (elegida) this.elegir(elegida.id);
        else this.sesion.set(null);
      },
      error: (e) => {
        this.cargando.set(false);
        this.error.set(this.msg(e));
      },
    });
  }

  elegir(id: number | string): void {
    const n = Number(id);
    if (!n) return;
    this.cajaSel.set(n);
    guardarCaja(n);
    this.ultimoCorte.set(null);
    this.mensaje.set(null);
    this.error.set(null);
    this.montoFinal = null;
    this.ventas.sesionAbierta(n).subscribe({
      next: (s) => this.sesion.set(s),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  abrirTurno(): void {
    const id = this.cajaSel();
    if (!id) return;
    this.error.set(null);
    this.ventas.abrirSesion(id, Number(this.montoInicial ?? 0)).subscribe({
      next: (s) => {
        this.sesion.set(s);
        this.ultimoCorte.set(null);
        this.mensaje.set(`Turno abierto en ${s.caja ?? 'la caja'}. Ya se puede cobrar en Punto de venta.`);
        this.cargarCajas(false);
      },
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  async cerrarTurno(): Promise<void> {
    const s = this.sesion();
    if (!s) return;
    if (this.montoFinal == null || (this.montoFinal as unknown) === '') {
      this.error.set('Cuenta el efectivo del cajón y escríbelo para poder cerrar.');
      return;
    }
    // Cerrar no tiene vuelta: después de esto el turno ya no recibe ventas.
    const si = await this.confirmacion.pedir({
      titulo: `¿Cerrar el turno de ${s.caja ?? 'la caja'}?`,
      mensaje: `Con ${this.pesos2(this.montoFinal)} contados. Después ya no recibe ventas, y la diferencia queda guardada en el corte.`,
      aceptar: 'Cerrar el turno',
    });
    if (!si) return;
    this.error.set(null);
    this.cerrando.set(true);
    this.ventas.cerrarSesion(s.id, Number(this.montoFinal)).subscribe({
      next: (fresh) => {
        this.cerrando.set(false);
        this.ultimoCorte.set(fresh);
        this.sesion.set(null);
        this.montoFinal = null;
        this.montoInicial = 0;
        this.cargarCajas(false);
      },
      error: (e) => {
        this.cerrando.set(false);
        this.error.set(this.msg(e));
      },
    });
  }

  /**
   * Baja a la tarjeta del corte y pone el cursor en "Efectivo contado". No es
   * un `href="#corte"`: con `<base href="/">` ese enlace lleva a la raíz.
   */
  irAlCorte(): void {
    const tarjeta = document.getElementById('corte');
    tarjeta?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    tarjeta?.querySelector('input')?.focus({ preventScroll: true });
  }

  movimientoRegistrado(s: SesionCaja): void {
    this.sesion.set(s);
    this.mensaje.set(`Listo. En el cajón debería haber ${this.pesos2(s.esperado_actual)}.`);
  }

  // ---- Modal de caja ----

  nuevaCaja(): void {
    this.abrirModalCaja(0);
    this.formCaja = { nombre: '', almacen_id: this.almacenes()[0]?.id ?? '', activo: true };
  }

  editarCaja(c: Caja): void {
    this.abrirModalCaja(c.id);
    this.formCaja = { nombre: c.nombre, almacen_id: c.almacen_id, activo: !!c.activo };
  }

  private abrirModalCaja(id: number): void {
    this.errorCaja.set(null);
    this.modalCaja.set(id);
    if (this.almacenes().length === 0) {
      this.inv.almacenes().subscribe({
        next: (a) => {
          this.almacenes.set(a);
          if (!this.formCaja.almacen_id && a[0]) this.formCaja.almacen_id = a[0].id;
        },
        error: () => {},
      });
    }
  }

  cerrarModalCaja(): void {
    if (this.movAbierto()) return; // Escape lo atiende el modal de efectivo
    this.modalCaja.set(null);
  }

  guardarCajaForm(): void {
    const nombre = this.formCaja.nombre.trim();
    if (!nombre || !this.formCaja.almacen_id) {
      this.errorCaja.set('Ponle nombre a la caja y elige su almacén.');
      return;
    }
    const id = this.modalCaja();
    const body = { nombre, almacen_id: Number(this.formCaja.almacen_id), activo: this.formCaja.activo };
    this.guardandoCaja.set(true);
    this.errorCaja.set(null);
    const obs = id ? this.ventas.actualizarCaja(id, body) : this.ventas.crearCaja(body);
    obs.subscribe({
      next: (c) => {
        this.guardandoCaja.set(false);
        this.modalCaja.set(null);
        this.mensaje.set(id ? `Caja «${nombre}» actualizada.` : `Caja «${nombre}» dada de alta.`);
        this.cargarCajas(false);
        if (!id && !this.cajaSel()) this.elegir(c.id);
      },
      error: (e) => {
        this.guardandoCaja.set(false);
        this.errorCaja.set(this.msg(e));
      },
    });
  }

  async eliminarCajaForm(): Promise<void> {
    const id = this.modalCaja();
    const c = this.cajas().find((x) => x.id === id);
    if (!c) return;
    const si = await this.confirmacion.pedir({
      titulo: `¿Eliminar la caja «${c.nombre}»?`,
      mensaje: 'Solo se puede si nunca abrió un turno. Si ya trabajó, desactívala en vez de borrarla.',
      aceptar: 'Eliminar',
      peligro: true,
    });
    if (!si) return;
    this.ventas.eliminarCaja(c.id).subscribe({
      next: () => {
        this.modalCaja.set(null);
        this.mensaje.set(`Caja «${c.nombre}» eliminada.`);
        if (this.cajaSel() === c.id) this.cajaSel.set(null);
        this.cargarCajas(true);
      },
      error: (e) => this.errorCaja.set(this.msg(e)),
    });
  }

  // ---- Presentación ----

  /** "Último corte: ayer, cuadró" / "…, faltaron $30". */
  textoCorte(c: Caja): string {
    if (!c.ultimo_corte) return 'Todavía no tiene cortes';
    const d = Number(c.ultimo_corte_diferencia ?? 0);
    const como = d === 0 ? 'cuadró' : d < 0 ? `faltaron ${this.pesos2(-d)}` : `sobraron ${this.pesos2(d)}`;
    return `Último corte: ${this.cuando(c.ultimo_corte, false)}, ${como}`;
  }

  diferencia(c: SesionCaja): number {
    return Number(c.diferencia ?? 0);
  }

  private esAbono(m: MovimientoCaja): boolean {
    return (m.motivo ?? '').toLowerCase().startsWith('abono');
  }

  private fila(m: MovimientoCaja): FilaMovimiento {
    const folio = m.numero_pedido ? folioCorto(m.numero_pedido) + (m.cliente ? ` · ${m.cliente}` : ' · cliente de paso') : '';
    const base = { id: m.id, hora: this.hora(m.creado_en), monto: Number(m.monto) };
    switch (m.tipo) {
      case 'venta':
        return { ...base, tipo: 'Venta', tono: 'azul', detalle: folio || m.motivo || '', entra: true };
      case 'devolucion':
        return { ...base, tipo: 'Devolución', tono: 'rojo', detalle: m.motivo || folio, entra: false };
      case 'retiro':
        return { ...base, tipo: 'Retiro', tono: 'naranja', detalle: m.motivo || 'Sin motivo', entra: false };
      default:
        return this.esAbono(m)
          ? { ...base, tipo: 'Abono', tono: 'verde', detalle: (m.motivo ?? '').replace(/^Abono (de |al )?/i, ''), entra: true }
          : { ...base, tipo: 'Ingreso', tono: 'gris', detalle: m.motivo || 'Efectivo que se metió al cajón', entra: true };
    }
  }

  hora(iso: string | null | undefined): string {
    if (!iso) return '';
    const t = String(iso).replace('T', ' ').split(' ')[1] ?? '';
    const [h, m] = t.split(':');
    return h ? `${Number(h)}:${m}` : '';
  }

  /** "hoy a las 9:02", "ayer…" o "el 28/09…". */
  cuando(iso: string | null | undefined, conHora = true): string {
    return fechaRelativa(iso, conHora);
  }

  pesos(v: unknown): string {
    return Number(v ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
  }

  pesos2(v: unknown): string {
    return Number(v ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
