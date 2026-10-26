import { Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { RotacionService } from '../../../core/services/rotacion.service';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';
import { PreviaAnteriores, ResumenAnteriores } from '../../../core/models/rotacion.models';
import { ApiError } from '../../../core/models/auth.models';
import { MESES, cap, kilos, mesAnio } from './rotacion-ui';

const MUESTRA = 100;

/**
 * CARGAR VENTAS DE AÑOS ANTERIORES (Rotación, parte 2): para no esperar un año a
 * ver la temporada. Un Excel con Hilo, Calibre, Año, Mes, Kilos y Tienda
 * (opcional); primero la vista previa con lo que no se entiende, después se
 * carga. Un mes que ya estaba se reemplaza, y en los meses en que el sistema ya
 * tiene ventas de ese hilo, mandan las del sistema (no se cuentan dos veces).
 */
@Component({
  selector: 'app-ventas-anteriores-modal',
  host: { '(document:keydown.escape)': 'cerrado.emit()' },
  template: `
    <!-- No se cierra al hacer clic en el fondo; sale con la ✕, "Cerrar" o Escape. -->
    <div class="modal-overlay">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="titulo-anteriores">
        <div class="modal-head">
          <h2 id="titulo-anteriores">Cargar ventas de años anteriores</h2>
          <button type="button" class="modal-cerrar" (click)="cerrado.emit()" aria-label="Cerrar">✕</button>
        </div>
        <div class="modal-body columna">
          <p class="muted">
            Para ver la temporada sin esperar un año. Un Excel con un renglón por hilo y mes, en kilos, con estas columnas:
          </p>
          <ul class="columnas-xlsx">
            <li><b>Hilo</b> el color, como está en el catálogo</li>
            <li><b>Calibre</b> 1/30, 2/30…</li>
            <li><b>Año</b> 2025</li>
            <li><b>Mes</b> el número o el nombre</li>
            <li><b>Kilos</b> lo que se vendió ese mes</li>
            <li><b>Tienda</b> <span class="muted">(opcional; vacía = las dos)</span></li>
          </ul>
          <p class="muted chico">
            Un mes que ya estaba cargado se reemplaza. En los meses en que el sistema ya tiene ventas de ese hilo, mandan las del sistema.
          </p>

          @if (resumen(); as r) {
            @if (r.renglones) {
              <div class="ya-cargado">
                <span>Ya hay cargados <b>{{ r.renglones.toLocaleString('es-MX') }} {{ r.renglones === 1 ? 'renglón' : 'renglones' }}</b>:
                  {{ kilos(r.kg) }} de {{ r.hilos }} {{ r.hilos === 1 ? 'hilo' : 'hilos' }}, de {{ mesAnio(r.desde) }} a {{ mesAnio(r.hasta) }}.</span>
                <button type="button" class="btn btn-ghost peligro" [disabled]="trabajando()" (click)="borrar()">Borrar lo cargado</button>
              </div>
            }
          }

          @if (error()) { <p class="alert" role="alert">{{ error() }}</p> }
          @if (listo()) { <p class="ok-msg" role="status">{{ listo() }}</p> }

          <div class="elegir">
            <label class="btn btn-ghost" for="archivo-anteriores" [class.apagado]="trabajando()">
              {{ archivo() ? 'Elegir otro archivo' : 'Elegir el archivo (.xlsx)' }}
            </label>
            <input id="archivo-anteriores" class="oculto" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                   [disabled]="trabajando()" (change)="elegir($event)" />
            @if (archivo(); as a) { <span class="muted nombre-archivo">{{ a.name }}</span> }
            @if (revisando()) { <span class="muted">Revisando…</span> }
          </div>

          @if (previa(); as p) {
            <div class="resumen-previa" [class.con-errores]="p.errores > 0">
              @if (p.errores) {
                <b>{{ p.errores }} {{ p.errores === 1 ? 'renglón no se entiende' : 'renglones no se entienden' }}.</b>
                Corrígelos en el Excel y súbelo otra vez; no se carga nada mientras haya alguno.
              } @else if (p.validos) {
                <b>{{ p.validos.toLocaleString('es-MX') }} {{ p.validos === 1 ? 'renglón' : 'renglones' }} listos:</b>
                {{ kilos(p.kg) }} de {{ p.hilos }} {{ p.hilos === 1 ? 'hilo' : 'hilos' }}, de {{ mesAnio(p.desde) }} a {{ mesAnio(p.hasta) }}.
              } @else {
                <b>El archivo no trae ningún renglón para cargar.</b>
              }
            </div>
            @if (p.renglones.length) {
              <div class="tabla-scroll">
                <table class="grid previa">
                  <thead>
                    <tr><th scope="col" class="num">Renglón</th><th scope="col">Hilo</th><th scope="col">Mes</th><th scope="col" class="num">Kilos</th><th scope="col">Tienda</th><th scope="col">Qué pasa</th></tr>
                  </thead>
                  <tbody>
                    @for (r of muestra(); track r.fila) {
                      <tr [class.fila-error]="r.estado === 'error'" [class.fila-aviso]="r.estado === 'aviso'">
                        <td class="num">{{ r.fila }}</td>
                        <th scope="row">{{ r.hilo ?? r.hilo_excel }}</th>
                        <td>{{ r.mes && r.anio ? cap(MESES[r.mes - 1]) + ' ' + r.anio : '—' }}</td>
                        <td class="num">{{ r.kg != null ? kilos(r.kg, 1) : '—' }}</td>
                        <td>{{ r.tienda }}</td>
                        <td>
                          @if (r.mensajes.length) { {{ r.mensajes.join(' · ') }} }
                          @else { <span class="muted">Bien</span> }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              @if (p.renglones.length > muestra().length) {
                <p class="muted chico">Y {{ (p.renglones.length - muestra().length).toLocaleString('es-MX') }} renglones más, todos bien.</p>
              }
            }
          }
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" (click)="cerrado.emit()">Cerrar</button>
          <button type="button" class="btn btn-primary" [disabled]="!previa()?.se_puede || trabajando()" (click)="cargar()">
            {{ cargando() ? 'Cargando…' : previa()?.se_puede ? 'Cargar ' + previa()!.validos.toLocaleString('es-MX') + ' ' + (previa()!.validos === 1 ? 'renglón' : 'renglones') : 'Cargar' }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: `
    .modal { max-width: 820px; }
    .columnas-xlsx { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: 4px 16px; font-size: 0.875rem; color: var(--tinta-2); }
    .columnas-xlsx b { color: var(--tinta); margin-right: 6px; }
    .chico { font-size: 0.8125rem; }
    .ya-cargado { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; padding: 12px 14px; border-radius: 8px; background: var(--superficie-2); font-size: 0.875rem; }
    .peligro { color: var(--peligro-t); }
    .elegir { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; }
    .elegir .apagado { opacity: 0.55; pointer-events: none; }
    .nombre-archivo { font-family: var(--mono); font-size: 0.8125rem; overflow-wrap: anywhere; }
    .resumen-previa { padding: 12px 14px; border-radius: 8px; background: var(--ok-f); color: var(--ok-t); font-size: 0.875rem; }
    .resumen-previa.con-errores { background: var(--peligro-f); color: var(--peligro-t); }
    table.grid.previa { min-width: 640px; }
    tr.fila-error td, tr.fila-error th { color: var(--peligro-t); background: var(--peligro-f); }
    tr.fila-aviso td, tr.fila-aviso th { background: var(--aviso-f); }
  `,
})
export class VentasAnterioresModal implements OnInit {
  private readonly api = inject(RotacionService);
  private readonly confirmar = inject(ConfirmacionService);

  readonly cerrado = output<void>();
  /** Se cargó o se borró algo: la pantalla se recalcula. */
  readonly cargado = output<void>();

  readonly kilos = kilos;
  readonly mesAnio = mesAnio;
  readonly cap = cap;
  readonly MESES = MESES;

  readonly resumen = signal<ResumenAnteriores | null>(null);
  readonly archivo = signal<File | null>(null);
  readonly previa = signal<PreviaAnteriores | null>(null);
  readonly revisando = signal(false);
  readonly cargando = signal(false);
  readonly borrando = signal(false);
  readonly error = signal<string | null>(null);
  readonly listo = signal<string | null>(null);

  readonly trabajando = computed(() => this.revisando() || this.cargando() || this.borrando());

  /** Primero lo que no se entiende, luego los avisos; de los buenos, los primeros. */
  readonly muestra = computed(() => {
    const p = this.previa();
    if (!p) return [];
    const orden = { error: 0, aviso: 1, ok: 2 } as const;
    const malos = p.renglones.filter((r) => r.estado !== 'ok').sort((a, b) => orden[a.estado] - orden[b.estado] || a.fila - b.fila);
    const buenos = p.renglones.filter((r) => r.estado === 'ok');
    return [...malos, ...buenos.slice(0, Math.max(0, MUESTRA - malos.length))];
  });

  ngOnInit(): void {
    this.leerResumen();
  }

  private leerResumen(): void {
    this.api.anteriores().subscribe({ next: (r) => this.resumen.set(r), error: () => this.resumen.set(null) });
  }

  elegir(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    input.value = '';
    if (!f) return;
    this.archivo.set(f);
    this.previa.set(null);
    this.error.set(null);
    this.listo.set(null);
    this.revisando.set(true);
    this.api.previaAnteriores(f).subscribe({
      next: (p) => { this.previa.set(p); this.revisando.set(false); },
      error: (e) => { this.revisando.set(false); this.error.set(this.msg(e)); },
    });
  }

  cargar(): void {
    const f = this.archivo();
    if (!f || !this.previa()?.se_puede || this.trabajando()) return;
    this.cargando.set(true);
    this.error.set(null);
    this.api.cargarAnteriores(f).subscribe({
      next: (r) => {
        this.cargando.set(false);
        this.previa.set(null);
        this.archivo.set(null);
        this.listo.set(`Listo: se cargaron ${r.cargados.toLocaleString('es-MX')} ${r.cargados === 1 ? 'renglón' : 'renglones'}, ${kilos(r.kg)} de ${r.hilos} ${r.hilos === 1 ? 'hilo' : 'hilos'}. La pantalla ya los cuenta.`);
        this.leerResumen();
        this.cargado.emit();
      },
      error: (e) => { this.cargando.set(false); this.error.set(this.msg(e)); },
    });
  }

  async borrar(): Promise<void> {
    const r = this.resumen();
    if (!r?.renglones || this.trabajando()) return;
    const ok = await this.confirmar.pedir({
      titulo: 'Borrar las ventas de años anteriores',
      mensaje: `Se borran los ${r.renglones.toLocaleString('es-MX')} renglones cargados (${kilos(r.kg)}). Las ventas del sistema no se tocan. Si fue un archivo equivocado, después se puede subir el bueno.`,
      aceptar: 'Borrar lo cargado',
      peligro: true,
    });
    if (!ok) return;
    this.borrando.set(true);
    this.error.set(null);
    this.api.borrarAnteriores().subscribe({
      next: (x) => {
        this.borrando.set(false);
        this.listo.set(`Se borraron ${x.borrados.toLocaleString('es-MX')} ${x.borrados === 1 ? 'renglón' : 'renglones'}.`);
        this.leerResumen();
        this.cargado.emit();
      },
      error: (e) => { this.borrando.set(false); this.error.set(this.msg(e)); },
    });
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error. Intenta de nuevo.';
  }
}
