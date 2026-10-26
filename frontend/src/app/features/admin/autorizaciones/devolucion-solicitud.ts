import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DetalleDevolucion, LineaDevuelta } from '../../../core/models/autorizaciones.models';
import { AuthService } from '../../../core/services/auth.service';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';
import { nombreLote, paquetes } from '../../../shared/lotes';

/**
 * QUÉ REGRESA, dentro de la solicitud de una devolución (2026-10-22, usuario:
 * "que muestre más detalle: qué cliente es, cuántos paquetes regresa, color y
 * lote, pesos e importe"). Lo arma el servidor con lo que se guardó al pedirla
 * (`pedidos/devolucion-solicitud.js`, el mismo cálculo que al registrarla) y
 * aquí solo se enseña: el cliente y la venta, cada hilo con sus paquetes por
 * lote (código de barras y peso) y lo suelto, el importe, y cómo se reparte.
 * Va abierto: una devolución trae pocos paquetes.
 */
@Component({
  selector: 'app-devolucion-solicitud',
  imports: [RouterLink, CantidadPipe, DineroPipe, FechaPipe],
  templateUrl: './devolucion-solicitud.html',
  styleUrl: './devolucion-solicitud.scss',
})
export class DevolucionSolicitud {
  private readonly auth = inject(AuthService);

  readonly dev = input.required<DetalleDevolucion>();

  /** La venta se abre solo si se puede ver Ventas. */
  readonly veVentas = computed(() => this.auth.puede('ver:pedidos'));

  readonly nombreLote = nombreLote;
  readonly paquetes = paquetes;

  /** "Paquete", "Conos", "Por kilo". */
  presentacion(l: LineaDevuelta): string {
    return l.tipo_presentacion === 'paquete' ? 'Paquete' : l.tipo_presentacion === 'cono' ? 'Conos' : 'Por kilo';
  }

  /** "16 kg sueltos · 10 conos · entran como conos". */
  textoSueltos(l: LineaDevuelta): string {
    const kg = `${l.kg_sueltos.toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg sueltos`;
    const conos = l.conos ? ` · ${l.conos} ${l.conos === 1 ? 'cono' : 'conos'}` : '';
    const como = l.tipo_presentacion === 'paquete' && l.sueltos_como === 'conos' ? ' · entran como conos' : '';
    return kg + conos + como;
  }

  /** De qué es lo que se debe de esta nota. */
  queDebe(): string {
    const t = this.dev().reparto.debe_esta_tipo;
    return t === 'nota' ? 'nota pendiente de pago' : t === 'credito' ? 'nota a crédito' : 'nota';
  }
}
