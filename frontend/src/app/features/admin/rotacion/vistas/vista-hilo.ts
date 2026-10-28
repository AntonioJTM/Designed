import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HiloDetalle } from '../../../../core/models/rotacion.models';
import { AuthService } from '../../../../core/services/auth.service';
import { ColumnasComparadas, MesComparado } from '../../../../shared/charts/columnas-comparadas';
import { ProyeccionSemanal } from '../proyeccion-semanal';
import {
  MESES, MESES_CORTOS, cap, conCalculos, contraAnio, diasEntre, estadoTexto, fechaLarga, kilos, paquetesAprox, semanas,
} from '../rotacion-ui';

/** "casi 3 veces", "el doble"… */
function veces(r: number): string {
  if (r >= 3.5) return `${Math.round(r)} veces`;
  if (r >= 2.8) return 'casi 3 veces';
  if (r >= 2.2) return 'más del doble';
  if (r >= 1.8) return 'casi el doble';
  return `${Math.round((r - 1) * 100)}% más`;
}

/**
 * ROTACIÓN · POR HILO: todo de un hilo. Cuándo pedirlo y cuánto (si se pide hoy),
 * cuánto se vende cada mes, su temporada, cuánto va a haber semana por semana,
 * cómo está en cada almacén, paquete contra cono y sus cargas del proveedor.
 */
@Component({
  selector: 'app-vista-hilo',
  imports: [RouterLink, ColumnasComparadas, ProyeccionSemanal],
  templateUrl: './vista-hilo.html',
  styleUrls: ['./vistas.scss', './vista-hilo.scss'],
})
export class VistaHilo {
  readonly datos = input.required<HiloDetalle>();
  readonly cargando = input(false);
  /** El botón a Surtir sucursal, solo a quien puede abrirla (Contabilidad no). */
  readonly puedeSurtir = inject(AuthService).puede('ver:surtir');

  readonly comoTabla = signal(false);
  readonly comoTablaProy = signal(false);
  readonly conPedido = signal(true);

  readonly kilos = kilos;
  readonly semanas = semanas;
  readonly paquetesAprox = paquetesAprox;
  readonly MESES = MESES;
  readonly cap = cap;

  readonly conCalculos = computed(() => conCalculos(this.datos().historia.nivel));
  readonly h = computed(() => this.datos().hilo);
  readonly f = (dia: string | null | undefined) => fechaLarga(dia, this.datos().hoy);

  /** El aviso de arriba: qué hacer con este hilo. */
  readonly banner = computed(() => {
    const d = this.datos();
    const h = d.hilo;
    const p = d.pedido_hoy;
    // Si se acaba antes de que llegue, se dice cuánto tiempo faltaría.
    const hueco = p && h.se_acaba && h.se_acaba < p.llega ? Math.round(diasEntre(h.se_acaba, p.llega) / 7) : 0;
    const llegaYQuedan = !p ? ''
      : hueco > 0
        ? `Si se pide hoy, llega hacia el ${this.f(p.llega)}, pero se acaba antes, hacia el ${this.f(h.se_acaba)}: faltaría ${hueco === 1 ? 'una semana' : 'unas ' + semanas(hueco)}.`
        : `Si se pide hoy, llega hacia el ${this.f(p.llega)} y para entonces quedan unos ${kilos(p.quedan_al_llegar)}.`;
    const acaba = h.se_acaba && !hueco ? ` Si no se pide, se acaba hacia el ${this.f(h.se_acaba)}.` : '';
    switch (h.estado) {
      case 'ya':
        return {
          tono: 'ya', boton: true,
          titulo: h.pedir && h.pedir < d.hoy ? `Pedir ya: había que pedirlo el ${this.f(h.pedir)}` : `Pedir ya: pedirlo antes del ${this.f(h.pedir)}`,
          texto: llegaYQuedan + acaba,
        };
      case 'pronto':
        return {
          tono: 'pronto', boton: true, titulo: `${estadoTexto(h.estado, h.pedir).texto}: pedirlo antes del ${this.f(h.pedir)}`,
          texto: (h.se_acaba ? `Se acaba hacia el ${this.f(h.se_acaba)}.` : '') + (h.nota ? ` ${h.nota}.` : '') + this.dosCantidades(),
        };
      case 'calma':
        return {
          tono: 'calma', boton: false, titulo: `Con calma: pedirlo antes del ${this.f(h.pedir)}`,
          texto: (h.se_acaba ? `Se acaba hacia el ${this.f(h.se_acaba)}.` : '') + this.dosCantidades(),
        };
      case 'sobra':
        return { tono: 'sobra', boton: false, titulo: 'Sobra: no hace falta pedir', texto: h.alcanza_semanas != null ? `Al ritmo de hoy alcanza para ${semanas(h.alcanza_semanas)}.` : 'No se ha vendido en las últimas semanas.' };
      default:
        return null;
    }
  });

  /**
   * Cuánto pedir cambia con la fecha: el pedido (y «Qué pedir») es para la fecha
   * límite, y la gráfica de abajo, para hoy. Se dicen los dos para que no choquen.
   */
  private dosCantidades(): string {
    const d = this.datos();
    const h = d.hilo;
    const p = d.pedido_hoy;
    if (!h.pedido?.kg || !p?.kg || h.pedido.kg === p.kg || !h.pedir) return '';
    return ` Pedido el ${this.f(h.pedir)} serían ${kilos(h.pedido.kg)}; si se pide hoy, ${kilos(p.kg)}.`;
  }

