import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { NotificacionesService } from '../../../core/services/notificaciones.service';
import { RedisenoService } from '../../../core/services/rediseno.service';
import { Hoy as DatosHoy } from '../../../core/models/rediseno.models';
import { ApiError } from '../../../core/models/auth.models';
import { fechaRelativa } from '../../../shared/fecha.pipe';
import { folioCorto } from '../../../shared/folio.pipe';

/** Un renglón de la lista de pendientes: qué espera, a quién y a dónde ir. */
interface Pendiente {
  icono: string;
  tono: 'azul' | 'verde' | 'ambar' | 'naranja' | 'gris';
  titulo: string;
  detalle: string;
  accion: string;
  ruta: string;
  /** Filtro que se pasa en la dirección (?falta=precio). */
  query?: Record<string, string>;
}

const ICONO = {
  envio: 'M2 6h12v10H2z M14 10h4l3 3v3h-7 M6 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M17 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  existencias: 'M3 8l9-5 9 5v8l-9 5-9-5z M3 8l9 5 9-5 M12 13v8',
  precio: 'M3 12V4h8l10 10-8 8z M7.5 8.5h.01',
  apartado: 'M6 3h12v18l-6-4-6 4z',
  cobro: 'M3 7h18v11H3z M3 11h18 M7 15h4',
  gente: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5',
};

/**
 * HOY: la pantalla de entrada (rediseño 2026-10). Contesta "¿qué está
 * esperando a alguien en la tienda?" con lo mismo que la campana —son los
 * mismos pendientes vivos de `GET /notificaciones`— más lo que se vendió y lo
 * que debería haber en cada cajón ahora mismo (`GET /hoy`).
 *
 * Cada quien ve solo lo de su puesto: un almacenista no recibe avisos de
 * cobranza, ni un cajero de traspasos. Igual que en la campana, un aviso de
 * clientes es UNO por tema, no uno por cliente.
 */
@Component({
  selector: 'app-hoy',
  imports: [RouterLink],
  templateUrl: './hoy.html',
  styles: `
    .caja-fila { display: flex; justify-content: space-between; gap: 12px; padding: 12px 0; border-top: 1px solid var(--borde-suave); }
    .caja-fila > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .caja-fila b { font-size: 15px; font-weight: 500; }
    .caja-fila .der { align-items: flex-end; text-align: right; flex: 0 0 auto; white-space: nowrap; }
    .caja-fila .der b { font-size: 16px; font-weight: 600; }
    .caja-fila .muted { font-size: 13px; }
  `,
})
export class Hoy {
  private readonly auth = inject(AuthService);
  private readonly notif = inject(NotificacionesService);
  private readonly api = inject(RedisenoService);

  readonly datos = signal<DatosHoy | null>(null);
  readonly error = signal<string | null>(null);
  readonly pendientes = this.notif.pendientes;

  /** "Viernes 2 de octubre": en la hora del equipo, que es la de la tienda. */
  readonly fecha = (() => {
    const t = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');
    return t.charAt(0).toUpperCase() + t.slice(1);
  })();

  readonly vePos = computed(() => this.puede('ver:pos'));
  readonly veCaja = computed(() => this.puede('ver:caja'));
  private readonly veClientes = computed(() => this.puede('ver:clientes'));
  private readonly veApartados = computed(() => this.puede('ver:apartados'));
  private readonly veSurtir = computed(() => this.puede('ver:surtir'));
  private readonly veInventario = computed(() => this.puede('ver:inventario'));
  private readonly veCatalogo = computed(() => this.puede('ver:catalogo'));

