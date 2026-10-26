import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TiendaService } from '../../../core/services/tienda.service';
import { CuentaBancaria, OpcionConfiguracion } from '../../../core/models/tienda.models';
import { ApiError } from '../../../core/models/auth.models';
import { CuentaBancariaModal, clabeLegible } from './cuenta-bancaria-modal';
import { armarPrueba, imprimirTicket } from '../../../shared/ticket/ticket';
import { WhatsappTiendaComponent } from './whatsapp-tienda';

/** Cómo se dibuja un campo conocido. Los desconocidos usan su descripción. */
interface Campo {
  etiqueta: string;
  placeholder?: string;
  tipo?: 'text' | 'tel' | 'number' | 'select';
  /** Para `select`: las opciones (valor guardado y lo que se lee). */
  opciones?: { valor: string; texto: string }[];
  /** `flex` del campo dentro de la fila de su tarjeta. */
  ancho?: string;
  /** Para `number`: de cuánto en cuánto (por omisión, centavos). */
  paso?: string;
  /** Para `number`: lo que se lee junto al campo ("kg"). */
  unidad?: string;
}

/** Una tarjeta de la pantalla: un grupo de claves por su prefijo. */
interface Grupo {
  titulo: string;
  sub?: string;
  prefijos: string[];
  /** Lleva el botón "Imprimir una prueba" (el del ticket). */
  prueba?: boolean;
}

/**
 * Los datos de la tienda que el administrador cambia sin tocar código
 * (rediseño 2026-10).
 *
 * Es una PANTALLA y no un modal —a diferencia de materiales o productos— porque
 * no hay listado sobre el que abrirse: esto es la única vista de estos datos.
 *
 * Las claves las define la migración, no esta pantalla: se dibuja lo que
 * devuelve el servidor. Las conocidas llevan su etiqueta corta; una clave nueva
 * cae en "Otros" con su descripción, así agregar una opción sigue siendo una
 * línea de SQL y aparece aquí sola.
 *
 * TIENDA EN LÍNEA APAGADA (2026-10). Quién lee cada clave hoy:
 *  · `envio_costo_fijo`: SOLO la tienda en línea (la cotización del pedido en
 *    línea y el checkout). Se ESCONDE —ver `OCULTAS` y el grupo comentado—.
 *  · `tienda_direccion`: se ESCONDE desde el 2026-10-14 ("me pones que ponga la
 *    dirección de la tienda 2 veces", usuario): el ticket imprime el DOMICILIO
 *    FISCAL, y la dirección solo la leía el checkout de la tienda en línea, que
 *    ahora usa el domicilio fiscal si no hay otra. La clave sigue en la base.
 *  · `tienda_telefono`: va en el ticket y en el checkout. Se queda.
 *
 * CUENTAS PARA TRANSFERENCIAS (2026-10-06): ya no son tres claves sueltas
 * (`transferencia_*`, una sola cuenta) sino una lista —tabla
 * `cuentas_bancarias`— con banco, a nombre de, número de cuenta y CLABE. Se
 * agregan y editan en un modal y se guardan al momento, aparte del botón
 * Guardar de arriba, que es para los datos de la tienda.
 */
@Component({
  selector: 'app-configuracion',
  imports: [FormsModule, CuentaBancariaModal, WhatsappTiendaComponent],
  templateUrl: './configuracion.html',
  styles: `
    .campos { display: flex; flex-wrap: wrap; gap: 16px; }
    .campos > .field { flex: 1 1 240px; }
    .card.suave .card-head { margin-bottom: 0; align-items: center; }
    .cuenta-num { font-family: var(--mono); font-size: 0.875rem; white-space: nowrap; }
    .cant { display: flex; align-items: center; gap: 8px; }
    .cant input { flex: 1; min-width: 0; text-align: right; font-variant-numeric: tabular-nums; }
  `,
})
export class Configuracion implements OnInit {
  private readonly tienda = inject(TiendaService);

  readonly opciones = signal<OpcionConfiguracion[]>([]);
  readonly cuentas = signal<CuentaBancaria[]>([]);
  /** La cuenta abierta en el modal: null = cerrado, 'nueva' = alta. */
  readonly cuentaAbierta = signal<CuentaBancaria | 'nueva' | null>(null);
  readonly clabeLegible = clabeLegible;
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  /** Lo tecleado, por clave. Se compara contra lo cargado para saber qué cambió. */
  valores: Record<string, string> = {};
  private original: Record<string, string> = {};

