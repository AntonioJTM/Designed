import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Conversion, InventarioService, PreviaDesarme } from '../../../core/services/inventario.service';
import { Almacen } from '../../../core/models/inventario.models';
import { Variante } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';

/**
 * BAJAR CONOS A MOSTRADOR, en un modal. El flujo es el mismo de antes —escanear
 * el paquete, ver qué trae, confirmar— pero ya no vive desplegado en la pantalla
 * de Inventario, que tenía siete bloques apilados.
 *
 * Sigue viviendo en Inventario y NO en el catálogo ni en el POS: decisión del
 * usuario. La acción la hace el mostrador, pero desde esta pantalla.
 *
 * No pide nada al abrir: los almacenes, los conos y las bajadas recientes entran
 * por input, ya cargados por el listado, así que abre armado y de un tamaño.
 */
@Component({
  selector: 'app-desarme-modal',
  imports: [FormsModule, CantidadPipe, FechaPipe],
  templateUrl: './desarme-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class DesarmeModal implements OnInit {
  private readonly inv = inject(InventarioService);

  readonly almacenes = input<Almacen[]>([]);
  /** Presentaciones de tipo cono: las que se pueden producir a mano. */
  readonly conos = input<Variante[]>([]);
  /** Últimas bajadas, para contestar "¿ya lo bajé?" sin salir del modal. */
  readonly conversiones = input<Conversion[]>([]);

  readonly cerrado = output<void>();
  /** Se bajó un paquete: el listado recarga existencias, panorama y alertas. */
  readonly hecho = output<void>();

  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  readonly bajando = signal(false);

  /** Código que se está escaneando. */
  codigo = '';
  /** Lo que trae el bulto escaneado, tal como lo resolvió el backend. */
  readonly previaBulto = signal<PreviaDesarme | null>(null);
  /** Almacén al que bajan los conos (el mostrador). */
  bajarA: number | '' = '';
  origen: number | '' = '';
  /**
   * Lo que GANA de peso el hilo al enconarse: el tubo de cada cono. Lo captura la
   * tienda porque depende del tubo que use; el sistema no lo adivina. Vacío = 0.
   */
  destare: number | null = null;
  motivo = '';

  /** Captura a mano, cuando no hay lector o el bulto no tiene código. */
  manual = {
    cono_id: '' as number | '',
    origen: '' as number | '',
    destino: '' as number | '',
    paquetes: 1 as number | null,
    kg: null as number | null,
    conos: null as number | null,
  };

  /** Solo las últimas: el histórico completo está en el Kardex. */
  readonly ultimas = computed(() => this.conversiones().slice(0, 5));

  /** Cono elegido para desarmar a mano, con los datos de su paquete de origen. */
  conoSel(): Variante | null {
    return this.conos().find((c) => c.id === Number(this.manual.cono_id)) ?? null;
  }

  /**
   * Lo que va a pasar al desarmar a mano, para confirmarlo antes.
   *
   * Es un MÉTODO y no un `computed`: los campos del formulario son propiedades
   * normales de `ngModel`, no señales, así que un `computed` se calculaba una vez
   * y se quedaba pegado —teclear otros kilos no movía la vista previa—. Venía así
   * del código anterior, donde el error no se veía porque esta parte vive dentro
   * de un `<details>` cerrado.
   */
  previaManual(): {
    kg: number;
    nominal: number;
    ajustado: boolean;
    piezas: number;
    piezasNominal: number;
    piezasAjustadas: boolean;
    paqueteSku?: string | null;
    conoSku: string;
  } | null {
    const c = this.conoSel();
    const n = Number(this.manual.paquetes);
    if (!c || !n || !c.paquete_peso_kg || !c.piezas_por_origen) return null;
    // Peso nominal según el paquete, y el real si se ajustó a mano.
    const nominal = Number(c.paquete_peso_kg) * n;
    const kg = this.manual.kg != null ? Number(this.manual.kg) : nominal;
    const piezasNominal = Number(c.piezas_por_origen) * n;
    const piezas = this.manual.conos != null ? Number(this.manual.conos) : piezasNominal;
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
  }

  /** Los inputs se leen aquí, no en el constructor: ahí todavía no están puestos. */
  ngOnInit(): void {
    const primerCono = this.conos()[0];
    if (primerCono) this.manual.cono_id = primerCono.id;
    const bodega = this.almacenes().find((a) => !a.es_punto_venta) ?? this.almacenes()[0];
    if (bodega) this.manual.origen = bodega.id;
    const mostrador = this.almacenes().find((a) => a.es_punto_venta);
    if (mostrador) this.manual.destino = mostrador.id;
  }

  /**
   * Escanea el bulto y muestra qué trae: el paquete, sus kilos REALES y cuántos
   * conos rinde. No mueve nada todavía. El dato de los conos viene del bulto (la
   * lista de empaque lo trae), así que no hay que configurar la presentación de
   * cono antes: si no existe, se crea al confirmar.
   */
  escanear(): void {
    const cod = this.codigo.trim();
    if (!cod) return;
    this.error.set(null);
    this.mensaje.set(null);
    this.inv.previaDesarme(cod).subscribe({
      next: (p) => {
        this.previaBulto.set(p);
        this.codigo = '';
        this.destare = null;
        // Origen: donde de verdad está la mercancía. Destino: un mostrador.
        this.origen = p.existencias.length ? p.existencias[0].almacen_id : '';
        const mostrador =
          this.almacenes().find((a) => a.es_punto_venta && a.id !== this.origen) ??
          this.almacenes().find((a) => a.es_punto_venta);
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
    this.codigo = '';
  }

  /**
   * Baja el bulto a mostrador: descuenta sus kilos del paquete y da entrada a sus
   * conos. Va solo con el código; el backend resuelve el resto y crea la
   * presentación de cono si es la primera vez.
   */
  bajar(): void {
    const p = this.previaBulto();
    if (!p) return;
    if (!this.origen || !this.bajarA) {
      this.error.set('Elige de qué bodega sale y a qué mostrador baja.');
      return;
    }
    this.bajando.set(true);
    this.error.set(null);
    this.inv
      .desarmar({
        codigo_bulto: p.bulto.codigo,
        almacen_origen_id: Number(this.origen),
        almacen_destino_id: Number(this.bajarA),
        destare_kg: this.destare != null && this.destare > 0 ? Number(this.destare) : undefined,
        motivo: this.motivo.trim() || undefined,
      })
      .subscribe({
        next: (r) => {
          this.mensaje.set(
            `Bulto ${p.bulto.codigo} bajado: −${r.kg_consumidos} kg de ${r.paquete.sku}, ` +
              `+${r.kg_enconados ?? r.kg_consumidos} kg de ${r.cono.sku} ` +
              `(${r.piezas_generadas} conos)` +
              (r.destare_kg ? ` · incluye ${r.destare_kg} kg de destare.` : '.')
          );
          this.previaBulto.set(null);
          this.destare = null;
          this.motivo = '';
          this.bajando.set(false);
          // El modal NO se cierra: bajar varios paquetes seguidos es lo normal.
          this.hecho.emit();
        },
        error: (e) => {
          this.error.set(this.msg(e));
          this.bajando.set(false);
        },
      });
  }

  /** Desarme capturado a mano, sin escanear: usa los nominales del cono. */
  desarmarManual(): void {
    const c = this.conoSel();
    if (!c || !this.manual.origen || !this.manual.destino || !this.manual.paquetes) {
      this.error.set('Elige el cono, los almacenes y cuántos paquetes vas a desarmar.');
      return;
    }
    this.error.set(null);
    this.mensaje.set(null);
    this.bajando.set(true);
    this.inv
      .desarmar({
        cono_variante_id: c.id,
        almacen_origen_id: Number(this.manual.origen),
        almacen_destino_id: Number(this.manual.destino),
        paquetes: Number(this.manual.paquetes),
        kg: this.manual.kg != null ? Number(this.manual.kg) : undefined,
        conos: this.manual.conos != null ? Number(this.manual.conos) : undefined,
        motivo: this.motivo.trim() || undefined,
      })
      .subscribe({
        next: (r) => {
          this.mensaje.set(
            `Se desarmaron ${r.paquetes} paquete(s): −${r.kg_consumidos} kg de ${r.paquete.sku}, ` +
              `+${r.kg_enconados ?? r.kg_consumidos} kg de ${r.cono.sku} (${r.piezas_generadas} conos).`
          );
          this.manual.kg = null;
          this.manual.conos = null;
          this.motivo = '';
          this.bajando.set(false);
          this.hecho.emit();
        },
        error: (e) => {
          this.error.set(this.msg(e));
          this.bajando.set(false);
        },
      });
  }

  /** Los DECIMAL llegan como string; en la plantilla se comparan como número. */
  num(v: string | number | null | undefined): number {
    return Number(v ?? 0);
  }

  cerrar(): void {
    this.cerrado.emit();
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
