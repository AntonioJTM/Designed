import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HiloRotacion, ResumenRotacion } from '../../../../core/models/rotacion.models';
import { ColumnasComparadas, MarcaMeses, MesComparado } from '../../../../shared/charts/columnas-comparadas';
import {
  MESES, MESES_CORTOS, cap, conCalculos, conTemporada, contraAnio, cuantoTiempo, estadoTexto, fechaLarga, kilos, mesAnio,
  paquetesAprox, seMueveTexto, semanas, toneladas,
} from '../rotacion-ui';

type Orden = 'kg' | 'rapido' | 'lento' | 'crece';

/** Los meses seguidos de una marca, partidos si cruzan de diciembre a enero. */
export function tramosDeMeses(meses: number[]): number[][] {
  const tramos: number[][] = [];
  for (const m of meses) {
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && m === ultimo[ultimo.length - 1] + 1) ultimo.push(m);
    else tramos.push([m]);
  }
  return tramos;
}

const NUM = ['', 'uno', 'los dos', 'los tres', 'los cuatro', 'los cinco'];

/**
 * ROTACIÓN · RESUMEN: cuánto se vende, cuánto hay, qué tan rápido se mueve, cuándo
 * se vende más, qué hay que pedir pronto y qué hilos se mueven más.
 */
@Component({
  selector: 'app-vista-resumen',
  imports: [FormsModule, RouterLink, ColumnasComparadas],
  templateUrl: './vista-resumen.html',
  styleUrls: ['./vistas.scss', './vista-resumen.scss'],
})
export class VistaResumen {
  readonly datos = input.required<ResumenRotacion>();
  readonly cargando = input(false);
  readonly filtro = output<Record<string, string | number | null>>();

  readonly orden = signal<Orden>('kg');
  readonly comoTabla = signal(false);

  readonly kilos = kilos;
  readonly toneladas = toneladas;
  readonly paquetesAprox = paquetesAprox;
  readonly semanas = semanas;
  readonly estadoTexto = estadoTexto;
  readonly seMueveTexto = seMueveTexto;
  readonly contraAnio = contraAnio;
  readonly fechaLarga = fechaLarga;

  readonly nivel = computed(() => this.datos().historia.nivel);
  readonly conCalculos = computed(() => conCalculos(this.nivel()));
  readonly conTemporada = computed(() => conTemporada(this.nivel()));

  /** "Ventas desde enero de 2025 · al día de hoy, 21 de octubre". */
  readonly desdeTexto = computed(() => {
    const d = this.datos();
    const hoy = fechaLarga(d.hoy, d.hoy);
    return d.historia.desde ? `Ventas desde ${mesAnio(d.historia.desde)} · al día de hoy, ${hoy}` : `Al día de hoy, ${hoy}`;
  });

  readonly surte = computed(() => this.datos().alcance.surte);

  readonly kpis = computed(() => {
    const d = this.datos();
    const c = d.cifras;
    const cambio = c.contra_anio_pasado != null ? contraAnio(c.contra_anio_pasado) : null;
    const meses = c.rotacion && c.rotacion.veces > 0 ? Math.round(12 / c.rotacion.veces) : null;
    const corta = c.rotacion_dias != null && c.rotacion_dias < 365;
    return [
      {
        etiqueta: this.surte() ? 'Surtido en 12 meses' : 'Vendido en 12 meses', tono: 'tono-acento',
        valor: toneladas(c.vendido_12m),
        // Compara de enero al último mes completo, este año contra el pasado (2026-10-26: decía "el año anterior").
        pie: `${kilos(c.vendido_12m)}${cambio ? ` · ${cambio.texto.replace(/^[↑↓] /, '').toLowerCase()} que el año pasado, de enero al mes pasado` : ''}`,
      },
      {
        etiqueta: 'Hay hoy', tono: 'tono-tinta', valor: toneladas(c.hay_kg),
        pie: `${kilos(c.hay_kg)}${c.hay_paquetes ? ` · unos ${c.hay_paquetes.toLocaleString('es-MX')} paquetes` : ''}${c.almacenes_con ? ` en ${c.almacenes_con} ${c.almacenes_con === 1 ? 'almacén' : 'almacenes'}` : ''}`,
      },
      {
        etiqueta: 'Rotación', tono: 'tono-acento',
        valor: c.rotacion ? `${c.rotacion.veces.toLocaleString('es-MX')} veces al año` : '—',
        pie: c.rotacion
          ? `${meses != null ? `El hilo dura en bodega unos ${meses} ${meses === 1 ? 'mes' : 'meses'}` : ''}${corta ? ` · calculada con ${Math.floor(c.rotacion_dias! / 7)} semanas de ventas` : ''}`
          : 'Sin existencia con qué medirla',
      },
      {
        etiqueta: 'Alcanza para', tono: 'tono-aviso', valor: semanas(c.alcanza_semanas),
        pie: c.se_vende_semana != null ? `Al ritmo de las próximas 4 semanas: ${kilos(c.se_vende_semana)} por semana` : '',
      },
    ];
  });