  /**
   * Agrupa las claves como se piensan, no como se guardan. El prefijo de la
   * clave dice a qué tarjeta va; una clave nueva que no encaje cae en "Otros" y
   * se ve igual, en vez de desaparecer.
   */
  readonly grupos: Grupo[] = [
    { titulo: 'La tienda', sub: 'El teléfono sale en cada ticket, junto al domicilio fiscal.', prefijos: ['tienda_'] },
    // El encabezado del ticket (2026-10-14).
    {
      titulo: 'Datos fiscales',
      sub: 'Salen arriba de cada ticket. Cópialos como vienen en la Constancia de Situación Fiscal.',
      prefijos: ['fiscal_'],
    },
    {
      titulo: 'Ticket',
      sub: 'El papel de la impresora de tickets y lo que va al pie. Si no sabes cuál ancho elegir, imprime una prueba: trae una regla para ver hasta dónde imprime tu impresora.',
      prefijos: ['ticket_'],
      prueba: true,
    },
    // El tope del destare por cono (2026-10-20: "este yo lo pongo").
    {
      titulo: 'Bajar conos',
      sub: 'Lo más que puede pesar el tubo de UN cono. Al bajar un paquete se escribe el destare del paquete completo; si entre sus conos sale más que esto por cono, no se deja (con 50 g y 12 conos, hasta 0.6 kg).',
      prefijos: ['desarme_'],
    },
    // Las cuentas para transferencias ya no son claves: tienen su propia tarjeta (ver arriba).
    // TIENDA EN LÍNEA APAGADA (2026-10): la tarifa de envío solo la cobra el
    // pedido en línea. Para regresarla, descomentar este grupo y quitar
    // 'envio_' de OCULTAS.
    // { titulo: 'Envío a domicilio', sub: 'Lo que se cobra por enviar un pedido de la tienda en línea.', prefijos: ['envio_'] },
  ];

  /**
   * Prefijos que no se dibujan (ni en su tarjeta ni en "Otros"): el envío
   * mientras la tienda en línea esté apagada, las claves viejas de la cuenta de
   * banco por si la migración de cuentas todavía no corre en esa base, y la
   * dirección de la tienda, que repetía el domicilio fiscal (2026-10-14), y los
   * tiempos de Rotación, que se cambian en su pantalla (2026-10-22).
   */
  private readonly OCULTAS = ['envio_', 'transferencia_', 'tienda_direccion', 'rotacion_'];

  /** Las etiquetas del diseño para las claves conocidas. */
  private readonly CAMPOS: Record<string, Campo> = {
    tienda_direccion: { etiqueta: 'Dirección', placeholder: 'Calle, número, colonia y ciudad', ancho: '2 1 360px' },
    tienda_telefono: { etiqueta: 'Teléfono', placeholder: '445 000 0000', tipo: 'tel', ancho: '1 1 220px' },
    desarme_destare_max_kg: {
      etiqueta: 'Tope del destare por cono', placeholder: 'Ej. 0.05 (50 g)', tipo: 'number', paso: '0.001',
      unidad: 'kg', ancho: '0 1 260px',
    },
    // En este orden en la pantalla (el servidor las manda por orden alfabético).
    fiscal_razon_social: { etiqueta: 'Razón social', placeholder: 'Como en la constancia, con S.A. de C.V.', ancho: '2 1 360px' },
    fiscal_rfc: { etiqueta: 'RFC', placeholder: '12 o 13 letras y números', ancho: '1 1 200px' },
    fiscal_regimen: { etiqueta: 'Régimen fiscal', placeholder: 'Ej. 601 General de Ley Personas Morales', ancho: '2 1 360px' },
    fiscal_domicilio: { etiqueta: 'Domicilio fiscal', placeholder: 'Calle, número, colonia, C.P., municipio y estado', ancho: '1 1 100%' },
    ticket_papel_mm: {
      etiqueta: 'Ancho del papel',
      tipo: 'select',
      opciones: [
        { valor: '58', texto: '58 mm (imprime unos 48 mm)' },
        { valor: '80', texto: '80 mm (imprime de 64 a 72 mm)' },
      ],
      ancho: '1 1 260px',
    },
    ticket_leyenda: { etiqueta: 'Leyenda al pie del ticket', placeholder: 'Este ticket no es un comprobante fiscal.', ancho: '3 1 480px' },
    // El costo de envío es dinero: se captura como número (oculto mientras la tienda esté apagada).
    envio_costo_fijo: { etiqueta: 'Costo de envío ($)', tipo: 'number', ancho: '1 1 220px' },
  };

