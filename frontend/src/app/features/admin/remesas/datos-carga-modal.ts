import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatosCarga, InventarioService, Remesa } from '../../../core/services/inventario.service';
import { AuthService } from '../../../core/services/auth.service';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { DatosCargaCampos } from './datos-carga';

/**
 * Completar o corregir los datos de una carga YA hecha: proveedor, factura,
 * pedimento, contenedor, fecha de ingreso y —administración y contabilidad— el
 * costo por kilo. Es lo normal que la factura o el costo lleguen días después
 * de la mercancía (decisión del usuario, 2026-10-06).
 *
 * Si la carga salió de una lista con varios colores, se puede aplicar todo
 * (menos el costo, que es de cada hilo) a las demás cargas de esa lista.
 * Corregir el costo rehace el costo promedio del hilo en el servidor.
 *
 * La carga entra por input. No cierra al tocar el fondo: ✕, "Cancelar" o Escape.
 */
@Component({
  selector: 'app-datos-carga-modal',
  imports: [FormsModule, CantidadPipe, DatosCargaCampos],
  templateUrl: './datos-carga-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class DatosCargaModal implements OnInit {
  private readonly inv = inject(InventarioService);
  private readonly auth = inject(AuthService);

  readonly carga = input.required<Remesa>();
  readonly cerrado = output<void>();
  readonly guardado = output<Remesa>();

  readonly veCostos = computed(() => this.auth.puede('hacer:ver_costos'));
  readonly datos = signal<DatosCarga>({
    proveedor_id: null, factura: '', pedimento: '', contenedor: '', fecha_ingreso: '', costo_kg: null,
  });
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  todaLaLista = false;

  /** El input se lee aquí, no en el constructor: ahí todavía no está puesto. */
  ngOnInit(): void {
    const c = this.carga();
    this.datos.set({
      proveedor_id: c.proveedor_id ?? null,
      factura: c.factura ?? '',
      pedimento: c.pedimento ?? '',
      contenedor: c.contenedor ?? '',
      fecha_ingreso: c.fecha_ingreso ?? '',
      costo_kg: c.costo_kg != null ? Number(c.costo_kg) : null,
    });
    // Corregir los papeles de una lista es casi siempre para todas sus cargas.
    this.todaLaLista = (c.cargas_en_lista ?? 0) > 1;
  }

  enLista(): number {
    return Number(this.carga().cargas_en_lista ?? 0);
  }

  guardar(): void {
    const d = this.datos();
    const texto = (v: string) => (v ?? '').trim() || null;
    this.guardando.set(true);
    this.error.set(null);
    this.inv
      .editarDatosCarga(this.carga().id, {
        proveedor_id: d.proveedor_id ?? null,
        factura: texto(d.factura),
        pedimento: texto(d.pedimento),
        contenedor: texto(d.contenedor),
        fecha_ingreso: texto(d.fecha_ingreso),
        // El costo solo viaja si quien guarda lo ve; vacío = "no se sabe".
        ...(this.veCostos() ? { costo_kg: d.costo_kg != null && String(d.costo_kg) !== '' ? Number(d.costo_kg) : null } : {}),
        toda_la_lista: this.enLista() > 1 && this.todaLaLista,
      })
      .subscribe({
        next: (r) => {
          this.guardando.set(false);
          this.guardado.emit(r);
        },
        error: (e) => {
          this.guardando.set(false);
          this.error.set((e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'No se pudo guardar.');
        },
      });
  }

  cerrar(): void {
    if (!this.guardando()) this.cerrado.emit();
  }
}
