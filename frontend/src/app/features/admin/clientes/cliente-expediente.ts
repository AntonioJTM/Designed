import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ClientesService } from '../../../core/services/clientes.service';
import { AuthService } from '../../../core/services/auth.service';
import { Expediente, MovimientoCredito } from '../../../core/models/clientes.models';
import { HabitosCliente } from '../../../core/models/rediseno.models';
import { ApiError } from '../../../core/models/auth.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { ClienteFormModal } from './cliente-form-modal';
import { AbonoModal } from './abono-modal';
import { AjusteModal } from './ajuste-modal';
import { LineaVisitas } from './expediente/linea-visitas';
import { TablaCompras } from './expediente/tabla-compras';
import { FolioPipe, folioCorto } from '../../../shared/folio.pipe';
import {
  COLOR,
  ESTADO_RITMO,
  capitalizar,
  diaCorto,
  diaEnPlural,
  estadoRitmo,
  fechaCorta,
  fechaLarga,
  horaRango,
  iniciales,
  kilos,
  mesYAnio,
  nombreMes,
  pesos,
  plural,
  sumarDias,
  ultimosMeses,
} from './clientes-ui';

type Pestana = 'resumen' | 'frecuencia' | 'deuda' | 'que' | 'cuando' | 'gasto';

const PESTANAS: { clave: Pestana; etiqueta: string }[] = [
  { clave: 'resumen', etiqueta: 'Resumen' },
  { clave: 'frecuencia', etiqueta: 'Frecuencia de compra' },
  { clave: 'deuda', etiqueta: 'Cuánto debe' },
  { clave: 'que', etiqueta: 'Qué compra' },
  { clave: 'cuando', etiqueta: 'Cuándo compra' },
  { clave: 'gasto', etiqueta: 'Cuánto gasta' },
];

/**
 * El EXPEDIENTE del cliente (rediseño 2026-10): todo lo que se sabe de él en
 * una pantalla. Arriba quién es, cómo va y si debe —lo que hay que saber ANTES
 * de venderle—; luego las mismas cinco miradas de Clientes, pero de él solo, y
 * un Resumen con lo esencial de cada una.
 *
 * Lo cancelado y lo devuelto no cuenta en sus totales: preguntar "cuánto me ha
 * comprado" e incluir lo que devolvió sería mentir. `cliente_desde` es desde
 * cuándo compra DE VERDAD, no cuándo se capturó (`creado_en`).
 *
 * Las acciones (editar, abonar, corregir la deuda) son modales. Corregir la
 * deuda solo se ofrece con `hacer:corregir_deuda`; el abono, a cualquiera del
 * personal (en efectivo pide un turno de caja abierto).
 */
