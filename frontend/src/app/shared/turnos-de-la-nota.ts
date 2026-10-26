import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { VentasService } from '../core/services/ventas.service';
import { SesionCaja } from '../core/models/ventas.models';

/** Un turno de caja abierto, con la tienda de su caja. */
export interface TurnoAbierto extends SesionCaja {
  almacen_id: number | null;
  almacen: string | null;
}

/**
 * EL TURNO DONDE CAE EL EFECTIVO DE UNA NOTA (2026-10-26, auditoría): «Registrar su
 * pago» y «Entregar» buscan los turnos abiertos de las cajas que ve quien cobra.
 * Antes, con UN solo turno abierto lo elegían aunque fuera de OTRA tienda: el pago de
 * una nota de Moroleón caía en el corte de la Matriz sin preguntar. Ahora traen la
 * tienda de cada caja; solo se elige solo el de la tienda de la nota, y uno de otra
 * tienda se elige a mano (con aviso). Prueba caja por caja: una que falla no tumba la
 * búsqueda.
 */
export function buscarTurnos(ventas: VentasService): Promise<TurnoAbierto[]> {
  return new Promise<TurnoAbierto[]>((resolver) => {
    ventas.cajas().subscribe({
      next: (cajas) => {
        const activas = cajas.filter((c) => c.activo);
        if (activas.length === 0) return resolver([]);
        forkJoin(activas.map((c) => ventas.sesionAbierta(c.id).pipe(catchError(() => of(null))))).subscribe((ss) => {
          const turnos: TurnoAbierto[] = [];
          ss.forEach((s, i) => {
            if (!s) return;
            const caja = activas[i];
            turnos.push({ ...s, almacen_id: caja.almacen_id ?? null, almacen: caja.almacen ?? null });
          });
          resolver(turnos);
        });
      },
      error: () => resolver([]),
    });
  });
}

/** El turno de OTRA tienda que la de la nota. */
export function deOtraTienda(t: TurnoAbierto | null | undefined, almacenNota: number | null | undefined): boolean {
  return !!t && almacenNota != null && t.almacen_id != null && Number(t.almacen_id) !== Number(almacenNota);
}

/**
 * El que se propone: el ÚNICO de la tienda de la nota, o el de la caja con que se
 * trabaja (`caja_sel`) si es de esa tienda. Ninguno de otra tienda se elige solo.
 */
export function turnoPropuesto(turnos: TurnoAbierto[], almacenNota: number | null | undefined): number | null {
  const aqui = turnos.filter((t) => !deOtraTienda(t, almacenNota));
  if (aqui.length === 1) return aqui[0].id;
  let elegida: number | null = null;
  try {
    const v = Number(localStorage.getItem('caja_sel'));
    elegida = Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    elegida = null;
  }
  return aqui.find((t) => Number(t.caja_id) === elegida)?.id ?? null;
}

/** Hay un solo turno abierto y es de la tienda de la nota: no hay qué preguntar. */
export function turnoUnicoAqui(turnos: TurnoAbierto[], almacenNota: number | null | undefined): boolean {
  return turnos.length === 1 && !deOtraTienda(turnos[0], almacenNota);
}

/** Cómo se llama en el selector: la caja, y su tienda si es otra. */
export function nombreTurno(t: TurnoAbierto, almacenNota: number | null | undefined): string {
  const caja = t.caja || `Caja ${t.caja_id}`;
  return deOtraTienda(t, almacenNota) ? `${caja} · otra tienda: ${t.almacen ?? 'sin nombre'}` : caja;
}

/** Si el elegido es de otra tienda, en qué corte cae el efectivo. */
export function avisoOtraTienda(
  turnos: TurnoAbierto[], turnoId: number | null, almacenNota: number | null | undefined, almacenNombre: string | null | undefined
): string | null {
  const t = turnos.find((x) => x.id === turnoId);
  if (!deOtraTienda(t, almacenNota)) return null;
  return `Esta nota es de «${almacenNombre ?? 'otra tienda'}»: el efectivo entra al corte de ${t!.caja || 'esa caja'}` +
    ` («${t!.almacen ?? 'otra tienda'}»), no al de su tienda.`;
}
