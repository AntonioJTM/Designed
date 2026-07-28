import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  Conversion,
  InventarioService,
  PreviaDesarme,
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

  /**
   * Solo los dos que no cubre ningún otro flujo:
   *   · ajuste → cuadrar el sistema con un conteo físico
   *   · merma  → dar de baja mercancía dañada o perdida
   * 'entrada' la hace la remesa, 'devolucion' la cancelación del pedido, y
   * 'salida' se usaba para transferir, que ahora va por traspasos.
   */
  readonly tipos: TipoMovimiento[] = ['ajuste', 'merma'];

  // Formulario de ajuste / merma
  mov = {
    tipo: 'ajuste' as TipoMovimiento,
    almacen_id: '' as number | '',
    cantidad: null as number | null,
    motivo: '',
  };

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
    // Vacío = se usan los conos nominales del cono elegido.
    conos: null as number | null,
    codigo_bulto: '',
    motivo: '',
  };

  /** Código que se está escaneando para bajar ese bulto a mostrador. */
  codigoDesarme = '';
  /** Lo que trae el bulto escaneado, tal como lo resolvió el backend. */
  readonly previaBulto = signal<PreviaDesarme | null>(null);
  /** Almacén al que bajan los conos (el mostrador). */
  bajarA: number | '' = '';
  /**
   * Lo que GANA de peso el hilo al enconarse: el tubo de cada cono. Lo captura la
   * tienda porque depende del tubo que use; el sistema no lo adivina. Vacío = 0.
   */
  destare: number | null = null;
  readonly bajando = signal(false);

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
    const piezasNominal = Number(c.piezas_por_origen) * n;
    const piezas = this.desarme.conos != null ? Number(this.desarme.conos) : piezasNominal;
    return {
      kg,
      nominal,
      ajustado: kg !== nominal,
      piezas,
      piezasNominal,
      // Hay bultos que rinden menos conos que el nominal.
      piezasAjustadas: piezas !== piezasNominal,
      paqueteSku: c.paquete_sku,
      conoSku: c.sku,
    };
  });

  constructor() {
    this.inv.almacenes().subscribe({
      next: (a) => {
        this.almacenes.set(a);
        if (a[0]) this.mov.almacen_id = a[0].id;
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

  /**
   * Escanea el bulto y muestra qué trae: el paquete, sus kilos REALES y cuántos
   * conos rinde. No mueve nada todavía. El dato de los conos viene del bulto (la
   * lista de empaque lo trae), así que no hay que configurar la presentación de
   * cono antes: si no existe, se crea al confirmar.
   */
  escanearParaBajar(): void {
    const cod = this.codigoDesarme.trim();
    if (!cod) return;
    this.error.set(null);
    this.mensaje.set(null);
    this.inv.previaDesarme(cod).subscribe({
      next: (p) => {
        this.previaBulto.set(p);
        this.codigoDesarme = '';
        this.destare = null;
        // Origen: donde de verdad está la mercancía. Destino: un mostrador.
        if (p.existencias.length) this.desarme.origen = p.existencias[0].almacen_id;
        const mostrador = this.almacenes().find(
          (a) => a.es_punto_venta && a.id !== this.desarme.origen
        ) ?? this.almacenes().find((a) => a.es_punto_venta);
        this.bajarA = mostrador?.id ?? '';
      },
      error: (e) => {
        this.previaBulto.set(null);
        this.error.set(this.msg(e));
      },
    });
  }

  /** Peso que va a quedar enconado: el del bulto más el destare capturado. */
  pesoEnconado(): number | null {
    const p = this.previaBulto();
    if (!p) return null;
    const kg = Number(p.bulto.peso_kg);
    const d = this.destare != null ? Number(this.destare) : 0;
    return Math.round((kg + d) * 1000) / 1000;
  }

  olvidarBulto(): void {
    this.previaBulto.set(null);
    this.codigoDesarme = '';
  }

  /**
   * Baja el bulto a mostrador: descuenta sus kilos del paquete y da entrada a sus
   * conos. Va solo con el código; el backend resuelve el resto y crea la
   * presentación de cono si es la primera vez.
   */
  bajarAMostrador(): void {
    const p = this.previaBulto();
    if (!p) return;
    if (!this.desarme.origen || !this.bajarA) {
      this.error.set('Elige de qué bodega sale y a qué mostrador baja.');
      return;
    }
    this.bajando.set(true);
    this.error.set(null);
    this.inv
      .desarmar({
        codigo_bulto: p.bulto.codigo,
        almacen_origen_id: Number(this.desarme.origen),
        almacen_destino_id: Number(this.bajarA),
        destare_kg: this.destare != null && this.destare > 0 ? Number(this.destare) : undefined,
        motivo: this.desarme.motivo.trim() || undefined,
      })
      .subscribe({
        next: (r) => {
          this.ultimoDesarme.set(r);
          this.mensaje.set(
            `Bulto ${p.bulto.codigo} bajado: −${r.kg_consumidos} kg de ${r.paquete.sku}, ` +
            `+${r.kg_enconados ?? r.kg_consumidos} kg de ${r.cono.sku} ` +
            `(${r.piezas_generadas} conos)` +
            (r.destare_kg ? ` · incluye ${r.destare_kg} kg de destare.` : '.')
          );
          this.previaBulto.set(null);
          this.destare = null;
          this.desarme.motivo = '';
          this.bajando.set(false);
          this.cargarStock();
          this.cargarAlertas();
          this.cargarConos();
          this.cargarConversiones();
          this.cargarResumen();
        },
        error: (e) => {
          this.error.set(this.msg(e));
          this.bajando.set(false);
        },
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
        conos: this.desarme.conos != null ? Number(this.desarme.conos) : undefined,
        codigo_bulto: this.desarme.codigo_bulto.trim() || undefined,
        motivo: this.desarme.motivo.trim() || undefined,
      })
      .subscribe({
        next: (r) => {
          this.ultimoDesarme.set(r);
          this.mensaje.set(
            `Se desarmaron ${r.paquetes} paquete(s): −${r.kg_consumidos} kg de ${r.paquete.sku}, ` +
            `+${r.kg_enconados ?? r.kg_consumidos} kg de ${r.cono.sku} (${r.piezas_generadas} conos).`
          );
          this.desarme.motivo = '';
          this.desarme.kg = null;
          this.desarme.conos = null;
          this.desarme.codigo_bulto = '';
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

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
