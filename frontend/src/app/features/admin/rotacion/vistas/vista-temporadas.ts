import { Component, computed, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TemporadasRotacion } from '../../../../core/models/rotacion.models';
import { FilaCalor, MapaCalorMeses } from '../../../../shared/charts/mapa-calor-meses';
import { MESES, MESES_CORTOS, cap, conCalculos, conTemporada, cuantoTiempo, kilos, mesAnio } from '../rotacion-ui';

/**
 * ROTACIÓN · TEMPORADAS: qué hilo se vende en qué mes (el mapa de calor), el
 * calendario de compras de cada año y qué se mueve en cada temporada. Con menos
 * de un año de ventas enseña los kilos por mes que haya, sin colores ni
 * calendario, y lo dice en lugar de adivinar.
 */
@Component({
  selector: 'app-vista-temporadas',
  imports: [RouterLink, MapaCalorMeses],
  templateUrl: './vista-temporadas.html',
  styleUrls: ['./vistas.scss', './vista-temporadas.scss'],
})
export class VistaTemporadas {
  readonly datos = input.required<TemporadasRotacion>();
  readonly cargando = input(false);
  readonly filtro = output<Record<string, string | number | null>>();

  readonly comoTabla = signal(false);

  readonly MESES_CORTOS = MESES_CORTOS;
  readonly kilos = kilos;

  /** El que MÁS se aleja de los parejos: la frase vale para todos (antes, el del primero). */
  masSeAleja(parejos: { se_aleja: number }[]): number {
    return Math.max(0, ...parejos.map((p) => Number(p.se_aleja) || 0));
  }
  readonly cap = cap;

  readonly nivel = computed(() => this.datos().historia.nivel);
  readonly conCalculos = computed(() => conCalculos(this.nivel()));
  readonly conTemporada = computed(() => conTemporada(this.nivel()) && this.datos().con_temporadas);

  /** "2025, año completo", "2026, hasta octubre", "2024, desde marzo". */
  etiquetaAnio(a: { anio: number; completo: boolean; en_curso: boolean; hasta_mes: number | null; meses: number }): string {
    if (a.completo) return `${a.anio}, año completo`;
    if (a.en_curso && a.hasta_mes) return `${a.anio}, hasta ${MESES[a.hasta_mes - 1]}`;
    return `${a.anio}, ${a.meses} ${a.meses === 1 ? 'mes' : 'meses'}`;
  }

  /** Lo que dice el aviso de arriba según cuánta historia hay. */
  readonly aviso = computed(() => {
    const h = this.datos().historia;
    if (h.nivel === 'sin_temporada') {
      return `Hay ventas desde ${mesAnio(h.desde)}: la temporada se ve con un año completo. Por ahora, los kilos de cada mes que hay.`;
    }
    if (h.nivel === 'completa') {
      return `Hay ventas desde ${mesAnio(h.desde)}: ${cuantoTiempo(h.dias)}. La temporada ya se puede ver, y se va a confiar más cuando haya dos años completos.`;
    }
    return null;
  });

  readonly subtitulo = computed(() => {
    const d = this.datos();
    const cual = d.elegido === 'promedio' ? 'el promedio de los dos años' : String(d.elegido);
    return this.conTemporada()
      ? `Kilos vendidos en ${cual}. El color compara cada mes contra un mes normal de ese mismo hilo: más oscuro, se vendió más.`
      : `Kilos vendidos en ${cual}, mes por mes.`;
  });

  /** Los hilos que se vendieron ese año (los que no, van nombrados abajo, no en ceros). */
  readonly conVenta = computed(() => this.datos().hilos.filter((h) => h.total > 0));
  readonly sinVenta = computed(() => this.datos().hilos.filter((h) => !(h.total > 0)));

  readonly filas = computed<FilaCalor[]>(() =>
    this.conVenta().map((h) => ({
      id: h.producto_id,
      nombre: h.hilo,
      meses: h.meses.map((m) => ({ kg: m.kg, tramo: m.tramo, en_curso: m.en_curso })),
      mejorMes: h.mejor_mes,
      total: h.total,
      temporada: h.temporada,
    }))
  );

  readonly total = computed(() => this.datos().total);

  /** El calendario: cada renglón con sus 12 celdas (temporada, pedir, llega). */
  readonly calendario = computed(() =>
    this.datos().calendario.map((c) => ({
      ...c,
      celdas: Array.from({ length: 12 }, (_, i) => ({
        temporada: c.temporada.includes(i),
        pedir: c.mes_pedir === i + 1,
        llega: c.mes_llega === i + 1,
      })),
    }))
  );

  /** "Se mueve ROJO 2/30" o "Se mueven 4 hilos". */
  titulo(t: { hilos: { hilo: string }[] }): string {
    return t.hilos.length === 1 ? `Se mueve ${t.hilos[0].hilo}` : `Se mueven ${t.hilos.length} hilos`;
  }

  elegirTienda(id: number | null): void {
    this.filtro.emit({ tienda: id });
  }

  elegirAnio(a: number | 'promedio'): void {
    this.filtro.emit({ anio: a });
  }

  readonly MESES = MESES;
}