@Component({
  selector: 'app-cliente-expediente',
  imports: [FolioPipe, RouterLink, CantidadPipe, DineroPipe, ClienteFormModal, AbonoModal, AjusteModal, LineaVisitas, TablaCompras],
  templateUrl: './cliente-expediente.html',
  styles: `
    .cabeza-cliente { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 20px; border-radius: 12px; padding: 24px; }
    .quien { display: flex; align-items: center; gap: 18px; min-width: 0; }
    .quien > div { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .quien h1 { margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.2; }
    .quien p { margin: 0; font-size: 14px; color: var(--tinta-3); }
    .quien p b { color: var(--tinta); font-weight: 500; }
    .etiquetas { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .etiquetas .tel { font-family: var(--mono); font-size: 13px; color: var(--tinta-2); }
    .notas { flex-basis: 100%; margin: 0; padding: 10px 14px; border-radius: 8px; background: var(--superficie-2);
             border: 1px solid var(--borde-suave); font-size: 14px; color: var(--tinta-2); white-space: pre-line; }
    .kpis-exp .kpi { flex: 1 1 150px; padding: 16px 18px; gap: 5px; }
    .kpis-exp .kpi-valor { font-size: 26px; }
    .tabs-exp { margin-top: -2px; }
    .cuenta-cifras { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; font-variant-numeric: tabular-nums; }
    .cuenta-cifras b { font-weight: 600; color: var(--tinta); }
    .movs { width: 100%; border-collapse: collapse; font-size: 14px; }
    .movs td { padding: 9px 0; border-top: 1px solid var(--borde-suave); vertical-align: top; }
    .movs td:first-child { color: var(--tinta-3); white-space: nowrap; width: 64px; font-variant-numeric: tabular-nums; }
    .movs td:nth-child(2) { padding-left: 8px; padding-right: 8px; }
    .movs td:last-child { text-align: right; font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .movs .con { color: var(--tinta-3); font-size: 13px; }
    .grande { font-size: 30px; font-weight: 600; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; line-height: 1.15; }
    .cifras-cuenta { display: flex; flex-wrap: wrap; gap: 16px 32px; }
    .cifras-cuenta > div { display: flex; flex-direction: column; gap: 4px; }
    .cifras-cuenta .muted { font-size: 13px; }
    .datos-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 32px; }
    @media (max-width: 640px) { .datos-2 { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class ClienteExpediente implements OnInit {
  private readonly clientes = inject(ClientesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly PESTANAS = PESTANAS;
  readonly ESTADO = ESTADO_RITMO;
  readonly COLOR = COLOR;
  readonly fechaCorta = fechaCorta;
  readonly fechaLarga = fechaLarga;
  readonly mesYAnio = mesYAnio;
  readonly pesos = pesos;
  readonly horaRango = horaRango;
  readonly diaEnPlural = diaEnPlural;

  readonly exp = signal<Expediente | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  readonly pestana = signal<Pestana>('resumen');
  /** Ya se pidieron TODAS sus compras, no solo las 20 recientes. */
  readonly todas = signal(false);
  readonly cargandoTodas = signal(false);

  // --- Modales: se crean al abrirlos y se destruyen al cerrarlos.
  readonly editando = signal(false);
  readonly abonando = signal(false);
  readonly ajustando = signal(false);

  // --- Lo que el puesto puede hacer o ver. El servidor también lo exige: esconder
  // es solo para no ofrecer lo que va a fallar.
  readonly puedeCorregir = computed(() => this.auth.puede('hacer:corregir_deuda'));
  readonly vePedidos = computed(() => this.auth.puede('ver:pedidos'));
  readonly vePos = computed(() => this.auth.puede('ver:pos'));

  private id = 0;

  ngOnInit(): void {
    this.id = Number(this.route.snapshot.paramMap.get('id'));
    // `?ver=deuda` abre directo esa mirada: las pestañas de Clientes mandan aquí
    // con la que se estaba viendo.
    const ver = this.route.snapshot.queryParamMap.get('ver') as Pestana | null;
    if (ver && PESTANAS.some((p) => p.clave === ver)) this.pestana.set(ver);
    this.cargar();
  }

  private cargar(): void {
    this.cargando.set(true);
    this.clientes.expediente(this.id, this.todas()).subscribe({
      next: (e) => {
        this.exp.set(e);
        this.cargando.set(false);
        this.cargandoTodas.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
        this.cargandoTodas.set(false);
      },
    });
  }

  elegir(p: Pestana): void {
    this.pestana.set(p);
    // En la dirección, sin llenar el historial: recargar deja la misma mirada.
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { ver: p === 'resumen' ? null : p },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** "Ver las 47 compras": va a Cuánto gasta y, si faltan, las pide todas. */
  verTodasLasCompras(): void {
    this.elegir('gasto');
    const e = this.exp();
    if (e && !this.todas() && e.total_pedidos > e.pedidos.length) {
      this.todas.set(true);
      this.cargandoTodas.set(true);
      this.cargar();
    }
  }

  // ------------------------------------------------------------- cabecera

  readonly iniciales = computed(() => {
    const e = this.exp();
    return e ? iniciales(e.nombre, e.nombre_comercial) : '';
  });

  readonly habitos = computed<HabitosCliente | null>(() => this.exp()?.habitos ?? null);

  /** Cómo va contra su propio ritmo; `null` si nunca ha comprado. */
  readonly estado = computed(() => {
    const h = this.habitos();
    return h ? estadoRitmo(h.ritmo, h.dias_sin_venir) : null;
  });

  readonly saldo = computed(() => this.num(this.exp()?.saldo));
  readonly limite = computed(() => this.num(this.exp()?.limite_credito));
  readonly disponible = computed(() => this.num(this.exp()?.credito_disponible));
  readonly usoCredito = computed(() => (this.limite() > 0 ? Math.round((100 * this.saldo()) / this.limite()) : null));

  /** Las cinco cifras de arriba. El pie dice si la cifra es buena o mala noticia. */
  readonly kpis = computed(() => {
    const e = this.exp();
    const h = this.habitos();
    if (!e || !h) return [];
    const normal = 'var(--tinta-3)';
    const alerta = COLOR.tintaAlerta;
    const lista: { etiqueta: string; valor: string; pie: string; tinta: string }[] = [];

    // 1. Su ritmo
    const est = this.estado();
    lista.push({
      etiqueta: 'Compra cada',
      valor: h.ritmo ? plural(h.ritmo, 'día', 'días') : '—',
      pie:
        h.dias_sin_venir === null ? 'todavía no te compra'
        : !h.ritmo ? `una sola compra, hace ${plural(h.dias_sin_venir, 'día', 'días')}`
        : h.dias_sin_venir === 0 ? 'vino hoy'
        : `lleva ${h.dias_sin_venir} sin venir`,
      tinta: est === 'frio' || est === 'perdido' ? alerta : normal,
    });

    // 2. Lo que debe
    const uso = this.usoCredito();
    lista.push({
      etiqueta: 'Debe',
      valor: pesos(this.saldo()),
      pie:
        this.limite() <= 0 ? (this.saldo() > 0 ? 'sin crédito autorizado' : 'no tiene crédito autorizado')
        : this.saldo() <= 0 ? `sin deuda · se le fía hasta ${pesos(this.limite())}`
        : uso !== null && uso >= 100 ? 'ya llegó a su límite'
        : `usa el ${uso}% de su crédito`,
      tinta: uso !== null && uso >= 85 ? alerta : normal,
    });

    // 3. Lo que gastó en 90 días, contra los 90 de antes
    const u = h.ultimos_90;
    const a = h.anteriores_90;
    let pieGasto = 'sin compras en los 90 días anteriores';
    let tintaGasto = normal;
    if (u && a && a.total > 0) {
      const cambio = Math.round((100 * (u.total - a.total)) / a.total);
      pieGasto = cambio === 0 ? 'igual que antes' : `${Math.abs(cambio)}% ${cambio > 0 ? 'más' : 'menos'} que antes`;
      if (cambio < 0) tintaGasto = alerta;
    }
    lista.push({ etiqueta: 'Gastó en 90 días', valor: pesos(u?.total ?? 0), pie: pieGasto, tinta: tintaGasto });

    // 4. Por compra, contra el promedio de todos los clientes
    const ticket = u && u.compras > 0 ? u.total / u.compras : this.num(e.estadisticas.ticket_promedio);
    const tienda = h.ticket_tienda_90 ?? null;
    let piePor = u && u.compras > 0 ? `en ${plural(u.compras, 'compra', 'compras')}` : 'su promedio de siempre';
    if (tienda && ticket > 0) {
      const r = ticket / tienda;
      piePor =
        r >= 2 ? 'más del doble que el promedio'
        : r >= 1.1 ? `${Math.round((r - 1) * 100)}% más que el promedio`
        : r > 0.9 ? 'como el promedio de tus clientes'
        : `${Math.round((1 - r) * 100)}% menos que el promedio`;
    }
    lista.push({ etiqueta: 'Por compra', valor: ticket > 0 ? pesos(ticket) : '—', pie: piePor, tinta: normal });

    // 5. Los kilos
    const kg90 = u?.kg ?? 0;
    lista.push({
      etiqueta: 'Se llevó',
      valor: kg90 > 0 ? kilos(kg90) : kilos(e.estadisticas.kilos),
      pie: kg90 > 0 ? `en 90 días, de ${plural(u?.hilos ?? 0, 'hilo distinto', 'hilos distintos')}` : 'en total; nada en los últimos 90 días',
      tinta: normal,
    });
    return lista;
  });

  // -------------------------------------------------------------- su cuenta

  readonly ultimoAbono = computed(() => {
    const u = this.exp()?.ultimo_abono;
    if (!u) return null;
    const hace = Math.floor((Date.now() - new Date(String(u).replace(' ', 'T')).getTime()) / 864e5);
    return { fecha: fechaCorta(u), hace };
  });

  /**
   * El monto con el signo de hacia dónde mueve la deuda: el abono la baja, el
   * cargo la sube y el ajuste trae su propio signo. Antes se le pegaba un "+" a
   * todo lo que no fuera abono, y el ajuste negativo salía como "+-$17,941.79".
   */
  efecto(m: MovimientoCredito): number {
    const n = this.num(m.monto);
    return m.tipo === 'abono' ? -Math.abs(n) : n;
  }

  montoMovimiento(m: MovimientoCredito): string {
    const n = this.efecto(m);
    return (n < 0 ? '−' : '+') + pesos(Math.abs(n)).replace('-', '');
  }

  etiquetaMovimiento(tipo: string): string {
    return tipo === 'cargo' ? 'Se llevó a crédito' : tipo === 'abono' ? 'Abonó' : 'Ajuste';
  }

  /** "· efectivo", "· POS-A1F3": lo que aclara el movimiento en una línea. */
  conMovimiento(m: MovimientoCredito): string {
    if (m.tipo === 'abono') return m.metodo_pago ? `· ${m.metodo_pago.toLowerCase()}` : '';
    if (m.tipo === 'cargo') return m.numero_pedido ? `· ${folioCorto(m.numero_pedido)}` : '';
    return m.notas ? `· ${m.notas}` : '';
  }

  // ---------------------------------------------------------- qué se lleva

  /** Sus hilos, cada barra contra el que más kilos lleva. Por HILO, con calibre. */
  readonly hilos = computed(() => {
    const c = this.exp()?.colores_mas_comprados ?? [];
    const max = Math.max(0.001, ...c.map((x) => this.num(x.kilos)));
    return c.map((x) => ({
      x,
      hilo: [x.color, x.calibre].filter(Boolean).join(' '),
      ficha: [x.material, x.linea].filter(Boolean).join(' · '),
      ancho: Math.max(1, Math.round((this.num(x.kilos) / max) * 80)),
    }));
  });

  readonly pctPaquete90 = computed(() => {
    const u = this.habitos()?.ultimos_90;
    if (!u || u.kg <= 0) return null;
    return Math.round(100 * (1 - u.kg_cono / u.kg));
  });

  // ---------------------------------------------------------- cuánto gasta

  /** Los últimos seis meses, también los que no compró: el hueco también dice algo. */
  readonly meses = computed(() => {
    const por = this.habitos()?.por_mes ?? [];
    const lista = ultimosMeses(6).map((ym) => {
      const m = por.find((x) => x.mes === ym);
      return { ym, mes: nombreMes(ym), total: m?.total ?? 0, compras: m?.compras ?? 0 };
    });
    const max = Math.max(1, ...lista.map((m) => m.total));
    return lista.map((m, i) => ({
      ...m,
      alto: m.total > 0 ? Math.max(3, Math.round((m.total / max) * 120)) : 0,
      // El mes en curso va en naranja: todavía no termina.
      color: i === lista.length - 1 ? COLOR.serie2 : COLOR.serie1,
    }));
  });

  readonly resumenMeses = computed(() =>
    this.meses().map((m) => `${m.mes} ${pesos(m.total)}`).join(', ')
  );

  // ---------------------------------------------------------- cuándo compra

  /** Por día de la semana: lunes a sábado, y el domingo solo si alguna vez vino. */
  readonly porDia = computed(() => {
    const d = this.habitos()?.por_dia_semana ?? [];
    const orden = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
    const lista = orden
      .map((dia) => ({ dia, n: d.find((x) => x.dia === dia)?.n ?? 0 }))
      .filter((x) => x.dia !== 'domingo' || x.n > 0);
    const max = Math.max(1, ...lista.map((x) => x.n));
    return lista.map((x) => ({ ...x, etiqueta: diaCorto(x.dia), alto: Math.round((x.n / max) * 130), fuerte: x.n === max && x.n > 0 }));
  });

  /** Por hora: de 9 a 18 h, más cualquier hora fuera de eso en la que haya comprado. */
  readonly porHora = computed(() => {
    const h = this.habitos()?.por_hora ?? [];
    const horas = [...new Set([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, ...h.map((x) => x.hora)])].sort((a, b) => a - b);
    const max = Math.max(1, ...h.map((x) => x.n));
    return horas.map((hora) => {
      const n = h.find((x) => x.hora === hora)?.n ?? 0;
      return { hora, n, etiqueta: String(hora), alto: Math.round((n / max) * 130), fuerte: n === max && n > 0 };
    });
  });

  readonly proxima = computed(() => {
    const h = this.habitos();
    if (!h?.ritmo || !h.ultima) return null;
    const fecha = sumarDias(h.ultima, h.ritmo);
    return { fecha, paso: (h.dias_sin_venir ?? 0) > h.ritmo };
  });

  capitalizar = capitalizar;

  // ------------------------------------------------------- frases de las tarjetas

  /** "Viene cada 8 días. Desde el 8 de septiembre no ha vuelto: lleva 24 días…" */
  readonly fraseVisitas = computed(() => {
    const h = this.habitos();
    if (!h || h.dias_sin_venir === null || !h.ultima) return 'Todavía no te ha comprado.';
    const sin = h.dias_sin_venir;
    if (!h.ritmo) return `Ha comprado una sola vez, el ${fechaLarga(h.ultima)}.`;
    if (sin > h.ritmo) {
      const v = h.veces_su_ritmo ?? sin / h.ritmo;
      const veces =
        v >= 1.9 && v < 2.1 ? 'el doble de'
        : v >= 2.9 && v < 3.1 ? 'el triple de'
        : `${v.toLocaleString('es-MX', { maximumFractionDigits: 1 })} veces`;
      return `Viene cada ${h.ritmo} días. Desde el ${fechaLarga(h.ultima)} no ha vuelto: lleva ${sin} días, ${veces} su costumbre.`;
    }
    const cuando = sin === 0 ? 'hoy' : `hace ${plural(sin, 'día', 'días')}`;
    return `Viene cada ${h.ritmo} días. Su última compra fue el ${fechaLarga(h.ultima)}, ${cuando}: va dentro de su ritmo.`;
  });

  readonly fraseCuenta = computed(() => {
    const u = this.ultimoAbono();
    const base = this.limite() > 0
      ? `Se le fía hasta ${pesos(this.limite())}.`
      : 'No tiene crédito autorizado: el límite se le pone en Editar.';
    if (!u) return base;
    return `${base} Último abono: ${u.fecha}, ${u.hace === 0 ? 'hoy' : 'hace ' + plural(u.hace, 'día', 'días')}.`;
  });

  /** La barra del crédito usado; topada en 100 aunque se haya pasado del límite. */
  readonly usoBarra = computed(() => Math.min(100, Math.max(0, this.usoCredito() ?? 0)));

  readonly fraseQue = computed(() => {
    const u = this.habitos()?.ultimos_90;
    const pct = this.pctPaquete90();
    if (!u || u.kg <= 0 || pct === null) return 'Lo que más se ha llevado, en kilos. En los últimos 90 días no compró.';
    return `Lo que más se ha llevado, en kilos. En 90 días: ${kilos(u.kg)} de ${plural(u.hilos, 'hilo', 'hilos')}, ` +
      `${pct}% en paquete cerrado.`;
  });

  readonly fraseCuando = computed(() => {
    const h = this.habitos();
    if (!h || !h.dia_de_costumbre) return 'Todavía no hay compras para saber cuándo viene.';
    let f = `Viene sobre todo los ${diaEnPlural(h.dia_de_costumbre)}, de ${horaRango(h.hora_de_costumbre)}.`;
    const p = this.proxima();
    if (p && h.ritmo) {
      f += ` Compra cada ${h.ritmo} días: ${p.paso ? 'debería haber vuelto' : 'debería volver'} el ${fechaLarga(p.fecha)}.`;
    }
    return f;
  });

  /** Las cinco compras más recientes, para el Resumen. */
  readonly comprasRecientes = computed(() => (this.exp()?.pedidos ?? []).slice(0, 5));

  // ---------------------------------------------------------------- modales

  guardado(): void {
    this.mensaje.set('Se guardaron sus datos.');
    this.cargar();
  }

  abonoRegistrado(r: { saldo_nuevo: number }): void {
    this.mensaje.set(`Abono registrado. ${r.saldo_nuevo > 0 ? `Le quedan ${pesos(r.saldo_nuevo)} por pagar.` : 'Quedó al día.'}`);
    this.cargar();
  }

  ajusteRegistrado(r: { saldo_nuevo: number }): void {
    this.mensaje.set(`Ajuste registrado. Ahora debe ${pesos(r.saldo_nuevo)}.`);
    this.cargar();
  }

  // ------------------------------------------------------------------ ayudas

  num(v: unknown): number {
    return Number(v ?? 0);
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
