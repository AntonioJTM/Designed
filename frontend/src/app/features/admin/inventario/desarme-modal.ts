import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Conversion, InventarioService, PreviaDesarme } from '../../../core/services/inventario.service';
import { Almacen } from '../../../core/models/inventario.models';
import { Variante } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';
import { CuandoPipe } from './cuando.pipe';

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
  imports: [FormsModule, CantidadPipe, FechaPipe, CuandoPipe],
  templateUrl: './desarme-modal.html',
  styleUrl: './modales.scss',
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
  /**
   * La TIENDA donde se abre el paquete: ahí estaba y ahí quedan los conos. Los
   * conos solo se bajan en tiendas; en la bodega no (usuario, 2026-10-06). Si el
   * paquete está en la bodega, primero se manda con Surtir sucursal.
   */
  tienda: number | '' = '';
  /**
   * DESTARE POR CONO: lo que pesa el tubo de UN cono. Se multiplica por los conos
   * que salen y se suma a los kilos del mostrador ("eso se le suma a cada cono").
   * Lo captura la tienda porque depende del tubo; se recuerda para la próxima.
   */
  destarePorCono: number | null = null;
  motivo = '';

  /** Captura a mano, cuando no hay lector o el bulto no tiene código. */
  manual = {
    cono_id: '' as number | '',
    tienda: '' as number | '',
    paquetes: 1 as number | null,
    kg: null as number | null,
    conos: null as number | null,
  };

  /** Solo las tiendas (almacenes con mostrador): en la bodega no se bajan conos. */
  readonly tiendas = computed(() => this.almacenes().filter((a) => !!Number(a.es_punto_venta)));

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
    destare: number;
    kgEnconados: number;
  } | null {
    const c = this.conoSel();
    const n = Number(this.manual.paquetes);
    if (!c || !n || !c.paquete_peso_kg || !c.piezas_por_origen) return null;
    // Peso nominal según el paquete, y el real si se ajustó a mano.
    const nominal = Number(c.paquete_peso_kg) * n;
    const kg = this.manual.kg != null ? Number(this.manual.kg) : nominal;
    const piezasNominal = Number(c.piezas_por_origen) * n;
    const piezas = this.manual.conos != null ? Number(this.manual.conos) : piezasNominal;
    const destare = this.destareTotal(piezas);
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
      destare,
      kgEnconados: Math.round((kg + destare) * 1000) / 1000,
    };
  }

  /** Destare de todos los conos: lo que pesa un tubo × cuántos conos salen. */
  destareTotal(conos: number | null | undefined): number {
    const d = Number(this.destarePorCono ?? 0);
    if (!d || !conos) return 0;
    return Math.round(d * Number(conos) * 1000) / 1000;
  }

  /** El destare de un cono en gramos, que es como se pesa un tubo. */
  gramos(): number {
    return Math.round(Number(this.destarePorCono ?? 0) * 1000);
  }

  /** Los inputs se leen aquí, no en el constructor: ahí todavía no están puestos. */
  ngOnInit(): void {
    const primerCono = this.conos()[0];
    if (primerCono) this.manual.cono_id = primerCono.id;
    const tienda = this.tiendas()[0];
    if (tienda) this.manual.tienda = tienda.id;
    // El tubo casi siempre es el mismo: se propone el último destare usado.
    try {
      const d = Number(localStorage.getItem('destare_por_cono'));
      if (d > 0) this.destarePorCono = d;
    } catch {
      /* sin almacenamiento: se captura cada vez */
    }
  }

  private recordarDestare(): void {
    try {
      if (this.destarePorCono && this.destarePorCono > 0) {
        localStorage.setItem('destare_por_cono', String(this.destarePorCono));
      }
    } catch {
      /* sin almacenamiento */
    }
  }

  /**
   * Por qué ESTE paquete no se puede abrir en la tienda elegida, o null. Tiene
   * que estar ahí (usuario, 2026-10-06: "si no, que mande una alerta de que el
   * paquete en esa sucursal no existe"). El servidor lo exige igual.
   */
  problemaUbicacion(): string | null {
    const b = this.previaBulto()?.bulto;
    if (!b) return null;
    if (b.en_camino_folio) {
      return `Este paquete viene en camino (${b.en_camino_folio}): primero recibe el envío en Surtir sucursal.`;
    }
    if (b.almacen_id != null && b.almacen_id !== Number(this.tienda)) {
      const aqui = this.tiendas().find((t) => t.id === Number(this.tienda))?.nombre ?? 'esta tienda';
      return (
        `Este paquete no está en «${aqui}»: el sistema lo tiene en «${b.almacen}». ` +
        (b.en_tienda ? 'Elige esa tienda para bajarlo ahí.' : 'Primero mándalo a la tienda con Surtir sucursal.')
      );
    }
    return null;
  }

  /** Lo que hay del paquete escaneado en esa tienda (null si no hay). */
  existenciaEn(tiendaId: number | ''): number | null {
    const e = this.previaBulto()?.existencias.find((x) => x.almacen_id === Number(tiendaId));
    return e ? Number(e.cantidad) : null;
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
        // La tienda donde ESTÁ el paquete; si no está en una tienda, la que tenga
        // saldo de él, o la primera (y entonces avisa que no está ahí).
        const ids = new Set(this.tiendas().map((t) => t.id));
        const conPaquete = p.existencias.find((e) => ids.has(e.almacen_id) && Number(e.cantidad) > 0);
        const donde = p.bulto.almacen_id != null && ids.has(p.bulto.almacen_id) ? p.bulto.almacen_id : null;
        this.tienda = donde ?? conPaquete?.almacen_id ?? this.tiendas()[0]?.id ?? '';
      },
      error: (e) => {
        this.previaBulto.set(null);
        this.error.set(this.msg(e));
      },
    });
  }

  /** Peso que va a quedar enconado: el del bulto más el destare de sus conos. */
  pesoEnconado(): number | null {
    const p = this.previaBulto();
    if (!p) return null;
    const kg = Number(p.bulto.peso_kg);
    return Math.round((kg + this.destareTotal(p.conos_a_generar)) * 1000) / 1000;
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
    if (!this.tienda) {
      this.error.set('Elige en qué tienda se abre el paquete.');
      return;
    }
    const problema = this.problemaUbicacion();
    if (problema) {
      this.error.set(problema);
      return;
    }
    this.bajando.set(true);
    this.error.set(null);
    this.inv
      .desarmar({
        codigo_bulto: p.bulto.codigo,
        // Se abre donde está: la misma tienda de un lado y del otro.
        almacen_origen_id: Number(this.tienda),
        almacen_destino_id: Number(this.tienda),
        destare_por_cono_kg: this.destarePorCono && this.destarePorCono > 0 ? Number(this.destarePorCono) : undefined,
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
          this.recordarDestare();
          this.previaBulto.set(null);
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
    if (!c || !this.manual.tienda || !this.manual.paquetes) {
      this.error.set('Elige el cono, la tienda y cuántos paquetes vas a desarmar.');
      return;
    }
    this.error.set(null);
    this.mensaje.set(null);
    this.bajando.set(true);
    this.inv
      .desarmar({
        cono_variante_id: c.id,
        almacen_origen_id: Number(this.manual.tienda),
        almacen_destino_id: Number(this.manual.tienda),
        paquetes: Number(this.manual.paquetes),
        kg: this.manual.kg != null ? Number(this.manual.kg) : undefined,
        conos: this.manual.conos != null ? Number(this.manual.conos) : undefined,
        destare_por_cono_kg: this.destarePorCono && this.destarePorCono > 0 ? Number(this.destarePorCono) : undefined,
        motivo: this.motivo.trim() || undefined,
      })
      .subscribe({
        next: (r) => {
          this.mensaje.set(
            `Se desarmaron ${r.paquetes} paquete(s): −${r.kg_consumidos} kg de ${r.paquete.sku}, ` +
              `+${r.kg_enconados ?? r.kg_consumidos} kg de ${r.cono.sku} (${r.piezas_generadas} conos).`
          );
          this.recordarDestare();
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
