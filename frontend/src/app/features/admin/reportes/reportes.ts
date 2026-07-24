import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ReportesService } from '../../../core/services/reportes.service';
import {
  CorteCaja,
  MasVendido,
  PorReabastecer,
  ReporteVentas,
} from '../../../core/models/reportes.models';
import { ApiError } from '../../../core/models/auth.models';
import { Barra, VerticalBars } from './charts/vertical-bars';
import { HorizontalBars } from './charts/horizontal-bars';

@Component({
  selector: 'app-reportes',
  imports: [FormsModule, VerticalBars, HorizontalBars],
  templateUrl: './reportes.html',
})
export class Reportes {
  private readonly rep = inject(ReportesService);

  readonly ventas = signal<ReporteVentas | null>(null);
  readonly masVendidos = signal<MasVendido[]>([]);
  readonly porReabastecer = signal<PorReabastecer[]>([]);
  readonly cortes = signal<CorteCaja[]>([]);
  readonly error = signal<string | null>(null);

  // Rango de fechas (vacío = hoy, resuelto por el backend).
  desde = '';
  hasta = '';

  // ---- Datos para las gráficas ----

  /** Ventas por día (barras verticales, en $). Etiqueta corta MM-DD. */
  readonly chartPorDia = computed<Barra[]>(() =>
    (this.ventas()?.porDia ?? []).map((d) => ({
      label: String(d.dia).slice(5), // "07-24"
      value: Number(d.total),
    }))
  );

  /** Ventas por canal (2 categorías, colores fijos de la paleta). */
  readonly chartPorCanal = computed<Barra[]>(() =>
    (this.ventas()?.porCanal ?? []).map((c) => ({
      label: c.canal === 'punto_venta' ? 'Punto de venta' : 'Tienda en línea',
      value: Number(c.total),
      color: c.canal === 'punto_venta' ? 'var(--viz-series-1)' : 'var(--viz-series-2)',
    }))
  );

  /** Top más vendidos por unidades (barras horizontales, etiqueta = SKU). */
  readonly chartMasVendidos = computed<Barra[]>(() =>
    this.masVendidos()
      .slice(0, 8)
      .map((m) => ({ label: m.sku, value: Number(m.unidades_vendidas), title: m.producto }))
  );

  constructor() {
    this.cargar();
    this.rep.masVendidos(10).subscribe({ next: (m) => this.masVendidos.set(m), error: (e) => this.err(e) });
    this.rep.porReabastecer().subscribe({ next: (p) => this.porReabastecer.set(p), error: (e) => this.err(e) });
  }

  cargar(): void {
    this.error.set(null);
    const d = this.desde || undefined;
    const h = this.hasta || undefined;
    this.rep.ventas(d, h).subscribe({ next: (v) => this.ventas.set(v), error: (e) => this.err(e) });
    this.rep.cortesCaja(d, h).subscribe({ next: (c) => this.cortes.set(c.cortes), error: (e) => this.err(e) });
  }

  private err(e: unknown): void {
    this.error.set((e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Error al cargar reportes');
  }
}
