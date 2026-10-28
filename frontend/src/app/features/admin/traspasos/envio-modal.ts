import { Component, ElementRef, OnInit, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  CodigoResuelto,
  InventarioService,
  ResultadoTraspaso,
  Traspaso,
  TraspasoLinea,
} from '../../../core/services/inventario.service';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';

/** Un paquete escaneado: su código, de qué hilo es y lo que pesa de verdad. */
export interface PaqueteEscaneado {
  codigo: string;
  variante_id: number;
  peso_kg: number;
  lote: string | null;
  /**
   * El almacén donde lo tenía el sistema, si era otro y se confirmó que sí está
   * aquí: al guardar o enviar se pasa al que surte con sus kilos.
   */
  estaba_en?: string | null;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * ENVIAR un traspaso escaneando los paquetes que suben a la camioneta.
 *
 * Al surtir se escanea cada paquete que sale (usuario, 2026-10-06: "aquí cuando
 * se surte sí se escanean los paquetes que salen"). Con eso de cada hilo sale el
 * peso REAL de sus paquetes y ESOS quedan en la sucursal, en vez del aproximado
 * que se apartó al pedir. Pueden ser menos de los pedidos (sale lo que hay),
 * nunca más (2026-10-19: "si autorizo 10, solo salen 10"): el que sobra se
 * rechaza al escanearlo.
 *
 * Cada código se revisa al escanearlo (que sea un paquete, de un hilo del
 * traspaso, disponible y con peso) para avisar en el momento y no al final; el
 * servidor lo vuelve a revisar al enviar.
 *
 * SIN ESCANEAR NO SE ENVÍA: "aquí cada cosa que sale se escanea, no se puede
 * enviar si no se escanea" (usuario, 2026-10-06). "Enviar" se apaga mientras no
 * haya ni un paquete escaneado; el servidor exige lo mismo.
 *
 * SE MANDA LO QUE HAY: "si pido 20 de negro 1/30 y solo tengo 15, que se envíen
 * esos y nada más". Un hilo con menos sale con los escaneados y uno sin ninguno
 * no sale; el modal lo dice antes de enviar y el servidor lo anota solo en las
 * notas del envío ("…era lo único que había"), junto con lo que se escriba aquí.
 *
 * SE PUEDE DEJAR A MEDIAS (2026-10-07: "que se puedan escanear una parte, se
 * guarden esos códigos pero que ya no se puedan vender hasta que cancele el
 * pedido; que haya un como en espera hasta que terminen de escanear los
 * demás"). "Guardar y seguir después" guarda lo escaneado: esos paquetes quedan
 * APARTADOS para este envío (la caja no los vende) y el traspaso queda en
 * espera. Al volver a abrir, aparecen ya escaneados. Al enviar salen junto con
 * los nuevos; si se cancela el traspaso, quedan libres.
 *
 * UN PAQUETE QUE EL SISTEMA TIENE EN OTRO ALMACÉN (2026-10-07, el usuario
 * eligió "avisar y, si confirman que sí está aquí, pasarlo con sus kilos"): al
 * escanearlo pregunta "¿Este paquete sí está aquí?". Si sí, entra marcado
 * ("estaba en «…»") y el servidor lo pasa al almacén que surte CON SUS KILOS al
 * guardar o enviar (queda en el kardex); si no, no entra. Uno que viene en
 * camino en otro envío no entra.
 *
 * El traspaso entra por input. No cierra al tocar el fondo: ✕, "Cancelar" o
 * Escape; si hay paquetes escaneados sin guardar, pregunta antes.
 */
@Component({
  selector: 'app-envio-modal',
  imports: [FormsModule, CantidadPipe],
  templateUrl: './envio-modal.html',
  // La barra de cada hilo es la misma de Pendientes (traspasos-avance.scss).
  styleUrls: ['./envio-modal.scss', './traspasos-avance.scss'],
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class EnvioModal implements OnInit {
  private readonly inv = inject(InventarioService);
  private readonly confirmacion = inject(ConfirmacionService);

  readonly traspaso = input.required<Traspaso>();

  readonly cerrado = output<void>();
  /** Ya salió: la pantalla avisa y recarga. */
  readonly enviado = output<ResultadoTraspaso>();
  /** Se guardó lo escaneado a medio surtir: la pantalla avisa y recarga. */
  readonly guardado = output<{ folio: string; guardados: number; kg: number }>();

  /** Los códigos que ya estaban guardados al abrir (para saber qué falta guardar). */
  private guardadosAlAbrir = new Set<string>();

  private readonly lector = viewChild<ElementRef<HTMLInputElement>>('lector');

  readonly escaneados = signal<PaqueteEscaneado[]>([]);
  readonly error = signal<string | null>(null);
  /** El último que entró, para que quien escanea vea que sí lo leyó. */
  readonly ultimo = signal<string | null>(null);
  readonly enviando = signal(false);
  codigo = '';
  /** Lo que quiera añadir quien surte; lo incompleto se anota solo. */
  notas = '';

  /** Códigos que se están consultando: el lector dispara rápido y no se pierde ninguno. */
  private readonly enCamino = new Set<string>();

  /** El input se lee aquí, no en el constructor: ahí todavía no está puesto. */
  ngOnInit(): void {
    // Lo que se escaneó y guardó antes aparece ya en la lista.
    const previos: PaqueteEscaneado[] = this.lineas().flatMap((l) =>
      (l.guardados ?? []).map((g) => ({
        codigo: g.codigo,
        variante_id: Number(g.variante_id ?? l.variante_id),
        peso_kg: Number(g.peso_kg),
        lote: g.lote ?? null,
      }))
    );
    this.escaneados.set(previos);
    this.guardadosAlAbrir = new Set(previos.map((p) => p.codigo));
    setTimeout(() => this.enfocar());
  }

  /** Cuántos había guardados al abrir. */
  yaGuardados(): number {
    return this.guardadosAlAbrir.size;
  }

  /** Lo escaneado ya no es lo que estaba guardado (hay nuevos o se quitó alguno). */
  cambiosSinGuardar(): boolean {
    const ahora = this.escaneados().map((p) => p.codigo);
    return ahora.length !== this.guardadosAlAbrir.size || ahora.some((c) => !this.guardadosAlAbrir.has(c));
  }

  lineas(): TraspasoLinea[] {
    return this.traspaso().lineas ?? [];
  }

  /** Color + calibre + material + línea: con el color solo no se sabe qué hilo es. */
  etiqueta(l: { producto: string; calibre?: string | null; material?: string | null; linea?: string | null }): string {
    const nombre = `${l.producto}${l.calibre ? ' ' + l.calibre : ''}`;
    return [nombre, l.material, l.linea].filter(Boolean).join(' · ');
  }

  /** Cuántos paquetes y cuántos kilos lleva escaneados cada hilo. */
  readonly porLinea = computed(() => {
    const m = new Map<number, { paquetes: number; kg: number }>();
    for (const p of this.escaneados()) {
      const a = m.get(p.variante_id) ?? { paquetes: 0, kg: 0 };
      m.set(p.variante_id, { paquetes: a.paquetes + 1, kg: r3(a.kg + p.peso_kg) });
    }
    return m;
  });

  cuantos(l: TraspasoLinea): number {
    return this.porLinea().get(l.variante_id)?.paquetes ?? 0;
  }

  kgDe(l: TraspasoLinea): number {
    return this.porLinea().get(l.variante_id)?.kg ?? 0;
  }

  pedidos(l: TraspasoLinea): number | null {
    const p = l.paquetes_solicitados ?? l.paquetes;
    return p != null ? Number(p) : null;
  }

  /**
   * La barra del hilo: cuántos van de los pedidos (2026-10-20, auditoría). Solo
   * con lo pedido en paquetes; nunca salen más de los pedidos.
   */
  avance(l: TraspasoLinea): { van: number; de: number; pct: number; completo: boolean } | null {
    const de = Math.round(Number(this.pedidos(l) ?? 0));
    if (!(de > 0)) return null;
    const van = this.cuantos(l);
    return { van, de, pct: Math.min(100, Math.round((van / de) * 100)), completo: van >= de };
  }

  /** "Faltan 2" / "2 de más", contra lo pedido; nada si cuadra o no se ha escaneado. */
  diferencia(l: TraspasoLinea): string | null {
    const pedidos = this.pedidos(l);
    const n = this.cuantos(l);
    if (pedidos == null || n === 0 || n === pedidos) return null;
    return n < pedidos ? (pedidos - n === 1 ? 'falta 1' : `faltan ${pedidos - n}`) : `${n - pedidos} de más`;
  }

  readonly totalPaquetes = computed(() => this.escaneados().length);
  readonly totalKg = computed(() => r3(this.escaneados().reduce((s, p) => s + p.peso_kg, 0)));

  /**
   * Lo que no sale completo, dicho por hilo: "BLACK 2/30 (15 de 20)" o
   * "OPTIK 2/30 (no sale)". Se manda lo que hay y queda anotado.
   */
  readonly incompletos = computed(() => {
    const m = this.porLinea();
    return this.lineas()
      .map((l) => {
        const n = m.get(l.variante_id)?.paquetes ?? 0;
        const pedidos = this.pedidos(l);
        if (n === 0) return `${this.nombreDe(l.variante_id)} (no sale)`;
        if (pedidos != null && n < pedidos) return `${this.nombreDe(l.variante_id)} (${n} de ${pedidos})`;
        return null;
      })
      .filter((x): x is string => x !== null);
  });

  /** El último escaneado va arriba: es el que se acaba de subir. */
  readonly lista = computed(() => [...this.escaneados()].reverse());

  nombreDe(varianteId: number): string {
    const l = this.lineas().find((x) => x.variante_id === varianteId);
    return l ? `${l.producto}${l.calibre ? ' ' + l.calibre : ''}` : '';
  }

  leer(): void {
    // Se lee y se vacía el campo DIRECTO: el lector teclea tan rápido que el
    // último dígito y el Enter caen en el mismo ciclo de pantalla, y con solo
    // `codigo = ''` Angular no ve cambio (ya valía '') y el texto se queda; el
    // siguiente escaneo se pegaría al anterior.
    const el = this.lector()?.nativeElement;
    const cod = (el?.value || this.codigo).trim();
    this.codigo = '';
    if (el) el.value = '';
    if (!cod) return;
    this.error.set(null);
    if (this.escaneados().some((p) => p.codigo === cod) || this.enCamino.has(cod)) {
      this.error.set(`El paquete ${cod} ya está en la lista.`);
      return;
    }
    this.enCamino.add(cod);
    this.inv.resolverCodigo(cod).subscribe({
      next: async (r) => {
        const motivo = this.motivoRechazo(cod, r);
        if (motivo) {
          this.enCamino.delete(cod);
          this.error.set(motivo);
          this.ultimo.set(null);
          return;
        }
        const b = r.bulto!;
        // El sistema lo tiene en OTRO almacén: se pregunta si de verdad está aquí.
        const origen = this.traspaso().almacen_origen_id;
        let estabaEn: string | null = null;
        if (b.almacen_id != null && origen != null && Number(b.almacen_id) !== Number(origen)) {
          estabaEn = b.almacen ?? 'otro almacén';
          const si = await this.confirmarAqui(cod, Number(b.peso_kg), Number(b.variante_id), estabaEn);
          if (!si) {
            this.enCamino.delete(cod);
            this.error.set(`No se agregó el paquete ${cod}: el sistema lo tiene en «${estabaEn}».`);
            this.ultimo.set(null);
            this.enfocar();
            return;
          }
        }
        // Mientras se preguntaba "¿sí está aquí?" pudo entrar otro del mismo hilo: se
        // vuelve a revisar el tope antes de agregarlo (2026-10-26, auditoría).
        const despues = estabaEn ? this.motivoRechazo(cod, r) : null;
        if (despues) {
          this.enCamino.delete(cod);
          this.error.set(despues);
          this.ultimo.set(null);
          this.enfocar();
          return;
        }
        this.enCamino.delete(cod);
        const paquete: PaqueteEscaneado = {
          codigo: cod,
          variante_id: Number(b.variante_id),
          peso_kg: Number(b.peso_kg),
          lote: b.lote ?? null,
          estaba_en: estabaEn,
        };
        this.escaneados.update((arr) => [...arr, paquete]);
        this.ultimo.set(
          `${cod} · ${paquete.peso_kg} kg · ${this.nombreDe(paquete.variante_id)}` +
            (estabaEn ? ` · se pasa de «${estabaEn}» a «${this.traspaso().almacen_origen}»` : '')
        );
        this.enfocar();
      },
      error: (e) => {
        this.enCamino.delete(cod);
        this.ultimo.set(null);
        this.error.set(
          (e as { status?: number })?.status === 404
            ? `El código ${cod} no está registrado.`
            : this.msg(e)
        );
        this.enfocar();
      },
    });
  }

  /**
   * "¿Este paquete sí está aquí?": el sistema lo tiene en otro almacén. Si lo
   * tienen en la mano, ahí está; se pasa al que surte con sus kilos.
   */
  private confirmarAqui(cod: string, peso: number, varianteId: number, estabaEn: string): Promise<boolean> {
    const aqui = this.traspaso().almacen_origen;
    const kg = `${peso.toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg`;
    return this.confirmacion.pedir({
      // A medio escaneo: el Enter de la siguiente lectura no lo acepta (2026-10-20).
      enfocarCancelar: true,
      titulo: '¿Este paquete sí está aquí?',
      mensaje:
        `El sistema tiene el paquete ${cod} (${kg} de ${this.nombreDe(varianteId)}) en «${estabaEn}», no en «${aqui}». ` +
        `Si lo tienes en la mano, se pasa a «${aqui}» con sus ${kg} y sale en este envío. Queda escrito en el kardex.`,
      aceptar: 'Sí está aquí',
      cancelar: 'No, dejarlo',
    });
  }

  /** Los confirmados que estaban en otro almacén: el servidor los pasa aquí con sus kilos. */
  private encontrados(): string[] {
    return this.escaneados().filter((p) => p.estaba_en).map((p) => p.codigo);
  }

  /** Por qué no puede salir ese código; null si sí. */
  private motivoRechazo(cod: string, r: CodigoResuelto): string | null {
    const b = r.bulto;
    if (!b) {
      return `El código ${cod} es el de la presentación, no el de un paquete: escanea la etiqueta del paquete.`;
    }
    if (!this.lineas().some((l) => l.variante_id === Number(b.variante_id))) {
      const v = r.variante;
      return `El paquete ${cod} es de ${v.producto}${v.calibre ? ' ' + v.calibre : ''}, que no está en este traspaso.`;
    }
    // No sale más de lo pedido (o autorizado): el que sobra no se agrega.
    const linea = this.lineas().find((l) => l.variante_id === Number(b.variante_id))!;
    const pedidos = this.pedidos(linea);
    if (pedidos != null && this.cuantos(linea) >= pedidos) {
      return `De ${this.nombreDe(linea.variante_id)} se ${pedidos === 1 ? 'pidió 1 paquete' : `pidieron ${pedidos} paquetes`} ` +
        `y ya van ${this.cuantos(linea)}: no sale más de lo pedido.`;
    }
    if (b.estado && b.estado !== 'disponible') {
      // Uno apartado para ESTE mismo envío (se guardó antes y se quitó de la lista) sí vale.
      const delMismo = b.estado === 'apartado' && b.consumido_folio === this.traspaso().folio;
      if (b.estado === 'apartado' && !delMismo) {
        const de = b.consumido_folio?.startsWith('TRA') ? 'otro envío a sucursal' : 'una nota en espera';
        return `El paquete ${cod} está apartado para ${de}${b.consumido_folio ? ` (${b.consumido_folio})` : ''}: escanea otro.`;
      }
    }
    if (b.estado && b.estado !== 'disponible' && b.estado !== 'apartado') {
      return b.estado === 'vendido'
        ? `El paquete ${cod} ya se vendió${b.consumido_folio ? ` (${b.consumido_folio})` : ''}.`
        : b.estado === 'faltante'
          ? `El paquete ${cod} se dio por faltante al recibir ${b.consumido_folio ?? 'un envío'} (no llegó).`
          : `El paquete ${cod} ya se bajó a conos.`;
    }
    if (!(Number(b.peso_kg) > 0)) {
      return `El paquete ${cod} no tiene peso registrado: no se puede saber cuánto sale.`;
    }
    if (b.en_camino_folio) {
      return `El paquete ${cod} viene en camino (${b.en_camino_folio}): primero se recibe ese envío.`;
    }
    return null;
  }

  quitar(codigo: string): void {
    this.escaneados.update((arr) => arr.filter((p) => p.codigo !== codigo));
    this.ultimo.set(null);
    this.enfocar();
  }

  confirmar(): void {
    if (this.enviando()) return;
    if (this.totalPaquetes() === 0) {
      this.error.set('Escanea los paquetes que salen: sin escanear no se puede enviar.');
      return;
    }
    this.enviando.set(true);
    this.error.set(null);
    const codigos = this.escaneados().map((p) => p.codigo);
    this.inv.enviarTraspaso(this.traspaso().id, codigos, this.notas.trim() || undefined, this.encontrados()).subscribe({
      next: (r) => {
        this.enviando.set(false);
        this.enviado.emit(r);
      },
      error: (e) => {
        this.enviando.set(false);
        this.error.set(this.msg(e));
      },
    });
  }

  /**
   * Guarda lo escaneado y deja el envío en espera: esos paquetes quedan
   * apartados (no se venden) hasta que se envíe o se cancele.
   */
  guardar(): void {
    if (this.enviando()) return;
    this.enviando.set(true);
    this.error.set(null);
    this.inv.guardarEscaneos(this.traspaso().id, this.escaneados().map((p) => p.codigo), this.encontrados()).subscribe({
      next: (r) => {
        this.enviando.set(false);
        this.guardadosAlAbrir = new Set(this.escaneados().map((p) => p.codigo));
        this.guardado.emit({ folio: r.folio, guardados: r.guardados, kg: r.kg });
      },
      error: (e) => {
        this.enviando.set(false);
        this.error.set(this.msg(e));
      },
    });
  }

  async cerrar(): Promise<void> {
    if (this.enviando()) return;
    if (this.cambiosSinGuardar()) {
      const nuevos = this.escaneados().filter((p) => !this.guardadosAlAbrir.has(p.codigo)).length;
      const si = await this.confirmacion.pedir({
        titulo: '¿Salir sin guardar lo escaneado?',
        mensaje: nuevos
          ? `Escaneaste ${nuevos} ${nuevos === 1 ? 'paquete' : 'paquetes'} que no se han guardado: si sales, se pierden y ` +
            'habrá que volver a escanearlos. Para dejarlo a medias, usa «Guardar y seguir después».'
          : 'Quitaste paquetes de la lista y no se ha guardado: si sales, siguen apartados para este envío.',
        aceptar: 'Salir sin guardar',
        cancelar: 'Seguir escaneando',
        peligro: true,
      });
      if (!si) {
        this.enfocar();
        return;
      }
    }
    this.cerrado.emit();
  }

  private enfocar(): void {
    this.lector()?.nativeElement.focus();
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
