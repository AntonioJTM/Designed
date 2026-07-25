import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  Conversion,
  InventarioService,
  ResultadoDesarme,
  ResumenAlmacenes,
  ResumenFila,
} from '../../../core/services/inventario.service';
import { Almacen, StockItem, TipoMovimiento } from '../../../core/models/inventario.models';
import { Variante } from '../../../core/models/catalogo.models';
import { FechaPipe } from '../../../shared/fecha.pipe';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';

@Component({
  selector: 'app-inventario',
  imports: [FormsModule, RouterLink, CantidadPipe, FechaPipe],
  templateUrl: './inventario.html',
})
export class Inventario {
  private readonly inv = inject(InventarioService);

  readonly almacenes = signal<Almacen[]>([]);
  /** Panorama de existencias por almacén (totales + matriz). */
  readonly resumen = signal<ResumenAlmacenes | null>(null);
  readonly soloConStock = signal(true);
  readonly stock = signal<StockItem[]>([]);
  readonly totalAlertas = signal(0);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  // Filtros de la tabla de existencias
  filtroAlmacen: number | '' = '';
  filtroQ = '';
  soloBajo = false;

  // Selector de variante compartido por los formularios
  qVar = '';
  resultadosVar = signal<Variante[]>([]);
  varianteSel: number | '' = '';

  readonly tipos: TipoMovimiento[] = ['entrada', 'salida', 'ajuste', 'devolucion', 'merma'];

  // Formulario de movimiento
  mov = { tipo: 'entrada' as TipoMovimiento, almacen_id: '' as number | '', cantidad: null as number | null, costo_unitario: null as number | null, motivo: '' };

  // Formulario de transferencia
  transf = { origen: '' as number | '', destino: '' as number | '', cantidad: null as number | null, motivo: '' };

  // Desarme de paquetes en conos
  readonly conos = signal<Variante[]>([]);
  readonly conversiones = signal<Conversion[]>([]);
  readonly ultimoDesarme = signal<ResultadoDesarme | null>(null);
  desarme = {
    cono_id: '' as number | '',
    origen: '' as number | '',
    destino: '' as number | '',
    paquetes: 1 as number | null,
    // Vacío = se usa el peso nominal del paquete.
    kg: null as number | null,
    motivo: '',
  };

  readonly esAjuste = computed(() => this.mov.tipo === 'ajuste');

  /** Cono elegido para desarmar, con los datos de su paquete de origen. */
  readonly conoSel = computed(() =>
    this.conos().find((c) => c.id === Number(this.desarme.cono_id)) ?? null
  );

  /** Lo que va a pasar al desarmar, calculado en vivo para confirmarlo antes. */
  readonly previaDesarme = computed(() => {
    const c = this.conoSel();
    const n = Number(this.desarme.paquetes);
    if (!c || !n || !c.paquete_peso_kg || !c.piezas_por_origen) return null;
    // Peso nominal según el paquete, y el real si se ajustó a mano.
    const nominal = Number(c.paquete_peso_kg) * n;
    const kg = this.desarme.kg != null ? Number(this.desarme.kg) : nominal;
    return {
      kg,
      nominal,
      ajustado: kg !== nominal,
      piezas: Number(c.piezas_por_origen) * n,
      paqueteSku: c.paquete_sku,
      conoSku: c.sku,
    };
  });

  constructor() {
    this.inv.almacenes().subscribe({
      next: (a) => {
        this.almacenes.set(a);
        if (a[0]) {
          this.mov.almacen_id = a[0].id;
          this.transf.origen = a[0].id;
          this.transf.destino = a[1]?.id ?? a[0].id;
        }
      },
      error: (e) => this.error.set(this.msg(e)),
    });
    this.cargarStock();
    this.cargarAlertas();
    this.cargarConos();
    this.cargarConversiones();
    this.cargarResumen();
  }

