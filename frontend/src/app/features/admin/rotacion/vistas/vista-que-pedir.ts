import { Component, computed, inject, input, output, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HiloRotacion, QuePedirRotacion } from '../../../../core/models/rotacion.models';
import { RotacionService } from '../../../../core/services/rotacion.service';
import { guardarArchivo } from '../../../../shared/descargar';
import {
  MESES, alcanzaHasta, cap, conCalculos, cuandoPedir, estadoTexto, fechaLarga, kilos, semanas, toneladas,
} from '../rotacion-ui';

/** "MARINO, OXFORD JASPE y HUESO". */
function lista(nombres: string[]): string {
  if (nombres.length <= 1) return nombres.join('');
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

const NUMEROS = ['', 'el', 'los dos', 'los tres', 'los cuatro', 'los cinco', 'los seis', 'los siete', 'los ocho', 'los nueve', 'los diez'];

/**
 * ROTACIÓN · QUÉ PEDIR: cuándo pedir cada hilo, del más urgente al que puede
 * esperar, y cuánto. Se eligen los que van en el pedido (de entrada, los de
 * «Pedir ya» y los de los próximos meses) y se baja el archivo para el
 * proveedor. El pedido al proveedor todavía no existe en el sistema.
 */
@Component({
  selector: 'app-vista-que-pedir',
  imports: [RouterLink],
  templateUrl: './vista-que-pedir.html',
  styleUrls: ['./vistas.scss', './vista-que-pedir.scss'],
})
export class VistaQuePedir {
  private readonly api = inject(RotacionService);

  readonly datos = input.required<QuePedirRotacion>();
  readonly cargando = input(false);
  /** Tiene «Tiempos para pedir al proveedor» (`hacer:ajustes_rotacion`). */
  readonly puedeCambiar = input(false);
  /** «Cambiar» los ajustes (la ventana la abre la pantalla). */
  readonly cambiar = output<void>();

  readonly kilos = kilos;
  readonly semanas = semanas;
  readonly toneladas = toneladas;
  readonly estadoTexto = estadoTexto;

  /** El hilo que viene de «Agregar X kg al pedido» (Por hilo). */
  private readonly agregar = Number(inject(ActivatedRoute).snapshot.queryParamMap.get('agregar')) || null;

  /** Lo que eligió la persona; null mientras no toque nada (van los de siempre). */
  private readonly eleccion = signal<Set<number> | null>(null);
  readonly bajando = signal(false);
  readonly error = signal<string | null>(null);

  readonly conCalculos = computed(() => conCalculos(this.datos().historia.nivel));
  readonly f = (dia: string | null | undefined) => fechaLarga(dia, this.datos().hoy);
  readonly alcanza = (h: HiloRotacion) => alcanzaHasta(h.se_acaba, this.datos().hoy);
  readonly cuando = (h: HiloRotacion) => cuandoPedir(h.pedir, this.datos().hoy);

  /** Se puede pedir: tiene cuánto pedir y no sobra. */
  readonly sePide = (h: HiloRotacion) => !!h.pedido && h.pedido.kg > 0 && h.estado !== 'sobra';

  /** Los que hay y no se venden ahora: van en un renglón aparte, no uno por uno en ceros. */
  private readonly quieto = (h: HiloRotacion) => h.estado === 'sobra' && !(h.se_vende_semana != null && h.se_vende_semana > 0);
  readonly filas = computed(() => this.datos().hilos.filter((h) => !this.quieto(h)));
  readonly quietos = computed(() => this.datos().hilos.filter(this.quieto));
  readonly kgQuietos = computed(() => this.quietos().reduce((s, h) => s + h.hay.kg, 0));

  readonly elegidos = computed<Set<number>>(() => {
    const pedibles = new Set(this.datos().hilos.filter(this.sePide).map((h) => h.producto_id));
    const e = this.eleccion();
    if (e) return new Set([...e].filter((id) => pedibles.has(id)));
    const deEntrada = this.datos().hilos.filter((h) => this.sePide(h) && (h.estado === 'ya' || h.estado === 'pronto'));
    const ids = new Set(deEntrada.map((h) => h.producto_id));
    if (this.agregar && pedibles.has(this.agregar)) ids.add(this.agregar);
    return ids;
  });

  alternar(h: HiloRotacion, marcado: boolean): void {
    const s = new Set(this.elegidos());
    if (marcado) s.add(h.producto_id);
    else s.delete(h.producto_id);
    this.eleccion.set(s);
  }

  readonly kpis = computed(() => {
    const t = this.datos().totales;
    const paq = (n: number) => (n ? ` · ≈ ${n.toLocaleString('es-MX')} paquetes` : '');
    const hilos = (n: number) => `${n} ${n === 1 ? 'hilo' : 'hilos'}`;
    const mes = (dia: string | null) => (dia ? MESES[Number(dia.slice(5, 7)) - 1] : '');
    const anio = (dia: string | null) => (dia ? dia.slice(0, 4) : '');
    let calmaPie = '';
    if (t.calma.hilos && t.calma.desde && t.calma.hasta) {
      const mismoMes = t.calma.desde.slice(0, 7) === t.calma.hasta.slice(0, 7);
      calmaPie = mismoMes
        ? `Se piden en ${mes(t.calma.desde)} de ${anio(t.calma.desde)}`
        : `Se piden entre ${mes(t.calma.desde)}${anio(t.calma.desde) !== anio(t.calma.hasta) ? ` de ${anio(t.calma.desde)}` : ''} y ${mes(t.calma.hasta)} de ${anio(t.calma.hasta)}`;
    }
    return [
      {
        etiqueta: 'Pedir ya', tono: 'tono-alerta',
        valor: t.ya.hilos ? toneladas(t.ya.kg) : 'Nada',
        pie: t.ya.hilos ? `${hilos(t.ya.hilos)} · ${kilos(t.ya.kg)}${paq(t.ya.paquetes)}` : 'Ningún hilo hay que pedirlo ya',
      },
      {
        etiqueta: 'En los próximos 3 meses', tono: 'tono-aviso',
        valor: t.proximos.hilos ? toneladas(t.proximos.kg) : 'Nada',
        pie: t.proximos.hilos
          ? `${hilos(t.proximos.hilos)}${t.ya.hilos ? ', contando los de ya' : ''}${paq(t.proximos.paquetes)}`
          : 'Nada que pedir en los próximos 90 días',
      },
      { etiqueta: 'Con calma', tono: 'tono-acento', valor: hilos(t.calma.hilos), pie: calmaPie || 'Ninguno se pide más adelante' },
      {
        etiqueta: 'Sobra', tono: 'tono-tinta', valor: t.sobra.hilos ? kilos(t.sobra.kg) : 'Nada',
        pie: t.sobra.uno
          ? `${t.sobra.uno.hilo}: le alcanza ${t.sobra.uno.alcanza}`
          : t.sobra.hilos ? `${hilos(t.sobra.hilos)}: les alcanza para más de un año` : 'Ningún hilo tiene de más',
      },
    ];
  });

  /** El pedido con lo elegido: cuántos hilos, kilos y paquetes, y qué conviene saber. */
  readonly pedido = computed(() => {
    const d = this.datos();
    const sel = d.hilos.filter((h) => this.elegidos().has(h.producto_id));
    const kg = sel.reduce((s, h) => s + (h.pedido?.kg ?? 0), 0);
    const paquetes = sel.reduce((s, h) => s + (h.pedido?.paquetes ?? 0), 0);
    const n = sel.length;
    let texto = '';
    if (n) {
      const primero = sel.reduce<string | null>((m, h) => (h.pedir && (!m || h.pedir < m) ? h.pedir : m), null);
      const tarde = primero ? sel.filter((h) => h.pedir && h.pedir > primero && h.estado !== 'ya') : [];
      const cuantos = n === 1 ? '' : `${NUMEROS[n] ?? `los ${n}`} `;
      if (n === 1) {
        texto = primero && primero > d.hoy ? `Pedirlo antes del ${this.f(primero)}.` : 'Pedirlo lo antes posible.';
      } else if (primero && primero > d.hoy) {
        texto = `Si ${cuantos}se piden juntos antes del ${this.f(primero)}`;
        texto += tarde.length ? `, ${lista(tarde.map((h) => h.color))} ${tarde.length === 1 ? 'llega' : 'llegan'} con tiempo de sobra${tarde.some((h) => h.temporada) ? ' para su temporada' : ''}.` : ', llegan a tiempo todos.';
      } else {
        texto = `Hay que pedir${tarde.length ? ' lo antes posible' : 'los lo antes posible'}`;
        texto += tarde.length ? `; si van juntos, ${lista(tarde.map((h) => h.color))} ${tarde.length === 1 ? 'llega' : 'llegan'} con tiempo de sobra.` : '.';
      }
      texto += ' Las cantidades se recalculan con la fecha en que se pida.';
    }
    const cont = d.ajustes.kg_contenedor;
    const contenedor = cont && kg ? (kg <= cont
      ? `Llena el ${Math.round((100 * kg) / cont)}% de un contenedor de ${kilos(cont)}.`
      : `Son ${(Math.round((kg / cont) * 10) / 10).toLocaleString('es-MX')} contenedores de ${kilos(cont)}.`) : '';
    return { n, kg, paquetes, texto, contenedor, ids: sel.map((h) => h.producto_id) };
  });

  readonly titulo = computed(() => {
    const p = this.pedido();
    if (!p.n) return 'Ningún hilo elegido';
    return `${p.n} ${p.n === 1 ? 'hilo' : 'hilos'} · ${kilos(p.kg)}${p.kg >= 1000 ? ` (${toneladas(p.kg)})` : ''}${p.paquetes ? ` · ≈ ${p.paquetes.toLocaleString('es-MX')} paquetes` : ''}`;
  });

  /** El archivo para el proveedor: hilo, calibre, material, kilos, paquetes y para cuándo. Sin precios. */
  bajar(): void {
    const ids = this.pedido().ids;
    if (!ids.length || this.bajando()) return;
    this.bajando.set(true);
    this.error.set(null);
    this.api.quePedirCsv(ids).subscribe({
      next: (blob) => {
        guardarArchivo(blob, `pedido-proveedor-${this.datos().hoy}.csv`);
        this.bajando.set(false);
      },
      error: () => {
        this.error.set('No se pudo armar el archivo. Intenta de nuevo.');
        this.bajando.set(false);
      },
    });
  }

  readonly cap = cap;
}
