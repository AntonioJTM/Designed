import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TiendaService } from '../../../core/services/tienda.service';
import { OpcionConfiguracion } from '../../../core/models/tienda.models';
import { ApiError } from '../../../core/models/auth.models';

/**
 * Los datos de la tienda que el administrador cambia sin tocar código: cuánto
 * se cobra por enviar, a qué cuenta deposita el cliente y dónde se recoge el
 * pedido. Los lee el checkout de la tienda en línea.
 *
 * Es una PANTALLA y no un modal —a diferencia de materiales o productos— porque
 * no hay listado sobre el que abrirse: esto es la única vista de estos datos.
 *
 * Las claves las define la migración, no esta pantalla: se dibuja lo que
 * devuelve el servidor, con su descripción. Agregar una opción es una línea de
 * SQL, y aparece aquí sola.
 */
@Component({
  selector: 'app-configuracion',
  imports: [FormsModule],
  templateUrl: './configuracion.html',
})
export class Configuracion implements OnInit {
  private readonly tienda = inject(TiendaService);

  readonly opciones = signal<OpcionConfiguracion[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  /** Lo tecleado, por clave. Se compara contra lo cargado para saber qué cambió. */
  valores: Record<string, string> = {};
  private original: Record<string, string> = {};

  /**
   * Agrupa las claves como se piensan, no como se guardan. El prefijo de la
   * clave dice a qué grupo va; una clave nueva que no encaje cae en "Otros" y
   * se ve igual, en vez de desaparecer.
   */
  readonly grupos = [
    { titulo: 'Envío a domicilio', prefijos: ['envio_'] },
    { titulo: 'Pago por transferencia', prefijos: ['transferencia_'] },
    { titulo: 'Datos de la tienda', prefijos: ['tienda_'] },
  ];

  ngOnInit(): void {
    this.cargar();
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

  /** Las opciones de un grupo, en el orden en que vinieron. */
  opcionesDe(prefijos: string[]): OpcionConfiguracion[] {
    return this.opciones().filter((o) => prefijos.some((p) => o.clave.startsWith(p)));
  }

  /** Las que no encajaron en ningún grupo. */
  otras(): OpcionConfiguracion[] {
    const conocidos = this.grupos.flatMap((g) => g.prefijos);
    return this.opciones().filter((o) => !conocidos.some((p) => o.clave.startsWith(p)));
  }

  /** Si algo cambió; sin eso el botón de guardar no tiene nada que hacer. */
  hayCambios(): boolean {
    return Object.keys(this.valores).some((k) => this.valores[k] !== this.original[k]);
  }

  /** El costo de envío es dinero: se captura como número. */
  esNumero(clave: string): boolean {
    return clave === 'envio_costo_fijo';
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
        cambios[k] = this.valores[k].trim() === '' ? null : this.valores[k].trim();
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
