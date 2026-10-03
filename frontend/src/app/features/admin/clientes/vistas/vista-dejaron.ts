import { Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ClientesEnfriados } from '../../../../core/models/analisis.models';
import { AuthService } from '../../../../core/services/auth.service';
import { DineroPipe } from '../../../../shared/dinero.pipe';
import { COLOR, fechaCorta, pesos, plural } from '../clientes-ui';

/** Contra qué corte se mide "dejó de venir". 60 es el del aviso de la campana. */
export const CORTES_SIN_VENIR = [30, 60, 90, 180] as const;
export type CorteSinVenir = (typeof CORTES_SIN_VENIR)[number];

/**
 * Pestaña DEJARON DE VENIR: los que te compraban (2 veces o más) y llevan 60
 * días o más sin venir. Son EXACTAMENTE los del aviso de la campana —la misma
 * consulta—, porque al tocar "Ver quiénes" la pantalla tiene que decir quiénes
 * (lo pidió el usuario el 2026-10-03: antes la campana llevaba a Frecuencia de
 * compra, que mide otra cosa, y "no me dice quiénes ya no han venido").
 *
 * Frecuencia compara a cada quien contra SU ritmo; aquí el corte es parejo para
 * todos: "quiénes no han vuelto en dos meses". Van primero los que más te
 * compraban: con ellos vale más la llamada.
 */
@Component({
  selector: 'app-vista-dejaron',
  imports: [RouterLink, DineroPipe],
  templateUrl: './vista-dejaron.html',
  host: { class: 'pila' },
  styles: `
    .corte { flex: 0 0 auto; }
    .corte select { min-width: 210px; }
    table.grid.dejaron { min-width: 720px; }
    .chico { font-size: 12px; margin-top: 2px; }
    .tel { margin-top: 2px; font-size: 13px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .nota-corte { margin: 12px 0 0; font-size: 13px; }
  `,
})
export class VistaDejaron {
  private readonly auth = inject(AuthService);

  readonly datos = input.required<ClientesEnfriados>();
  /** El corte de días que se pide. */
  readonly sinVenir = input<CorteSinVenir>(60);
  readonly cambiarCorte = output<CorteSinVenir>();

  readonly CORTES = CORTES_SIN_VENIR;
  readonly fechaCorta = fechaCorta;
  readonly pesos = pesos;
  /** "Venderle" abre el punto de venta con el cliente ya elegido: solo a quien lo puede abrir. */
  readonly vePos = computed(() => this.auth.puede('ver:pos'));

  readonly kpis = computed(() => {
    const d = this.datos();
    const primero = [...d.clientes].sort((a, b) => Number(b.total_comprado) - Number(a.total_comprado))[0];
    return [
      {
        etiqueta: 'Dejaron de venir',
        valor: String(d.num_clientes),
        pie: d.num_clientes
          ? `te compraron ${d.min_compras} veces o más y llevan ${d.dias} días o más sin venir`
          : `todos los que compraban han vuelto en los últimos ${d.dias} días`,
        punto: COLOR.alerta,
      },
      {
        etiqueta: 'Te compraban en total',
        valor: pesos(d.venta_en_riesgo),
        pie: 'lo que te compraron mientras venían: es lo que está en juego',
        punto: COLOR.serie1,
      },
      {
        etiqueta: 'El que más te compraba',
        valor: primero ? primero.nombre_comercial || primero.nombre : '—',
        pie: primero
          ? `${pesos(primero.total_comprado)} en ${plural(Number(primero.num_compras), 'compra', 'compras')} · hace ${primero.dias_sin_venir} días`
          : 'nadie',
        punto: COLOR.ambar,
      },
    ];
  });

  /** Ordenados por lo que compraban: arriba, la llamada que más vale. */
  readonly lista = computed(() =>
    [...this.datos().clientes].sort((a, b) => Number(b.total_comprado) - Number(a.total_comprado))
  );

  elegirCorte(valor: string): void {
    const n = Number(valor) as CorteSinVenir;
    if (CORTES_SIN_VENIR.includes(n)) this.cambiarCorte.emit(n);
  }

  num(v: unknown): number {
    return Number(v ?? 0);
  }
}
