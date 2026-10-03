import { Component, computed, input } from '@angular/core';
import { HabitosCliente } from '../../../../core/models/rediseno.models';
import { COLOR, ESTADO_RITMO, diaEnPlural, estadoRitmo, fechaCorta, fechaLarga, horaRango, sumarDias } from '../clientes-ui';

/** La ventana de la línea: la misma de `habitos.visitas_90`. */
const VENTANA = 90;

/**
 * "Sus visitas": los días que vino en los últimos 90 días, sobre una línea que
 * termina HOY, y el hueco desde su última compra pintado con el color de cómo
 * va (naranja si se está enfriando). Debajo, su costumbre en palabras.
 *
 * La usan el Resumen y la pestaña Frecuencia de compra del expediente.
 */
@Component({
  selector: 'app-linea-visitas',
  template: `
    <div class="linea" role="img" [attr.aria-label]="m().aria">
      <div class="base"></div>
      @if (m().hueco; as h) {
        <div class="hueco" [style.left.%]="h.desde" [style.background]="m().suave"></div>
        @if (h.etiqueta) {
          <span class="hueco-texto" [style.left.%]="h.medio" [style.color]="m().tintaHueco">{{ h.etiqueta }}</span>
        }
      }
      @for (v of m().puntos; track v.dia) {
        <div class="punto" [style.left.%]="v.pos" [title]="v.titulo"></div>
      }
      <div class="hoy"></div>
      @for (e of m().marcas; track e.texto) {
        <span class="marca" [style.left.%]="e.pos" [class.inicio]="e.pos === 0">{{ e.texto }}</span>
      }
      <span class="marca fin">hoy</span>
    </div>
    <div class="pie">
      @if (m().costumbre; as c) {
        <span>Viene los <b>{{ c.dia }}</b>, de <b>{{ c.hora }}</b></span>
      }
      <span>{{ m().compras }}</span>
      @if (m().volver) { <span>{{ m().volver }}</span> }
    </div>
  `,
  styles: `
    :host { display: block; }
    .linea { position: relative; height: 64px; margin: 6px 6px 0; }
    .base { position: absolute; left: 0; right: 0; top: 23px; height: 2px; background: #E6E8EC; }
    .hueco { position: absolute; top: 20px; height: 8px; right: 0; border-radius: 4px; }
    .hueco-texto { position: absolute; top: 0; transform: translateX(-50%); font-size: 12px; font-weight: 600; white-space: nowrap; }
    .punto { position: absolute; top: 17px; width: 14px; height: 14px; margin-left: -7px; border-radius: 50%; background: #2a78d6; box-shadow: 0 0 0 2px #fff; }
    .hoy { position: absolute; top: 13px; right: 0; width: 2px; height: 22px; background: var(--tinta); }
    .marca { position: absolute; top: 44px; transform: translateX(-50%); font-size: 12px; color: var(--tinta-3); white-space: nowrap; }
    .marca.inicio { transform: none; }
    .marca.fin { left: auto; right: 0; transform: none; font-weight: 600; color: var(--tinta); }
    .pie {
      display: flex; flex-wrap: wrap; gap: 8px 22px; font-size: 13px; color: var(--tinta-2);
      border-top: 1px solid var(--borde-suave); padding-top: 12px; margin-top: 14px;
    }
    .pie b { color: var(--tinta); font-weight: 600; }
  `,
})
export class LineaVisitas {
  readonly habitos = input.required<HabitosCliente>();

  readonly m = computed(() => {
    const h = this.habitos();
    const pos = (hace: number) => ((VENTANA - Math.min(VENTANA, Math.max(0, hace))) / VENTANA) * 100;
    const estado = estadoRitmo(h.ritmo, h.dias_sin_venir);
    const tono = estado ? ESTADO_RITMO[estado] : ESTADO_RITMO.bien;

    const puntos = h.visitas_90.map((v) => ({ dia: v.dia, pos: pos(v.hace), titulo: fechaLarga(v.dia) }));

    // El hueco: de su última compra a hoy. Si la última es de hace más de 90
    // días, cubre toda la línea.
    let hueco: { desde: number; medio: number; etiqueta: string } | null = null;
    if (h.dias_sin_venir !== null && h.dias_sin_venir > 0) {
      const desde = pos(h.dias_sin_venir);
      hueco = {
        desde,
        medio: (desde + 100) / 2,
        // Solo se escribe si cabe: un número encimado es peor que ninguno.
        etiqueta: 100 - desde >= 12 ? `${h.dias_sin_venir} días` : '',
      };
    }

    // Marcas de abajo: el arranque de la ventana y el día 1 de cada mes, sin
    // encimarse con las puntas.
    const hoy = new Date();
    const hoyTxt = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    const marcas: { pos: number; texto: string }[] = [{ pos: 0, texto: fechaCorta(sumarDias(hoyTxt, -VENTANA)) }];
    for (let i = 0; i < 4; i++) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      const hace = Math.round((hoy.getTime() - d.getTime()) / 864e5);
      const p = pos(hace);
      if (hace <= VENTANA && p >= 12 && p <= 86) {
        marcas.push({ pos: p, texto: fechaCorta(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`) });
      }
    }

    const sin = h.dias_sin_venir;
    let aria = 'Todavía no compra.';
    if (sin !== null) {
      aria = `${h.visitas_90.length} días con compra en los últimos 90 días; ${sin} días sin venir hasta hoy.`;
    }

    let volver = '';
    if (h.ritmo && h.ultima) {
      const cuando = sumarDias(h.ultima, h.ritmo);
      volver = sin !== null && sin > h.ritmo ? `Debería haber vuelto el ${fechaCorta(cuando)}` : `Debería volver el ${fechaCorta(cuando)}`;
    }

    return {
      puntos,
      hueco,
      marcas,
      suave: tono.suave,
      tintaHueco: estado === 'frio' || estado === 'perdido' ? COLOR.tintaAlerta : 'var(--tinta-2)',
      aria,
      costumbre: h.dia_de_costumbre
        ? { dia: diaEnPlural(h.dia_de_costumbre), hora: horaRango(h.hora_de_costumbre) }
        : null,
      compras: `${h.ultimos_90?.compras ?? h.visitas_90.length} ${(h.ultimos_90?.compras ?? h.visitas_90.length) === 1 ? 'compra' : 'compras'} en 90 días`,
      volver,
    };
  });
}