  /** La gráfica: los dos años, mes por mes. */
  readonly meses = computed<MesComparado[]>(() => {
    const m = this.datos().meses;
    return m.actual.map((a, i) => ({
      etiqueta: MESES_CORTOS[i], nombre: cap(MESES[i]), anterior: m.anterior[i].kg, actual: a.kg, origen: a.origen,
    }));
  });

  readonly textoEnCurso = computed(() => {
    const m = this.datos().meses;
    return `${cap(MESES[m.mes_actual - 1])} ${m.anio_actual}, va en curso (hasta el ${m.corte})`;
  });

  readonly marcas = computed<MarcaMeses[]>(() => {
    const t = this.datos().temporadas;
    if (!t) return [];
    const out: MarcaMeses[] = [];
    for (const [r, alta] of [[t.alta, true], [t.baja, false]] as const) {
      if (!r) continue;
      tramosDeMeses(r.meses).forEach((meses, i) => out.push({ texto: i === 0 ? (alta ? 'Temporada alta' : 'Temporada baja') : '', meses, alta }));
    }
    return out;
  });

  readonly tendenciaTexto = computed(() => {
    const t = this.datos().cifras.tendencia;
    if (!t.comparable) return null;
    const pct = Math.round((t.actual / t.anterior - 1) * 100);
    return {
      fuerte: `${t.anio} va ${Math.abs(pct)}% ${pct >= 0 ? 'arriba' : 'abajo'}`,
      resto: ` de ${t.anio - 1}, de enero a ${MESES[t.hasta_mes - 1]}.`,
    };
  });

  /** "Los cuatro juntos: 5.24 t". */
  readonly juntos = computed(() => {
    const p = this.datos().pedir_pronto;
    const n = p.lista.length;
    if (n < 2) return null;
    return `${cap(NUM[n] ?? `los ${n}`)} juntos:`;
  });

  /** Los que no se vendieron en los 12 meses: van en un renglón aparte, no en la tabla. */
  readonly quietos = computed(() => this.datos().ranking.filter((h) => !(h.vendido_12m > 0)));
  readonly kgQuietos = computed(() => this.quietos().reduce((s, h) => s + h.hay.kg, 0));

  readonly ranking = computed(() => {
    const filas = this.datos().ranking.filter((h) => h.vendido_12m > 0);
    const veces = (h: HiloRotacion) => h.rotacion?.veces ?? -1;
    switch (this.orden()) {
      case 'rapido': filas.sort((a, b) => veces(b) - veces(a)); break;
      case 'lento': filas.sort((a, b) => (a.rotacion?.veces ?? 1e9) - (b.rotacion?.veces ?? 1e9)); break;
      case 'crece': filas.sort((a, b) => (b.contra_anio_pasado ?? -1) - (a.contra_anio_pasado ?? -1)); break;
      default: filas.sort((a, b) => b.vendido_12m - a.vendido_12m);
    }
    const max = Math.max(1, ...filas.map((h) => h.vendido_12m));
    return filas.map((h) => ({ h, ancho: Math.max(h.vendido_12m > 0 ? 1 : 0, Math.round((h.vendido_12m / max) * 100)) }));
  });

  readonly totalRanking = computed(() => this.datos().ranking.reduce((s, h) => s + h.vendido_12m, 0));

  /** "Contra el año pasado: de enero a septiembre de cada año". */
  readonly contraTexto = computed(() => {
    const t = this.datos().cifras.tendencia;
    return t.hasta_mes >= 1 ? `Contra el año pasado: de enero a ${MESES[t.hasta_mes - 1]} de cada año` : '';
  });

  readonly historiaTexto = computed(() => cuantoTiempo(this.datos().historia.dias));

  /** "del 22 de octubre de 2025 al 21 de octubre de 2026". */
  readonly rangoRanking = computed(() => {
    const hoy = this.datos().hoy;
    const [a, m, d] = hoy.split('-').map(Number);
    const desde = new Date(Date.UTC(a, m - 1, d - 364));
    const conAnio = (dd: number, mm: number, aa: number) => `${dd} de ${MESES[mm - 1]} de ${aa}`;
    return `del ${conAnio(desde.getUTCDate(), desde.getUTCMonth() + 1, desde.getUTCFullYear())} al ${conAnio(d, m, a)}`;
  });

  elegirAlmacen(id: number | null): void {
    this.filtro.emit({ almacen: id });
  }

  elegirHilo(id: number | null): void {
    this.filtro.emit({ hilo: id });
  }
}
