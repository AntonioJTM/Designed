import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { RotacionService } from '../../../core/services/rotacion.service';
import { HiloDetalle } from '../../../core/models/rotacion.models';
import { MESES, cap, cuantoTiempo, fechaLarga, kilos } from './rotacion-ui';

/** Un pedazo de un ejemplo: lo que va en negritas es el resultado. */
interface Trozo { t: string; b: boolean }
interface Paso { titulo: string; formula?: string; textos: string[]; ejemplo?: Trozo[]; cargar?: boolean }

const B = (t: string | number) => ({ negrita: String(t) });
/** `ej\`… ${B(x)} …\`` arma el ejemplo con lo de B() en negritas. */
function ej(s: TemplateStringsArray, ...v: (string | number | { negrita: string })[]): Trozo[] {
  const out: Trozo[] = [];
  s.forEach((x, i) => {
    if (x) out.push({ t: x, b: false });
    if (i < v.length) {
      const val = v[i];
      out.push(typeof val === 'object' ? { t: val.negrita, b: true } : { t: String(val), b: false });
    }
  });
  return out;
}
const n2 = (x: number) => x.toLocaleString('es-MX', { maximumFractionDigits: 2 });

/**
 * «¿CÓMO SE CALCULA?» de Rotación de inventario: los 7 pasos, cada uno con los
 * números de VERDAD del hilo que más se vende hoy (los pide al abrir). Sin
 * historia suficiente para un paso, se queda con la explicación sola.
 */
@Component({
  selector: 'app-como-se-calcula-modal',
  host: { '(document:keydown.escape)': 'cerrado.emit()' },
  template: `
    <!-- No se cierra al hacer clic en el fondo; sale con la ✕, "Entendido" o Escape. -->
    <div class="modal-overlay">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="titulo-calculo">
        @if (cargando()) { <div class="modal-cargando"><span class="spinner"></span></div> }
        <div class="modal-head">
          <div>
            <h2 id="titulo-calculo">¿Cómo se calcula?</h2>
            <p class="muted sub">{{ h() ? 'Con el ejemplo de ' + h()!.hilo.hilo + '. ' : '' }}Todo en kilos; aquí no entra dinero.</p>
          </div>
          <button type="button" class="modal-cerrar" (click)="cerrado.emit()" aria-label="Cerrar">✕</button>
        </div>
        <div class="modal-body">
          <ol class="pasos">
            @for (p of pasos(); track p.titulo; let i = $index) {
              <li class="paso">
                <span class="num" aria-hidden="true">{{ i + 1 }}</span>
                <div class="paso-cuerpo">
                  <h3>{{ p.titulo }}</h3>
                  @if (p.formula) { <p class="formula">{{ p.formula }}</p> }
                  @for (t of p.textos; track $index) { <p>{{ t }}</p> }
                  @if (p.ejemplo?.length) {
                    <p class="ejemplo">@for (x of p.ejemplo; track $index) {@if (x.b) {<b>{{ x.t }}</b>} @else {<span>{{ x.t }}</span>}}</p>
                  }
                  @if (p.cargar && puedeCargar()) {
                    <div class="cargar">
                      <button type="button" class="btn btn-ghost" (click)="cargarAnteriores.emit()">Cargar ventas de años anteriores</button>
                      <span class="pill azul">Nuevo</span>
                    </div>
                  }
                </div>
              </li>
            }
          </ol>
        </div>
        <div class="modal-foot">
          <span class="nota">Los números se recalculan solos cada vez que se abre la pantalla.</span>
          <button type="button" class="btn btn-primary" (click)="cerrado.emit()">Entendido</button>
        </div>
      </div>
    </div>
  `,
  styles: `
    .modal { max-width: 760px; }
    .modal-head .sub { margin: 4px 0 0; font-size: 0.875rem; }
    .pasos { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 22px; }
    .paso { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 14px; }
    .num {
      display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 999px;
      background: var(--acento-tenue); color: var(--acento); font-weight: 600; font-size: 0.875rem; font-variant-numeric: tabular-nums;
    }
    .paso-cuerpo { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .paso-cuerpo h3 { margin: 3px 0 2px; font-size: 1rem; font-weight: 600; }
    .paso-cuerpo p { margin: 0; font-size: 0.875rem; line-height: 1.5; color: var(--tinta-2); }
    .formula {
      padding: 8px 12px; border-radius: 6px; background: var(--superficie-2); color: var(--tinta) !important;
      font-family: var(--mono); font-size: 0.8125rem !important;
    }
    .ejemplo { color: var(--tinta) !important; font-variant-numeric: tabular-nums; }
    .cargar { display: flex; align-items: center; gap: 10px; margin-top: 6px; flex-wrap: wrap; }
    .cargar .pill { font-size: 0.75rem; }
  `,
})
export class ComoSeCalculaModal implements OnInit {
  private readonly api = inject(RotacionService);

