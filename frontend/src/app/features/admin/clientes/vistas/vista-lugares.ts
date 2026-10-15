import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ClientesService } from '../../../../core/services/clientes.service';
import { AuthService } from '../../../../core/services/auth.service';
import { Cliente, LugarEntrega, LugaresEntrega } from '../../../../core/models/clientes.models';
import { ApiError } from '../../../../core/models/auth.models';
import { COLOR, ESTADOS_MX, plural } from '../clientes-ui';

/** Lo que se está viendo abajo: los clientes de un lugar, o los que no tienen. */
type Seleccion = { tipo: 'lugar'; lugar: LugarEntrega } | { tipo: 'sin' };

/**
 * Pestaña DÓNDE ENTREGO (2026-10-14): "los que entrego en Tulancingo, Tenango…
 * necesito etiquetar esos clientes para sacar a cuántos les entrego en los
 * municipios o estados" (usuario).
 *
 * Arriba las cifras; luego, por ESTADO, cada lugar con cuántos clientes tiene
 * (la barra se mide contra TODOS los clientes activos, y lo dice); al tocar un
 * lugar se listan sus clientes. "Sin lugar" lista a los que faltan por
 * etiquetar. El nombre de un lugar se corrige aquí: sus clientes lo siguen.
 * Los lugares se dan de alta al capturar un cliente (Nuevo cliente → Nuevo lugar).
 */
@Component({
  selector: 'app-vista-lugares',
  imports: [FormsModule, RouterLink],
  templateUrl: './vista-lugares.html',
  host: { class: 'pila' },
  styles: `
    .estado + .estado { margin-top: 20px; }
    .estado-cabeza {
      display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 12px;
      padding-bottom: 8px; margin-bottom: 10px; border-bottom: 1px solid var(--borde-suave);
    }
    .estado-cabeza h3 { margin: 0; font-size: 1rem; font-weight: 600; }
    .estado-cabeza span { font-size: 0.8125rem; color: var(--tinta-3); font-variant-numeric: tabular-nums; }
    .barras { --etiqueta: 220px; }
    .lugar-boton {
      display: block; width: 100%; padding: 0; border: 0; background: none; font: inherit;
      font-size: 0.875rem; font-weight: 500; color: var(--acento-oscuro); text-align: left; cursor: pointer;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .lugar-boton:hover { text-decoration: underline; }
    .lugar-boton.on { color: var(--tinta); font-weight: 700; }
    /* Con el dedo, el nombre del lugar es un botón de 44 px. */
    @media (max-width: 899px), (pointer: coarse) { .lugar-boton { min-height: 44px; } }
    .sin-lugar { margin: 16px 0 0; font-size: 0.875rem; }
    table.grid.de-lugar { min-width: 560px; }
    .chico { font-size: 0.75rem; margin-top: 2px; }
    .tel { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .nota-medida { margin: 12px 0 0; font-size: 0.8125rem; }
  `,
})
export class VistaLugares {
  private readonly clientes = inject(ClientesService);
  private readonly auth = inject(AuthService);

  readonly datos = input.required<LugaresEntrega>();
  /** Se corrigió un lugar: la pantalla vuelve a pedir la lista. */
  readonly corregido = output<void>();

  readonly ESTADOS = ESTADOS_MX;
  /** "Venderle" abre el punto de venta con el cliente ya elegido: solo a quien lo puede abrir. */
  readonly vePos = computed(() => this.auth.puede('ver:pos'));

  readonly seleccion = signal<Seleccion | null>(null);
  readonly lista = signal<Cliente[] | null>(null);
  readonly totalLista = signal(0);
  readonly cargandoLista = signal(false);

  // --- Corregir un lugar ---
  readonly corrigiendo = signal<LugarEntrega | null>(null);
  readonly guardando = signal(false);
  readonly errorCorregir = signal<string | null>(null);
  nombreLugar = '';
  estadoLugar = '';

  /** Con lugar = activos − sin lugar. */
  private readonly conLugar = computed(() => Math.max(0, this.datos().clientes_activos - this.datos().sin_lugar));

  readonly kpis = computed(() => {
    const d = this.datos();
    const estados = new Set(d.lugares.map((l) => l.estado)).size;
    const top = [...d.lugares].sort((a, b) => (b.num_clientes ?? 0) - (a.num_clientes ?? 0))[0];
    return [
      {
        etiqueta: 'Lugares de entrega',
        valor: String(d.lugares.length),
        pie: d.lugares.length
          ? `en ${plural(estados, 'estado', 'estados')}`
          : 'todavía ninguno: se dan de alta al capturar un cliente',
        punto: COLOR.serie1,
      },
      {
        etiqueta: 'Clientes con lugar',
        valor: `${this.conLugar()} de ${d.clientes_activos}`,
        pie: d.sin_lugar ? `${plural(d.sin_lugar, 'cliente activo', 'clientes activos')} todavía sin lugar` : 'todos los activos tienen su lugar',
        punto: d.sin_lugar ? COLOR.ambar : COLOR.serie1,
      },
      {
        etiqueta: 'Donde más entregas',
        valor: top && top.num_clientes ? top.nombre : '—',
        pie: top && top.num_clientes ? `${plural(top.num_clientes, 'cliente', 'clientes')} · ${top.estado}` : 'nadie todavía',
        punto: COLOR.serie2,
      },
    ];
  });

