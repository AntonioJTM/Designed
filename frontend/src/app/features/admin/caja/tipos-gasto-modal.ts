import { Component, OnInit, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VentasService } from '../../../core/services/ventas.service';
import { TipoGasto } from '../../../core/models/ventas.models';
import { ApiError } from '../../../core/models/auth.models';

/** Un renglón que se edita: lo que dice la base y lo que se está tecleando. */
interface Fila {
  tipo: TipoGasto;
  nombre: string;
  limite: number | null;
  activo: boolean;
}

/**
 * TIPOS DE GASTO y su LÍMITE POR GASTO (2026-10-20): Viajes, Limpieza,
 * Papelería… Un gasto arriba del límite de su tipo pide autorización; sin
 * límite, nunca. Se desactiva en vez de borrar (los gastos de antes lo nombran).
 * No se cierra al guardar: se capturan varios seguidos.
 */
@Component({
  selector: 'app-tipos-gasto-modal',
  imports: [FormsModule],
  host: { '(document:keydown.escape)': 'cerrar()' },
  styles: `
    .tipos { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .tipo {
      display: grid; grid-template-columns: minmax(0, 1fr) 9rem auto auto; align-items: end; gap: 10px;
      padding: 10px 12px; border: 1px solid var(--borde); border-radius: 8px;
    }
    .tipo.inactivo { background: var(--superficie-2); }
    .tipo .field.check { min-height: 40px; margin: 0; }
    .nuevo { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--borde); }
    h3 { margin: 0 0 8px; font-size: 0.9375rem; font-weight: 600; }
    @media (max-width: 560px) { .tipo { grid-template-columns: 1fr 1fr; } }
  `,
  template: `
    <div class="modal-overlay">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="tipos-gasto-titulo">
        <div class="modal-head">
          <h2 id="tipos-gasto-titulo">Tipos de gasto</h2>
          <button type="button" class="modal-cerrar" (click)="cerrar()" aria-label="Cerrar">✕</button>
        </div>
        <div class="modal-body">
          <p class="muted" style="margin-top: 0; font-size: 0.875rem">
            El <b>límite es por gasto</b>: un gasto que lo pasa pide autorización (el dinero no sale hasta que la
            acepten). <b>Vacío, todo gasto de ese tipo se autoriza</b>; quien autoriza los registra directo.
          </p>
          @if (error()) { <p class="alert" role="alert">{{ error() }}</p> }
          @if (mensaje()) { <p class="ok-msg" role="status">{{ mensaje() }}</p> }

          @if (filas().length) {
            <ul class="tipos">
              @for (f of filas(); track f.tipo.id) {
                <li class="tipo" [class.inactivo]="!f.tipo.activo">
                  <label class="field">
                    Nombre
                    <input type="text" maxlength="60" [(ngModel)]="f.nombre" [name]="'nombre-' + f.tipo.id" />
                  </label>
                  <label class="field">
                    Límite por gasto
                    <span class="campo-moneda">
                      <span>$</span>
                      <input type="number" min="0" step="0.01" [(ngModel)]="f.limite" [name]="'limite-' + f.tipo.id"
                             placeholder="Todo se autoriza" />
                    </span>
                  </label>
                  <label class="field check">
                    <input type="checkbox" [(ngModel)]="f.activo" [name]="'activo-' + f.tipo.id" />
                    Activo
                  </label>
                  <button type="button" class="btn btn-ghost btn-sm" (click)="guardar(f)"
                          [disabled]="guardando() || !cambio(f)">Guardar</button>
                </li>
              }
            </ul>
          } @else {
            <p class="muted">Todavía no hay tipos de gasto.</p>
          }

          <form class="nuevo" (ngSubmit)="agregar()">
            <h3>Nuevo tipo</h3>
            <div class="tipo" style="border: 0; padding: 0">
              <label class="field">
                Nombre
                <input type="text" maxlength="60" [(ngModel)]="nombreNuevo" name="nombre-nuevo" placeholder="Ej. Mantenimiento" />
              </label>
              <label class="field">
                Límite por gasto
                <span class="campo-moneda">
                  <span>$</span>
                  <input type="number" min="0" step="0.01" [(ngModel)]="limiteNuevo" name="limite-nuevo" placeholder="Todo se autoriza" />
                </span>
              </label>
              <span></span>
              <button type="submit" class="btn btn-primary btn-sm" [disabled]="guardando() || nombreNuevo.trim().length < 2">
                Agregar
              </button>
            </div>
          </form>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" (click)="cerrar()">Cerrar</button>
        </div>
      </div>
    </div>
  `,
})
export class TiposGastoModal implements OnInit {
  private readonly ventas = inject(VentasService);

  /** true si cambió algo: la lista de gastos se recarga. */
  readonly cerrado = output<boolean>();

  readonly filas = signal<Fila[]>([]);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  private cambiado = false;

  nombreNuevo = '';
  limiteNuevo: number | null = null;

  ngOnInit(): void {
    this.cargar();
  }

  private cargar(): void {
    this.ventas.tiposGasto(true).subscribe({
      next: (t) => this.filas.set(t.map((tipo) => ({ tipo, nombre: tipo.nombre, limite: tipo.limite, activo: tipo.activo }))),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  /** Un límite vacío o en 0 es "sin límite". */
  private limiteDe(v: number | null | string): number | null {
    const n = Number(v);
    return v === null || v === '' || !(n > 0) ? null : Math.round(n * 100) / 100;
  }

  /** Método: lee campos de ngModel. */
  cambio(f: Fila): boolean {
    return f.nombre.trim() !== f.tipo.nombre || this.limiteDe(f.limite) !== f.tipo.limite || f.activo !== f.tipo.activo;
  }

  guardar(f: Fila): void {
    if (f.nombre.trim().length < 2) {
      this.error.set('El nombre lleva al menos 2 letras.');
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    this.ventas
      .actualizarTipoGasto(f.tipo.id, { nombre: f.nombre.trim(), limite: this.limiteDe(f.limite), activo: f.activo })
      .subscribe({
        next: (t) => {
          this.guardando.set(false);
          this.cambiado = true;
          this.mensaje.set(`«${t.nombre}» guardado: ${t.limite != null ? 'hasta ' + this.dinero(t.limite) + ' por gasto' : 'sin límite, todo se autoriza'}${t.activo ? '' : ', desactivado'}.`);
          this.cargar();
        },
        error: (e) => {
          this.guardando.set(false);
          this.error.set(this.msg(e));
        },
      });
  }

  agregar(): void {
    const nombre = this.nombreNuevo.trim();
    if (nombre.length < 2) return;
    this.guardando.set(true);
    this.error.set(null);
    this.ventas.crearTipoGasto({ nombre, limite: this.limiteDe(this.limiteNuevo) }).subscribe({
      next: (t) => {
        this.guardando.set(false);
        this.cambiado = true;
        this.nombreNuevo = '';
        this.limiteNuevo = null;
        this.mensaje.set(`Se agregó «${t.nombre}» (${t.limite != null ? 'hasta ' + this.dinero(t.limite) + ' por gasto' : 'sin límite: todo se autoriza'}).`);
        this.cargar();
      },
      error: (e) => {
        this.guardando.set(false);
        this.error.set(this.msg(e));
      },
    });
  }

  cerrar(): void {
    this.cerrado.emit(this.cambiado);
  }

  dinero(v: unknown): string {
    return Number(v ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