  ngOnInit(): void {
    this.cargar();
    this.cargarCuentas();
  }

  cargarCuentas(): void {
    this.tienda.cuentasBancarias().subscribe({
      next: (c) => this.cuentas.set(c),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  abrirCuenta(c: CuentaBancaria | 'nueva'): void {
    this.mensaje.set(null);
    this.error.set(null);
    this.cuentaAbierta.set(c);
  }

  /** El modal no puede pasar el tipo unión por un input: aquí se separa. */
  cuentaDelModal(): CuentaBancaria | null {
    const c = this.cuentaAbierta();
    return c === 'nueva' ? null : c;
  }

  cuentaGuardada(texto: string): void {
    this.mensaje.set(texto);
    this.cargarCuentas();
  }

  cargar(): void {
    this.cargando.set(true);
    this.tienda.configuracionCompleta().subscribe({
      next: (o) => {
        this.opciones.set(o);
        this.valores = Object.fromEntries(o.map((x) => [x.clave, x.valor ?? '']));
        this.original = { ...this.valores };
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  /** Las opciones de un grupo: las conocidas en el orden de `CAMPOS`, las demás como vinieron. */
  opcionesDe(prefijos: string[]): OpcionConfiguracion[] {
    const orden = Object.keys(this.CAMPOS);
    const lugar = (c: string) => (orden.includes(c) ? orden.indexOf(c) : orden.length);
    return this.opciones()
      .filter((o) => prefijos.some((p) => o.clave.startsWith(p)))
      .filter((o) => !this.OCULTAS.some((p) => o.clave.startsWith(p)))
      .sort((a, b) => lugar(a.clave) - lugar(b.clave));
  }

  /** Las que no encajaron en ningún grupo ni están escondidas. */
  otras(): OpcionConfiguracion[] {
    const conocidos = [...this.grupos.flatMap((g) => g.prefijos), ...this.OCULTAS];
    return this.opciones().filter((o) => !conocidos.some((p) => o.clave.startsWith(p)));
  }

  campo(o: OpcionConfiguracion): Campo {
    return this.CAMPOS[o.clave] ?? { etiqueta: o.descripcion || o.clave };
  }

  /**
   * La hoja de prueba con el ancho que está ELEGIDO (aunque no se haya guardado):
   * así se prueba antes de guardar. Ver `armarPrueba`.
   */
  imprimirPrueba(): void {
    void imprimirTicket(armarPrueba(this.valores['ticket_papel_mm']));
  }

  /** Si algo cambió; sin eso el botón de guardar no tiene nada que hacer. */
  hayCambios(): boolean {
    return Object.keys(this.valores).some((k) => this.valores[k] !== this.original[k]);
  }

  guardar(): void {
    if (!this.hayCambios() || this.guardando()) return;
    this.guardando.set(true);
    this.error.set(null);
    this.mensaje.set(null);

    // Solo se mandan las claves que cambiaron: así un guardado no pisa lo que
    // otra persona haya cambiado entretanto en un campo que aquí no se tocó.
    const cambios: Record<string, string | null> = {};
    for (const k of Object.keys(this.valores)) {
      if (this.valores[k] !== this.original[k]) {
        const v = String(this.valores[k] ?? '').trim();
        cambios[k] = v === '' ? null : v;
      }
    }

    this.tienda.guardarConfiguracion(cambios).subscribe({
      next: (o) => {
        this.opciones.set(o);
        this.valores = Object.fromEntries(o.map((x) => [x.clave, x.valor ?? '']));
        this.original = { ...this.valores };
        this.guardando.set(false);
        this.mensaje.set('Listo, se guardó.');
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.guardando.set(false);
      },
    });
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
