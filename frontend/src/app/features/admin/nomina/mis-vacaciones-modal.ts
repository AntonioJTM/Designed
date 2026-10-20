import { Component, OnInit, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NominaService } from '../../../core/services/nomina.service';
import { AutorizacionesService } from '../../../core/services/autorizaciones.service';
import { MisVacaciones, VacacionPedida } from '../../../core/models/nomina.models';
import { ApiError } from '../../../core/models/auth.models';
import { diasHabilesEnRango } from './jornada';
import { hoyLocal } from '../../../shared/fecha.pipe';

/** "lun 3 nov" de una fecha 'YYYY-MM-DD', sin moverla de día. */
function corta(iso: string | null | undefined): string {
  if (!iso) return '';
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
}

/** "10 ene 2026"; con `menos` días antes (el año de vacaciones termina un día antes del aniversario). */
function conAnio(iso: string | null | undefined, menos = 0): string {
  if (!iso) return '';
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d - menos).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '');
}

const ESTADO: Record<VacacionPedida['estado'], { texto: string; tono: string }> = {
  pendiente: { texto: 'Esperando respuesta', tono: 'ambar' },
  aprobando: { texto: 'Registrándose…', tono: 'info' },
  aprobada: { texto: 'Aprobadas', tono: 'ok' },
  rechazada: { texto: 'No se aprobaron', tono: 'rojo' },
  cancelada: { texto: 'Las retiraste', tono: 'gris' },
  vencida: { texto: 'Vencieron', tono: 'gris' },
  cerrada: { texto: 'Cerrada', tono: 'gris' },
};

/**
 * "MIS VACACIONES" (2026-10-19: "que las apruebe o no, y cuando se le aprueben
 * que le mande mensaje al WhatsApp"). Cada quien ve cuántos días le tocan por
 * ley, cuántos tomó y cuántos le quedan, y las PIDE; las autoriza quien tiene
 * «Autorizar vacaciones» (nunca las propias) y se le avisa por WhatsApp.
 */
@Component({
  selector: 'app-mis-vacaciones-modal',
  imports: [FormsModule],
  host: { '(document:keydown.escape)': 'cerrar()' },
  styles: [`
    .saldo { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .saldo .kpi { padding: 12px; }
    .vista-previa { margin: 0; font-weight: 600; }
    .pedidas, .tomadas { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .pedidas li, .tomadas li { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; justify-content: space-between;
      padding: 8px 0; border-bottom: 1px solid var(--borde); }
    .pedidas li:last-child, .tomadas li:last-child { border-bottom: 0; }
    .que { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .que small { color: var(--tinta-3); }
    h3 { margin: 0; font-size: 0.9375rem; }
    @media (max-width: 520px) { .saldo { grid-template-columns: minmax(0, 1fr); } }
  `],
  template: `
    <div class="modal-overlay">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="mis-vacaciones-titulo">
        <div class="modal-head">
          <h2 id="mis-vacaciones-titulo">Mis vacaciones</h2>
          <button type="button" class="modal-cerrar" (click)="cerrar()" aria-label="Cerrar">✕</button>
        </div>
        <form (ngSubmit)="pedir()">
          <div class="modal-body columna">
            @if (cargando()) { <div class="modal-cargando" aria-live="polite"><span class="spinner" aria-hidden="true"></span> Cargando…</div> }
            @if (error()) { <p class="alert" role="alert">{{ error() }}</p> }
            @if (mensaje()) { <p class="ok-msg" role="status">{{ mensaje() }}</p> }

            @if (datos(); as d) {
              @if (!d.en_nomina) {
                <p class="aviso">Todavía no estás en la nómina: pídele al administrador que te dé de alta. Ahí se cuentan tus días de vacaciones.</p>
              } @else {
                @if (!d.horario?.length) {
                  <p class="aviso">Falta tu horario en la nómina (con él se cuentan tus días; tus descansos no cuentan): pídeselo al administrador.</p>
                }
                @if (d.saldo; as s) {
                  @if (s.anios < 1) {
                    <p class="aviso">Cumples tu primer año el {{ conAnio(s.proximo_aniversario) }}: desde entonces te tocan {{ s.dias_proximo_anio }} días.</p>
                  } @else {
                    <div class="saldo">
                      <div class="kpi"><span class="kpi-label">Te tocan</span><span class="kpi-valor">{{ dias(s.corresponden) }}</span></div>
                      <div class="kpi"><span class="kpi-label">Ya tomaste</span><span class="kpi-valor">{{ dias(s.tomados) }}</span></div>
                      <div class="kpi"><span class="kpi-label">Te quedan</span><span class="kpi-valor">{{ dias(s.restan) }}</span></div>
                    </div>
                    <p class="muted">Tu año de vacaciones va del {{ conAnio(s.desde) }} al {{ conAnio(s.hasta, 1) }}. Cuentan solo tus días de trabajo: tus descansos no.</p>
                  }
                } @else {
                  <p class="aviso">Falta tu fecha de ingreso en la nómina (con ella se cuentan tus días): pídesela al administrador.</p>
                }

                @if (sePuedenPedir()) {
                <h3>Pedir vacaciones</h3>
                <div class="form-grid">
                  <label class="field">
                    Desde
                    <input type="date" name="desde" [min]="hoy" [(ngModel)]="desde" />
                  </label>
                  <label class="field">
                    Hasta
                    <input type="date" name="hasta" [min]="desde || hoy" [(ngModel)]="hasta" />
                  </label>
                </div>
                <label class="field">
                  <span>Para qué <span class="muted">(opcional)</span></span>
                  <input type="text" name="notas" maxlength="255" [(ngModel)]="notas" />
                </label>
                @if (diasPedidos() !== null) {
                  <p class="vista-previa" role="status">
                    @if (diasPedidos() === 0) {
                      En esas fechas no te toca trabajar: no gastan días.
                    } @else {
                      Son {{ dias(diasPedidos()!) }} de trabajo.
                      @if (d.saldo && diasPedidos()! > d.saldo.restan) {
                        <b>Te quedan {{ dias(d.saldo.restan) }}: son más de los que tienes.</b>
                      } @else if (d.saldo) {
                        <!-- Antes → después (2026-10-20). -->
                        Te quedan {{ dias(d.saldo.restan) }} → te quedarán {{ dias(d.saldo.restan - diasPedidos()!) }}.
                      }
                    }
                  </p>
                }
                }
              }

              @if (d.pedidas.length) {
                <h3>Lo que has pedido</h3>
                <ul class="pedidas">
                  @for (p of d.pedidas; track p.id) {
                    <li>
                      <span class="que">
                        <b>Del {{ corta(p.fecha_inicio) }} al {{ corta(p.fecha_fin) }}</b>
                        @if (p.estado === 'rechazada' && p.motivo) { <small>Por qué: {{ p.motivo }}</small> }
                        @if (p.aviso) { <small>{{ p.aviso }}</small> }
                      </span>
                      <span>
                        <span [class]="'pill ' + estado(p).tono">{{ estado(p).texto }}</span>
                        @if (p.estado === 'pendiente') {
                          <button type="button" class="btn btn-ghost btn-sm" (click)="retirar(p)" [disabled]="guardando()">Retirarlas</button>
                        }
                      </span>
                    </li>
                  }
                </ul>
              }
              @if (d.registros?.length) {
                <h3>Las que ya tienes registradas</h3>
                <ul class="tomadas">
                  @for (r of d.registros; track r.id) {
                    <li><span>Del {{ corta(r.fecha_inicio) }} al {{ corta(r.fecha_fin) }}</span><span class="muted">{{ +r.dias }} {{ +r.dias === 1 ? 'día' : 'días' }}</span></li>
                  }
                </ul>
              }
            }
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-ghost" (click)="cerrar()">Cerrar</button>
            @if (sePuedenPedir()) {
              <button type="submit" class="btn btn-primary" [disabled]="guardando() || !puedePedir()">
                {{ guardando() ? 'Pidiendo…' : 'Pedir vacaciones' }}
              </button>
            }
          </div>
        </form>
      </div>
    </div>
  `,
})
export class MisVacacionesModal implements OnInit {
  private readonly nomina = inject(NominaService);
  private readonly autorizaciones = inject(AutorizacionesService);
  readonly cerrado = output<void>();