  /** Las cuatro cifras de arriba; las de clientes y apartados, solo si se ven. */
  readonly kpis = computed(() => {
    const d = this.datos();
    const p = this.pendientes();
    const lista: { etiqueta: string; valor: string; pie: string; punto: string }[] = [];
    if (d) {
      lista.push({
        etiqueta: 'Vendido hoy',
        valor: this.pesos(d.vendido_hoy.total),
        pie: `${d.vendido_hoy.ventas} ${d.vendido_hoy.ventas === 1 ? 'venta' : 'ventas'}`,
        punto: '#2457C5',
      });
      lista.push({
        etiqueta: 'En las cajas',
        valor: this.pesos(d.en_cajas),
        pie:
          d.cajas.length === 0
            ? 'no hay turnos abiertos'
            : `efectivo esperado en ${d.cajas.length} ${d.cajas.length === 1 ? 'turno abierto' : 'turnos abiertos'}`,
        punto: '#1baf7a',
      });
    }
    if (p && this.veClientes()) {
      lista.push({
        etiqueta: 'Cobranza atrasada',
        valor: this.pesos(p.cobranza?.monto ?? 0),
        pie:
          (p.cobranza?.num_clientes ?? 0) === 0
            ? `nadie lleva ${p.cobranza?.dias ?? 30} días sin abonar`
            : `${p.cobranza.num_clientes} ${p.cobranza.num_clientes === 1 ? 'cliente' : 'clientes'}, ${p.cobranza.dias} días o más sin abonar`,
        punto: '#C2410C',
      });
    }
    if (p && this.veApartados()) {
      const n = p.apartados_listos?.num ?? 0;
      lista.push({
        etiqueta: 'Por entregar',
        valor: String(n),
        pie: n === 1 ? 'apartado ya liquidado' : 'apartados ya liquidados',
        punto: '#E9A23B',
      });
    }
    return lista;
  });

  /** Los pendientes, agrupados por de qué se trata. Los grupos vacíos no salen. */
  readonly grupos = computed(() => {
    const p = this.pendientes();
    if (!p) return [];
    const mercancia: Pendiente[] = [];
    const ventas: Pendiente[] = [];
    const clientes: Pendiente[] = [];

    if (this.veSurtir()) {
      for (const t of p.traspasos_por_enviar) {
        const n = Number(t.num_lineas);
        mercancia.push({
          icono: ICONO.envio,
          tono: 'azul',
          titulo: `${t.almacen_destino} pide ${n} ${n === 1 ? 'hilo' : 'hilos'} · ${this.kg(t.kg)}`,
          detalle: `Solicitud ${folioCorto(t.folio)}, ${this.cuando(t.creado_en)} · falta enviarla`,
          accion: 'Surtir',
          ruta: '/admin/traspasos',
        });
      }
      for (const t of p.traspasos_por_recibir) {
        mercancia.push({
          icono: ICONO.envio,
          tono: 'gris',
          titulo: `Va en camino un envío a ${t.almacen_destino} · ${this.kg(t.kg)}`,
          detalle: `Salió ${this.cuando(t.enviado_en)} · falta que confirmen que llegó`,
          accion: 'Ver',
          ruta: '/admin/traspasos',
        });
      }
    }
    if (this.veInventario() && p.alertas_stock > 0) {
      mercancia.push({
        icono: ICONO.existencias,
        tono: 'ambar',
        titulo:
          p.alertas_stock === 1
            ? '1 presentación está en su mínimo o debajo'
            : `${p.alertas_stock} presentaciones están en su mínimo o debajo`,
        detalle: 'Revisa cuáles en Inventario: ahí se ve en qué almacén falta',
        accion: 'Ver inventario',
        ruta: '/admin/inventario',
      });
    }
    // Los hilos que entraron con la lista del proveedor llegan sin precio.
    const sinPrecio = p.sin_precio?.num ?? 0;
    if (this.veCatalogo() && sinPrecio > 0) {
      const nombres = (p.sin_precio?.hilos ?? []).slice(0, 3).map((h) => `${h.nombre}${h.calibre ? ' ' + h.calibre : ''}`);
      const resto = sinPrecio - nombres.length;
      mercancia.push({
        icono: ICONO.precio,
        tono: 'ambar',
        titulo: sinPrecio === 1 ? '1 hilo no tiene precio' : `${sinPrecio} hilos no tienen precio`,
        detalle: `${nombres.join(', ')}${resto > 0 ? ` y ${resto} más` : ''} · no se pueden vender hasta ponérselo`,
        accion: 'Poner precio',
        ruta: '/admin/productos',
        query: { falta: 'precio' },
      });
    }

    const listos = p.apartados_listos?.num ?? 0;
    if (this.veApartados() && listos > 0) {
      const viejo = (p.apartados_listos?.pedidos ?? [])
        .map((a) => a.liquidado_en)
        .filter((f): f is string => !!f)
        .sort()[0];
      ventas.push({
        icono: ICONO.apartado,
        tono: 'verde',
        titulo:
          listos === 1
            ? '1 apartado ya está pagado: falta entregarlo'
            : `${listos} apartados ya están pagados: falta entregarlos`,
        detalle: viejo ? `El más viejo se liquidó ${this.cuando(viejo)}` : 'A ellos no se les cobra: se les entrega',
        accion: 'Entregar',
        ruta: '/admin/apartados',
      });
    }

    if (this.veClientes()) {
      const c = p.cobranza;
      if (c && c.num_clientes > 0) {
        const peor = [...c.clientes].sort((a, b) => b.dias_sin_abonar - a.dias_sin_abonar)[0];
        clientes.push({
          icono: ICONO.cobro,
          tono: 'naranja',
          titulo: `${c.num_clientes} ${c.num_clientes === 1 ? 'cliente lleva' : 'clientes llevan'} ${c.dias} días o más sin abonar · ${this.pesos(c.monto)}`,
          detalle: peor ? `El que más: ${peor.nombre_comercial || peor.nombre}, ${peor.dias_sin_abonar} días` : '',
          accion: 'Cobrar',
          ruta: '/admin/clientes/deuda',
        });
      }
      const e = p.enfriados;
      if (e && e.num_clientes > 0) {
        clientes.push({
          icono: ICONO.gente,
          tono: 'ambar',
          titulo:
            e.num_clientes === 1 ? '1 cliente dejó de venir' : `${e.num_clientes} clientes dejaron de venir`,
          detalle: `Llevan ${e.dias} días o más sin comprar · vale la pena llamarles`,
          accion: 'Ver quiénes',
          ruta: '/admin/clientes/dejaron',
        });
      }
      const n = p.nuevos_sin_credito;
      if (n && n.num_clientes > 0) {
        const primero = n.clientes[0];
        const nombre = primero ? primero.nombre_comercial || primero.nombre : '';
        clientes.push({
          icono: ICONO.gente,
          tono: 'gris',
          titulo:
            n.num_clientes === 1
              ? '1 cliente nuevo espera que se decida su crédito'
              : `${n.num_clientes} clientes nuevos esperan que se decida su crédito`,
          detalle:
            n.num_clientes === 1
              ? `${nombre}, capturado hace ${n.dias} días o más`
              : `${nombre} y ${n.num_clientes - 1} más · capturados hace ${n.dias} días o más`,
          accion: 'Decidir',
          // Con uno solo se va directo a él; con varios, al primero (los demás
          // siguen en la campana).
          ruta: primero ? `/admin/clientes/${primero.cliente_id}` : '/admin/clientes',
        });
      }
    }

    return [
      { titulo: 'Mercancía', items: mercancia },
      { titulo: 'Ventas', items: ventas },
      { titulo: 'Clientes', items: clientes },
    ].filter((g) => g.items.length > 0);
  });