  cargarResumen(): void {
    this.inv.resumen().subscribe({
      next: (r) => this.resumen.set(r),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  /** Renglones del comparativo, opcionalmente solo los que tienen existencias. */
  filasResumen(): ResumenFila[] {
    const filas = this.resumen()?.filas ?? [];
    return this.soloConStock() ? filas.filter((f) => f.total > 0) : filas;
  }

  /** Existencia de una variante en un almacén concreto. */
  celda(f: ResumenFila, almacenId: number): { cantidad: string; bajo_minimo: boolean } | null {
    return f.existencias[String(almacenId)] ?? null;
  }

  /** Los DECIMAL llegan como string; en la plantilla se comparan como número. */
  num(v: string | number | null | undefined): number {
    return Number(v ?? 0);
  }

  /** Cuántos paquetes representan esos kilos, para leerlo como lo cuenta la tienda. */
  paquetesDe(kilos: string | number, pesoKg: string | number | null | undefined): string {
    const peso = Number(pesoKg ?? 0);
    if (!peso) return '';
    return (Math.round((Number(kilos) / peso) * 100) / 100).toString();
  }

  /** Etiqueta corta del papel que juega el almacén. */
  papel(a: { es_matriz: boolean | number; es_punto_venta: boolean | number; es_tienda_linea: boolean | number }): string {
    const partes: string[] = [];
    if (a.es_matriz) partes.push('matriz');
    partes.push(a.es_punto_venta ? 'tienda' : 'bodega');
    if (a.es_tienda_linea) partes.push('web');
    return partes.join(' · ');
  }

  /** Trae las presentaciones de tipo cono: son las que se pueden desarmar. */
  private cargarConos(): void {
    this.inv.buscarVariantes('').subscribe({
      next: (vs) => {
        const conos = vs.filter((v) => v.tipo_presentacion === 'cono');
        this.conos.set(conos);
        if (conos[0]) this.desarme.cono_id = conos[0].id;
      },
      error: () => {},
    });
  }

  private cargarConversiones(): void {
    this.inv.conversiones().subscribe({
      next: (p) => this.conversiones.set(p.items),
      error: () => {},
    });
  }

  desarmar(): void {
    const c = this.conoSel();
    if (!c || !this.desarme.origen || !this.desarme.destino || !this.desarme.paquetes) {
      this.error.set('Elige el cono, los almacenes y cuántos paquetes vas a desarmar.');
      return;
    }
    this.error.set(null);
    this.mensaje.set(null);
    this.inv
      .desarmar({
        cono_variante_id: c.id,
        almacen_origen_id: Number(this.desarme.origen),
        almacen_destino_id: Number(this.desarme.destino),
        paquetes: Number(this.desarme.paquetes),
        kg: this.desarme.kg != null ? Number(this.desarme.kg) : undefined,
        motivo: this.desarme.motivo.trim() || undefined,
      })
      .subscribe({
        next: (r) => {
          this.ultimoDesarme.set(r);
          this.mensaje.set(
            `Se desarmaron ${r.paquetes} paquete(s): −${r.kg_consumidos} kg de ${r.paquete.sku}, ` +
            `+${r.piezas_generadas} conos de ${r.cono.sku}.`
          );
          this.desarme.motivo = '';
          this.desarme.kg = null;
          this.cargarStock();
          this.cargarAlertas();
          this.cargarConversiones();
          this.cargarResumen();
        },
        error: (e) => this.error.set(this.msg(e)),
      });
  }

  cargarStock(): void {
    this.cargando.set(true);
    this.inv
      .stock({
        almacen_id: this.filtroAlmacen || undefined,
        q: this.filtroQ.trim() || undefined,
        bajo_stock: this.soloBajo || undefined,
      })
      .subscribe({
        next: (p) => {
          this.stock.set(p.items);
          this.cargando.set(false);
        },
        error: (e) => {
          this.error.set(this.msg(e));
          this.cargando.set(false);
        },
      });
  }

  cargarAlertas(): void {
    this.inv.alertas().subscribe({
      next: (a) => this.totalAlertas.set(a.length),
      error: () => {},
    });
  }

  buscarVariantes(): void {
    const q = this.qVar.trim();
    if (!q) return;
    this.error.set(null);
    this.inv.buscarVariantes(q).subscribe({
      next: (v) => {
        this.resultadosVar.set(v);
        if (v.length === 1) {
          // Coincidencia única (típico al escanear un código): se autoselecciona.
          this.varianteSel = v[0].id;
          this.mensaje.set(`Variante: ${v[0].sku} · ${v[0].producto}`);
        } else if (v.length === 0) {
          this.mensaje.set(null);
          this.error.set('No se encontró ninguna variante con ese código.');
        }
      },
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  registrarMovimiento(): void {
    this.error.set(null);
    this.mensaje.set(null);
    if (!this.varianteSel || !this.mov.almacen_id || this.mov.cantidad == null) {
      this.error.set('Elige variante, almacén y cantidad.');
      return;
    }
    this.inv
      .registrarMovimiento({
        variante_id: Number(this.varianteSel),
        almacen_id: Number(this.mov.almacen_id),
        tipo: this.mov.tipo,
        cantidad: this.mov.cantidad,
        costo_unitario: this.mov.costo_unitario,
        motivo: this.mov.motivo.trim() || undefined,
      })
      .subscribe({
        next: (r) => {
          this.mensaje.set(`Movimiento registrado. Saldo: ${r.saldo_anterior} → ${r.saldo_nuevo}.`);
          this.mov.cantidad = null;
          this.mov.motivo = '';
          this.cargarStock();
          this.cargarAlertas();
          this.cargarResumen();
        },
        error: (e) => this.error.set(this.msg(e)),
      });
  }

  transferir(): void {
    this.error.set(null);
    this.mensaje.set(null);
    if (!this.varianteSel || !this.transf.origen || !this.transf.destino || this.transf.cantidad == null) {
      this.error.set('Elige variante, almacenes origen/destino y cantidad.');
      return;
    }
    this.inv
      .transferir({
        variante_id: Number(this.varianteSel),
        almacen_origen_id: Number(this.transf.origen),
        almacen_destino_id: Number(this.transf.destino),
        cantidad: this.transf.cantidad,
        motivo: this.transf.motivo.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.mensaje.set('Transferencia realizada.');
          this.transf.cantidad = null;
          this.transf.motivo = '';
          this.cargarStock();
          this.cargarAlertas();
          this.cargarResumen();
        },
        error: (e) => this.error.set(this.msg(e)),
      });
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