  readonly datos = signal<MisVacaciones | null>(null);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  readonly hoy = hoyLocal();
  desde = '';
  hasta = '';
  notas = '';
  readonly corta = corta;
  readonly conAnio = conAnio;

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.nomina.misVacaciones().subscribe({
      next: (d) => {
        this.datos.set(d);
        this.cargando.set(false);
      },
      error: (e) => {
        this.cargando.set(false);
        this.error.set(this.msg(e));
      },
    });
  }

  /** Cuántos días de trabajo son las fechas escritas (método: cambia con cada tecla). */
  diasPedidos(): number | null {
    const d = this.datos();
    if (!d?.horario || !this.desde || !this.hasta || this.hasta < this.desde) return null;
    return diasHabilesEnRango(d.horario, this.desde, this.hasta);
  }

  /** Con lo necesario para contar sus días: en la nómina, con fecha de ingreso, horario y su primer año cumplido. */
  sePuedenPedir(): boolean {
    const d = this.datos();
    return Boolean(d?.en_nomina && d.horario?.length && d.saldo && d.saldo.anios >= 1);
  }

  /** "1 día" / "3 días". */
  dias(n: number): string {
    return `${n} ${n === 1 ? 'día' : 'días'}`;
  }

  /** Con fechas válidas y sin pasarse de los días que le quedan (2026-10-20: el botón seguía encendido). */
  puedePedir(): boolean {
    const n = this.diasPedidos();
    const s = this.datos()?.saldo;
    return n !== null && n > 0 && this.desde >= this.hoy && (!s || n <= s.restan);
  }

  pedir(): void {
    if (!this.puedePedir() || this.guardando()) return;
    const n = this.diasPedidos()!;
    this.guardando.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    const fechas = `del ${corta(this.desde)} al ${corta(this.hasta)} (${n} ${n === 1 ? 'día' : 'días'})`;
    this.nomina.pedirVacaciones({ fecha_inicio: this.desde, fecha_fin: this.hasta, notas: this.notas.trim() || undefined }).subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.mensaje.set(r.pedidas
          ? `Se pidieron tus vacaciones ${fechas}. Cuando las autoricen te llega un WhatsApp.`
          : `Quedaron registradas tus vacaciones ${fechas}.`);
        this.desde = '';
        this.hasta = '';
        this.notas = '';
        this.cargar();
      },
      error: (e) => {
        this.guardando.set(false);
        this.error.set(this.msg(e));
      },
    });
  }

  retirar(p: VacacionPedida): void {
    this.guardando.set(true);
    this.autorizaciones.cancelar(p.id).subscribe({
      next: () => {
        this.guardando.set(false);
        this.mensaje.set(`Retiraste las vacaciones del ${corta(p.fecha_inicio)} al ${corta(p.fecha_fin)}.`);
        this.cargar();
      },
      error: (e) => {
        this.guardando.set(false);
        this.error.set(this.msg(e));
      },
    });
  }

  estado(p: VacacionPedida): { texto: string; tono: string } {
    return ESTADO[p.estado] ?? { texto: p.estado, tono: 'gris' };
  }

  cerrar(): void {
    this.cerrado.emit();
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