  /** Las barras por hora (hasta 100 px): la más alta lleva el tono fuerte. */
  readonly horas = computed(() => {
    const filas = this.datos()?.por_hora ?? [];
    const max = Math.max(1, ...filas.map((h) => h.n));
    return filas.map((h) => ({
      etiqueta: String(h.hora),
      n: h.n,
      alto: Math.round((h.n / max) * 100),
      fuerte: h.n === max && h.n > 0,
    }));
  });

  /** "La hora más fuerte fue de 11 a 12, con 6 ventas", para quien no ve la gráfica. */
  readonly resumenHoras = computed(() => {
    const filas = this.datos()?.por_hora ?? [];
    const pico = filas.reduce<{ hora: number; n: number } | null>((m, h) => (!m || h.n > m.n ? h : m), null);
    if (!pico || pico.n === 0) return 'Todavía no hay ventas hoy';
    return `La hora más fuerte fue de ${pico.hora} a ${pico.hora + 1}, con ${pico.n} ${pico.n === 1 ? 'venta' : 'ventas'}`;
  });

  constructor() {
    // La campana ya pregunta cada minuto; aquí se pide una vez al entrar para
    // no esperar a la siguiente vuelta.
    this.notif.iniciar();
    this.cargar();
  }

  cargar(): void {
    this.error.set(null);
    this.api.hoy().subscribe({
      next: (d) => this.datos.set(d),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  private puede(permiso: string): boolean {
    this.auth.sesion(); // se recalcula al llegar el perfil
    return this.auth.puede(permiso);
  }

  /** "hoy a las 8:15", "ayer a las 18:40" o "el 30/09 a las 10:15". */
  cuando(iso: string | null | undefined): string {
    return fechaRelativa(iso);
  }

  pesos(v: unknown): string {
    return Number(v ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
  }

  private kg(v: unknown): string {
    return `${Number(v ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg`;
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'No se pudo cargar el resumen del día.';
  }
}