  /**
   * Por estado, del que tiene más clientes al que menos; adentro, sus lugares
   * igual. La barra de cada lugar es su parte de TODOS los clientes activos.
   */
  readonly porEstado = computed(() => {
    const d = this.datos();
    const base = Math.max(1, d.clientes_activos);
    const grupos = new Map<string, LugarEntrega[]>();
    for (const l of d.lugares) {
      const g = grupos.get(l.estado) ?? [];
      g.push(l);
      grupos.set(l.estado, g);
    }
    return [...grupos.entries()]
      .map(([estado, lugares]) => {
        const total = lugares.reduce((s, l) => s + (l.num_clientes ?? 0), 0);
        return {
          estado,
          total,
          pct: Math.round((total / base) * 100),
          lugares: [...lugares]
            .sort((a, b) => (b.num_clientes ?? 0) - (a.num_clientes ?? 0) || a.nombre.localeCompare(b.nombre, 'es'))
            .map((l) => ({
              l,
              pct: Math.round(((l.num_clientes ?? 0) / base) * 100),
              ancho: ((l.num_clientes ?? 0) / base) * 100,
            })),
        };
      })
      .sort((a, b) => b.total - a.total || a.estado.localeCompare(b.estado, 'es'));
  });

  /** El título de la lista de abajo. */
  readonly tituloLista = computed(() => {
    const s = this.seleccion();
    if (!s) return '';
    return s.tipo === 'sin' ? 'Clientes sin lugar de entrega' : `Clientes en ${s.lugar.nombre}, ${s.lugar.estado}`;
  });

  plural = plural;

  esElegido(l: LugarEntrega): boolean {
    const s = this.seleccion();
    return s?.tipo === 'lugar' && s.lugar.id === l.id;
  }

  ver(sel: Seleccion): void {
    this.seleccion.set(sel);
    this.lista.set(null);
    this.cargandoLista.set(true);
    const filtros = sel.tipo === 'sin'
      ? { sin_lugar: true, activo: true, orden: 'nombre' as const, limit: 100 }
      : { lugar_entrega_id: sel.lugar.id, activo: true, orden: 'nombre' as const, limit: 100 };
    this.clientes.listar(filtros).subscribe({
      next: (r) => {
        this.lista.set(r.items);
        this.totalLista.set(r.total);
        this.cargandoLista.set(false);
      },
      error: () => {
        this.lista.set([]);
        this.totalLista.set(0);
        this.cargandoLista.set(false);
      },
    });
  }

  verLugar(l: LugarEntrega): void {
    this.ver({ tipo: 'lugar', lugar: l });
  }

  verSinLugar(): void {
    this.ver({ tipo: 'sin' });
  }

  // ------------------------------------------------------------ corregir

  abrirCorregir(l: LugarEntrega): void {
    this.nombreLugar = l.nombre;
    this.estadoLugar = l.estado;
    this.errorCorregir.set(null);
    this.corrigiendo.set(l);
  }

  cerrarCorregir(): void {
    if (!this.guardando()) this.corrigiendo.set(null);
  }

  guardarCorreccion(): void {
    const l = this.corrigiendo();
    if (!l) return;
    const nombre = this.nombreLugar.trim();
    const estado = this.estadoLugar.trim();
    if (!nombre || !estado) {
      this.errorCorregir.set(!nombre ? 'Pon el municipio o el lugar.' : 'Pon el estado.');
      return;
    }
    this.guardando.set(true);
    this.errorCorregir.set(null);
    this.clientes.corregirLugar(l.id, { nombre, estado }).subscribe({
      next: (nuevo) => {
        this.guardando.set(false);
        this.corrigiendo.set(null);
        // La lista de abajo ya dice el nombre nuevo.
        const s = this.seleccion();
        if (s?.tipo === 'lugar' && s.lugar.id === l.id) this.seleccion.set({ tipo: 'lugar', lugar: { ...s.lugar, ...nuevo } });
        this.corregido.emit();
      },
      error: (e) => {
        this.guardando.set(false);
        const api = (e as { error?: { error?: ApiError } })?.error?.error;
        this.errorCorregir.set(api?.message ?? 'No se pudo corregir el lugar.');
      },
    });
  }
}
