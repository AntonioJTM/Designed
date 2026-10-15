import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { VentasService } from '../../../core/services/ventas.service';
import { SesionCaja } from '../../../core/models/ventas.models';

/**
 * A QUÉ TURNO ENTRA EL EFECTIVO que recibe una ventana fuera del punto de venta
 * (el abono a la cuenta y el anticipo). Lo comparten las dos: el efectivo
 * tiene que entrar a un turno abierto o el corte no cuadra.
 */

/** Los turnos abiertos de todas las cajas activas. Prueba caja por caja: una que falla no tumba la búsqueda. */
export function turnosAbiertos(ventas: VentasService): Promise<SesionCaja[]> {
  return new Promise<SesionCaja[]>((resolver) => {
    ventas.cajas().subscribe({
      next: (cajas) => {
        const activas = cajas.filter((c) => c.activo);
        if (activas.length === 0) return resolver([]);
        forkJoin(activas.map((c) => ventas.sesionAbierta(c.id).pipe(catchError(() => of(null))))).subscribe(
          (ss) => resolver(ss.filter((s): s is SesionCaja => !!s))
        );
      },
      error: () => resolver([]),
    });
  });
}

/**
 * El turno que se propone: el único abierto, o el de la caja con que se está
 * trabajando (la que recuerdan el punto de venta y Caja en
 * `localStorage['caja_sel']`). Con varios abiertos y ninguna elegida, ninguno:
 * adivinar descuadra dos cortes a la vez.
 */
export function turnoPropuesto(turnos: SesionCaja[]): number | null {
  if (turnos.length === 1) return turnos[0].id;
  let elegida: number | null = null;
  try {
    const v = Number(localStorage.getItem('caja_sel'));
    elegida = Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    elegida = null;
  }
  return turnos.find((t) => Number(t.caja_id) === elegida)?.id ?? null;
}