  readonly kpis = computed(() => {
    const d = this.datos();
    const h = d.hilo;
    const lugar = h.lugar === 1 ? 'el que más se vende' : `el ${h.lugar}.º que más se vende`;
    const rot = h.rotacion;
    return [
      { etiqueta: 'Vendido en 12 meses', tono: 'tono-acento', valor: kilos(h.vendido_12m), pie: `${h.pct_del_total.toLocaleString('es-MX')}% de todo lo vendido · ${lugar}` },
      {
        etiqueta: 'Hay hoy', tono: 'tono-tinta', valor: kilos(h.hay.kg),
        pie: `${h.hay.paquetes ? `Unos ${h.hay.paquetes.toLocaleString('es-MX')} paquetes` : 'Sin paquetes cerrados'}${h.hay.almacenes ? ` en ${h.hay.almacenes} ${h.hay.almacenes === 1 ? 'almacén' : 'almacenes'}` : ''}${h.hay.en_camino ? ` · ${kilos(h.hay.en_camino)} en camino` : ''}`,
      },
      {
        etiqueta: 'Rotación', tono: 'tono-acento', valor: rot ? `${rot.veces.toLocaleString('es-MX')} veces al año` : '—',
        pie: rot
          ? `${rot.cada_dias ? `Se renueva cada ${rot.cada_dias} días · ` : ''}hubo ${kilos(rot.existencia_promedio)} en promedio` +
            (rot.kardex_cuadra === false ? ' · el kardex no cuadra con lo que hay hoy: puede salir un poco distinta' : '')
          : 'Sin existencia con qué medirla',
      },
      {
        etiqueta: 'Alcanza para', tono: (h.alcanza_semanas ?? 99) < 4 ? 'tono-alerta' : 'tono-aviso', valor: semanas(h.alcanza_semanas),
        pie: h.se_vende_semana != null ? `Ahora se venden ${kilos(h.se_vende_semana)} por semana` : '',
      },
    ];
  });

  readonly meses = computed<MesComparado[]>(() => {
    const m = this.datos().meses;
    return m.actual.map((a, i) => ({ etiqueta: MESES_CORTOS[i], nombre: cap(MESES[i]), anterior: m.anterior[i].kg, actual: a.kg, origen: a.origen }));
  });

  readonly textoEnCurso = computed(() => {
    const m = this.datos().meses;
    return `${cap(MESES[m.mes_actual - 1])} ${m.anio_actual}, va en curso`;
  });

  /** Los bloques de «Su temporada». */
  readonly temporada = computed(() => {
    const t = this.datos().temporada;
    const h = this.datos().hilo;
    if (!t) return null;
    const kgMes = (x: { anio: number; kg: number }[]) => x.map((k) => `${kilos(k.kg)} en ${k.anio}`).join(' y ');
    const tend = contraAnio(h.contra_anio_pasado);
    const tz = h.tendencia;
    return {
      masTexto: t.texto,
      masPie: t.pct_del_anio != null ? `El ${t.pct_del_anio}% de lo que vende en el año sale en esos ${t.num_meses} meses.` : 'Ningún mes se aleja mucho de lo normal.',
      mejor: cap(MESES[t.mejor.mes - 1]),
      mejorPie: `${kgMes(t.mejor.kg)}: ${Math.round((t.mejor.indice - 1) * 100)}% más que un mes normal.`,
      peor: cap(MESES[t.peor.mes - 1]),
      peorPie: `${kgMes(t.peor.kg)}.${t.veces_mejor_peor && t.veces_mejor_peor >= 1.5 ? ` En ${MESES[t.mejor.mes - 1]} se vende ${veces(t.veces_mejor_peor)} lo de ${MESES[t.peor.mes - 1]}.` : ''}`,
      contra: tz.comparable ? tend.texto.replace(/^[↑↓] /, '') : null,
      contraPie: tz.comparable ? `${kilos(tz.actual)} de enero a ${MESES[tz.hasta_mes - 1]} de ${tz.anio}, contra ${kilos(tz.anterior)} en ${tz.anio - 1}.` : '',
    };
  });

  readonly totalAlmacenes = computed(() => {
    const a = this.datos().almacenes;
    const hay = a.reduce((s, x) => s + x.hay_kg, 0);
    const vende = a.reduce((s, x) => s + (x.vende_semana ?? 0), 0);
    return { hay, vende, alcanza: vende > 0 ? hay / vende : null, n: a.length };
  });

  readonly sinMostrador = computed(() => this.datos().almacenes.filter((a) => !a.vende).map((a) => a.nombre));

  /** Paquete contra cono (y por kilo, si hay). */
  readonly comoSeVende = computed(() => {
    const c = this.datos().como_se_vende;
    const total = c.paquete + c.cono + c.otro;
    if (!(total > 0)) return null;
    const pct = (x: number) => Math.round((100 * x) / total);
    return [
      { texto: 'En paquete', kg: c.paquete, pct: pct(c.paquete), clase: 'serie1' },
      { texto: 'En cono', kg: c.cono, pct: pct(c.cono), clase: 'serie2' },
      ...(c.otro > 0 ? [{ texto: 'Por kilo', kg: c.otro, pct: pct(c.otro), clase: 'otros' }] : []),
    ].filter((x) => x.kg > 0);
  });

  /** "Para <mes> vuelve a bajar: el siguiente pedido conviene hacerlo a principios de mayo." */
  readonly siguiente = computed(() => {
    const s = this.datos().proyeccion.siguiente;
    if (!s || !this.conPedido()) return null;
    return `Con este pedido, el siguiente de ${this.datos().hilo.color} conviene hacerlo a ${s.texto}.`;
  });
}