  readonly puedeCargar = input(false);
  readonly cerrado = output<void>();
  readonly cargarAnteriores = output<void>();

  readonly h = signal<HiloDetalle | null>(null);
  readonly cargando = signal(true);

  ngOnInit(): void {
    // El hilo que más se vende: sus números son los ejemplos.
    this.api.hilo(null).subscribe({
      next: (r) => { this.h.set(r); this.cargando.set(false); },
      error: () => this.cargando.set(false),
    });
  }

  readonly pasos = computed<Paso[]>(() => {
    const d = this.h();
    const a = d?.ajustes;
    const prov = a?.semanas_proveedor ?? 10;
    const colchon = a?.semanas_colchon ?? 3;
    const cubre = a?.meses_cubre ?? 4;
    const f = (dia: string | null | undefined) => (d ? fechaLarga(dia, d.hoy) : '');
    const h = d?.hilo;
    const color = h?.color ?? '';
    const pasos: Paso[] = [];

    // 1 · Qué cuenta como venta.
    const paso1: Paso = {
      titulo: 'Qué cuenta como venta',
      textos: ['Los kilos que salieron del inventario por una venta, con paquete y cono sumados. No cuentan las ventas canceladas, '
        + 'lo devuelto ni lo apartado que todavía no se entrega. Los envíos entre almacenes y las mermas no son venta. '
        + 'Es lo mismo que cuenta Reportes → Venta por color.'],
    };
    if (d && h && h.vendido_12m > 0) {
      const c = d.como_se_vende;
      const cuando = d.historia.dias < 365 && d.historia.desde ? `desde el ${f(d.historia.desde)}` : 'en los últimos 12 meses';
      const cuadra = Math.abs(c.paquete + c.cono + c.otro - h.vendido_12m) <= 1;
      paso1.ejemplo = cuadra && c.cono > 0
        ? ej`${color} vendió ${B(kilos(h.vendido_12m))} ${cuando}: ${kilos(c.paquete)} en paquete y ${kilos(c.cono)} en cono.`
        : ej`${color} vendió ${B(kilos(h.vendido_12m))} ${cuando}.`;
    }
    pasos.push(paso1);

    // 2 · Rotación.
    const paso2: Paso = {
      titulo: 'Rotación: cuántas veces al año se renueva',
      formula: 'Rotación = kilos vendidos en 12 meses ÷ kilos que hubo en promedio',
      textos: ['Lo que hubo en promedio sale del kardex: cuánto había al cerrar cada día, sumado y dividido entre los días.',
        'Más de 2: rápido · de 1 a 2: normal · menos de 1: lento, se queda más de un año.'],
    };
    const r = h?.rotacion;
    if (r && r.existencia_promedio && r.dias) {
      const kg = r.kg_ventana ?? Math.round((r.veces * r.existencia_promedio * Math.min(r.dias, 365)) / 365);
      paso2.ejemplo = r.dias < 365
        ? ej`En ${r.dias} días vendió ${kilos(kg)} y hubo ${kilos(r.existencia_promedio)} en promedio. Llevado a un año (× 365 ÷ ${r.dias}): ${B(n2(r.veces) + ' veces al año')}. O sea, se renueva cada 365 ÷ ${n2(r.veces)} = ${B((r.cada_dias ?? '—') + ' días')}.`
        : ej`${kilos(kg)} ÷ ${kilos(r.existencia_promedio)} = ${B(n2(r.veces) + ' veces al año')}. O sea, se renueva cada 365 ÷ ${n2(r.veces)} = ${B((r.cada_dias ?? '—') + ' días')}.`;
    }
    pasos.push(paso2);

    // 3 · Temporada.
    const paso3: Paso = {
      titulo: 'Temporada: qué tan fuerte es cada mes',
      formula: 'Qué tan fuerte = kilos de ese mes ÷ kilos de un mes normal del mismo hilo',
      textos: ['Un mes normal es lo que vendió en el año entre 12. Su temporada son los meses seguidos en que vende 30% o más arriba de un mes normal.'],
    };
    const x = d?.explica;
    if (x?.mejor && x.anual && x.mes_normal && d?.temporada) {
      const idx = Math.round((x.mejor.kg / x.mes_normal) * 100) / 100;
      const t = d.temporada;
      const cierre = t.num_meses > 0
        ? ` ${cap(t.texto)} ${t.num_meses === 1 ? 'pasa' : 'pasan'} del 30%: esa es su temporada.`
        : ' Ningún mes pasa del 30%: se vende parejo todo el año.';
      paso3.ejemplo = ej`En los últimos 12 meses completos ${color} vendió ${kilos(x.anual)}: un mes normal son ${kilos(x.mes_normal)}. En ${MESES[x.mejor.mes - 1]} de ${x.mejor.anio} vendió ${kilos(x.mejor.kg)}: ${n2(x.mejor.kg)} ÷ ${n2(x.mes_normal)} = ${B(n2(idx))}, o sea ${B(Math.round((idx - 1) * 100) + '% más')} que un mes normal.${cierre}`;
    } else if (d?.historia.desde) {
      paso3.textos.push(`Para eso hace falta un año completo de ventas, y hoy hay desde el ${f(d.historia.desde)}.`);
    }
    pasos.push(paso3);

    // 4 · Cuánto se espera vender.
    const paso4: Paso = {
      titulo: 'Cuánto se espera vender',
      formula: 'Se espera = lo del mismo mes del año pasado × cómo va este año contra el pasado',
      textos: [],
    };
    const tz = h?.tendencia;
    if (x?.siguiente && tz) {
      const s = x.siguiente;
      const mes = MESES[s.mes - 1];
      if (tz.comparable) {
        const pct = Math.round((tz.valor - 1) * 100);
        const va = pct === 0 ? 'va igual (× 1)' : pct > 0 ? `va ${pct}% arriba (× ${n2(tz.valor)})` : `va ${-pct}% abajo (× ${n2(tz.valor)})`;
        const topa = Math.abs(tz.actual / tz.anterior - tz.valor) > 0.01 ? ' (se topa: nunca más del doble ni menos de la mitad)' : '';
        paso4.ejemplo = ej`De enero a ${MESES[tz.hasta_mes - 1]} ${color} vendió ${kilos(tz.actual)} en ${tz.anio} y ${kilos(tz.anterior)} en ${tz.anio - 1}: ${va}${topa}. En ${mes} de ${s.base_anio} vendió ${kilos(s.base_kg)}, así que para este ${mes} se esperan ${n2(s.base_kg)} × ${n2(tz.valor)} = ${B(kilos(s.kg))}.`;
      } else {
        paso4.ejemplo = ej`Todavía no hay con qué comparar este año contra el pasado (hacen falta 3 meses de los dos), así que se toma igual (× 1). En ${mes} de ${s.base_anio} ${color} vendió ${kilos(s.base_kg)}: para este ${mes} se esperan ${B(kilos(s.kg))}.`;
      }
    } else {
      paso4.textos.push('Sin un año completo de ventas se usa lo que se vendió en promedio las últimas 8 semanas (con 4, si no hay más).');
      if (x?.promedio_semana != null) paso4.ejemplo = ej`Hoy ${color} vende unos ${B(kilos(x.promedio_semana, 1) + ' por semana')}.`;
    }
    pasos.push(paso4);

    // 5 · Cuándo pedir.
    const paso5: Paso = {
      titulo: 'Cuándo pedir',
      formula: 'Pedir a más tardar = el día en que se acaba − lo que tarda el proveedor − el colchón',
      textos: [],
    };
    if (d && h) {
      if (h.estado === 'sobra') {
        paso5.ejemplo = ej`Con ${kilos(h.hay.kg)} y unos ${kilos(h.se_vende_semana)} por semana, a ${color} le alcanza para más de un año: ${B('no hace falta pedir')}.`;
      } else if (h.se_acaba && h.pedir) {
        const fin = h.pedir < d.hoy ? ' Como esa fecha ya pasó, sale «Pedir ya».'
          : h.estado === 'ya' ? ' Como cae en los próximos 7 días, sale «Pedir ya».'
            : h.estado === 'pronto' ? ` Como cae en los próximos 3 meses, sale «En ${MESES[Number(h.pedir.slice(5, 7)) - 1]}».`
              : ' Para eso falta: sale «Con calma».';
        paso5.ejemplo = ej`Con ${kilos(h.hay.kg)} y lo que se espera vender cada semana, ${color} se acaba hacia el ${B(f(h.se_acaba))}. Menos ${prov} semanas del proveedor y ${colchon} de colchón (${prov + colchon} semanas, ${(prov + colchon) * 7} días): ${B(f(h.pedir))}.${fin}`;
      }
    }
    pasos.push(paso5);

    // 6 · Cuánto pedir.
    const paso6: Paso = {
      titulo: 'Cuánto pedir',
      formula: `Cuánto = lo que se venderá desde que llega hasta ${cubre} ${cubre === 1 ? 'mes' : 'meses'} después, más ${colchon} semanas de colchón, menos lo que quede cuando llegue`,
      textos: [],
    };
    const p = d?.pedido_hoy;
    if (d && h && p && p.kg > 0) {
      const paq = p.paquetes && h.hay.peso_paquete ? `, unos ${p.paquetes.toLocaleString('es-MX')} paquetes de ${n2(h.hay.peso_paquete)} kg` : '';
      const queda = p.quedan_al_llegar > 0 ? `todavía hay ${kilos(p.quedan_al_llegar)}` : 'para entonces ya se habrá acabado (quedan 0 kg)';
      paso6.ejemplo = ej`Si se pide hoy, llega hacia el ${f(p.llega)} y ${queda}. De ahí a ${cubre} ${cubre === 1 ? 'mes' : 'meses'} y ${colchon} semanas se esperan vender unos ${kilos(p.se_vendera)}: ${n2(p.se_vendera)} − ${n2(p.quedan_al_llegar)} ≈ ${B(kilos(p.kg))}${paq}.`;
    }
    pasos.push(paso6);

    // 7 · Cuánta historia hace falta.
    const hoyHay = d?.historia.desde
      ? `Hoy hay ventas desde el ${f(d.historia.desde)} (${cuantoTiempo(d.historia.dias)}).`
      : 'Todavía no hay ventas.';
    pasos.push({
      titulo: 'Cuánta historia hace falta',
      textos: ['La rotación y «Qué pedir» funcionan desde el primer mes. La temporada necesita un año completo de ventas, y se confía con dos. '
        + 'Si hay ventas de años anteriores en Excel o en libretas, se pueden cargar en kilos, por mes y por hilo.', hoyHay],
      cargar: true,
    });
    return pasos;
  });
}
