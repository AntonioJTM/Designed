import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Conversion, InventarioService, PreviaDesarme } from '../../../core/services/inventario.service';
import { Almacen } from '../../../core/models/inventario.models';
import { ApiError } from '../../../core/models/auth.models';
import { TiendaService } from '../../../core/services/tienda.service';
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
 * No pide nada al abrir: los almacenes y las bajadas recientes entran por input,
 * ya cargados por el listado, así que abre armado y de un tamaño.
 *
 * SOLO CON EL CÓDIGO DEL PAQUETE (2026-10-18): se escanea o se escribe a mano en
 * "Código del paquete". La captura "a mano, sin escanear" (cono + cuántos
 * paquetes, sin código) se quitó: sacaba kilos sin marcar ningún paquete como
 * abierto y descuadraba el inventario. El servidor también exige el código.
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
  private readonly tiendaSvc = inject(TiendaService);
  /**
   * El tope del destare por cono que puso la tienda (Configuración → Bajar
   * conos, 2026-10-20). null: sin tope propio (el servidor deja hasta 1 kg).
   */
  readonly topeDestare = signal<number | null>(null);

  readonly almacenes = input<Almacen[]>([]);
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
   * DESTARE DEL PAQUETE: lo que pesan los tubos de TODOS sus conos juntos, en kg
   * (2026-10-21, usuario: "es el destare del paquete completo, no por conos";
   * antes se pedía el de UN cono y se multiplicaba, y un 0.8 escrito para el
   * paquete entró como 0.8 × 12 = 9.6 kg). Se suma a los kilos del mostrador.
   * Se queda entre un paquete y otro mientras la ventana siga abierta.
   */
  destarePaquete: number | null = null;
  motivo = '';

  /** Solo las tiendas (almacenes con mostrador): en la bodega no se bajan conos. */
  readonly tiendas = computed(() => this.almacenes().filter((a) => !!Number(a.es_punto_venta)));

  /** Solo las últimas: el histórico completo está en el Kardex. */
  readonly ultimas = computed(() => this.conversiones().slice(0, 5));

  /** El destare escrito, en kg (0 si no se escribió). */
  destare(): number {
    const d = Number(this.destarePaquete ?? 0);
    return d > 0 ? Math.round(d * 1000) / 1000 : 0;
  }

  /** Los conos que salen del paquete escaneado. */
  private conosDelPaquete(): number {
    return Number(this.previaBulto()?.conos_a_generar ?? 0);
  }

  /** A cuántos gramos por cono sale el destare escrito: para notar un error de dedo. */
  gramosPorCono(): number {
    const conos = this.conosDelPaquete();
    return conos > 0 ? Math.round((this.destare() / conos) * 1000) : 0;
  }

  /**
   * El tope del destare es POR CONO (lo que puede pesar un tubo, Configuración →
   * Bajar conos; sin él, 1 kg): para ESTE paquete es eso × sus conos.
   */
  topeDelPaquete(): number {
    return Math.round((this.topeDestare() ?? 1) * this.conosDelPaquete() * 1000) / 1000;
  }

  /** Los inputs se leen aquí, no en el constructor: ahí todavía no están puestos. */
  ngOnInit(): void {
    // Lo que se recordaba era el destare de UN cono (hasta el 2026-10-21): como
    // destare del paquete sería otro número, ya no se propone y se olvida.
    try {
      localStorage.removeItem('destare_por_cono');
    } catch {
      /* sin almacenamiento */
    }
    this.tiendaSvc.configuracion().subscribe({
      next: (c) => {
        const t = Number(c.desarme_destare_max_kg);
        this.topeDestare.set(c.desarme_destare_max_kg && t > 0 ? t : null);
      },
      error: () => {},
    });
  }

  /** ¿El destare escrito pasa del tope para este paquete? (el servidor también lo rechaza). */
  pasaDelTope(): boolean {
    const conos = this.conosDelPaquete();
    return conos > 0 && this.destare() > this.topeDelPaquete() + 0.0005;
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
      // De una tienda que no es suya, el servidor no dice cuál (2026-10-15).
      if (b.almacen === 'otra tienda') return `Este paquete no está registrado en «${aqui}»: toma uno que esté aquí.`;
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

  /** Peso que va a quedar enconado: el del bulto más el destare del paquete. */
  pesoEnconado(): number | null {
    const p = this.previaBulto();
    if (!p) return null;
    const kg = Number(p.bulto.peso_kg);
    return Math.round((kg + this.destare()) * 1000) / 1000;
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
    if (this.pasaDelTope()) {
      const t = this.topeDestare();
      const conos = this.conosDelPaquete();
      this.error.set(
        `El destare del paquete es de ${this.destare().toLocaleString('es-MX')} kg: con ${conos} conos son ` +
          `${this.gramosPorCono().toLocaleString('es-MX')} g por cono` +
          (t != null
            ? ` y el tope es de ${Math.round(t * 1000).toLocaleString('es-MX')} g por cono (Configuración → Bajar conos)`
            : ' y no puede pasar de 1 kg por cono') +
          `. Para este paquete, hasta ${this.topeDelPaquete().toLocaleString('es-MX')} kg: escribe lo que pesan los tubos de todos sus conos juntos.`
      );
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
        // El destare del PAQUETE completo (2026-10-21); el servidor lo suma tal cual.
        destare_kg: this.destare() > 0 ? this.destare() : undefined,
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
