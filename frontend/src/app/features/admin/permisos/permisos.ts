import { Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RedisenoService } from '../../../core/services/rediseno.service';
import { MatrizPermisos, PermisoCatalogo, RolPermisos } from '../../../core/models/rediseno.models';
import { ApiError } from '../../../core/models/auth.models';

interface GrupoFilas {
  titulo: string;
  filas: PermisoCatalogo[];
}

/**
 * PERMISOS (rediseño 2026-10): qué ve y qué puede hacer cada puesto. Lo decide
 * el administrador —"los permisos los asigna el administrador"—, y por eso esta
 * pantalla es solo suya.
 *
 * Es una matriz puesto × permiso. La columna del administrador está fija y
 * marcada: lo puede todo siempre, para que nunca se quede nadie sin poder
 * entrar aquí. Los cambios se acumulan en pantalla y se guardan juntos; el
 * servidor los aplica en el acto a lo que valida (`hacer:*`), y el menú de cada
 * persona cambia la próxima vez que entre.
 */
@Component({
  selector: 'app-permisos',
  imports: [FormsModule, RouterLink, NgTemplateOutlet],
  templateUrl: './permisos.html',
  host: { '(document:keydown.escape)': 'cerrarNuevo()' },
  styles: `
    table.matriz th.puesto { text-align: center; min-width: 120px; }
    table.matriz th.puesto span { display: block; font-weight: 400; font-size: 12px; color: var(--tinta-3); }
    table.matriz td.marca { text-align: center; }
    table.matriz td.marca input { width: 20px; height: 20px; accent-color: var(--acento); cursor: pointer; }
    table.matriz td.marca input:disabled { cursor: default; }
    table.matriz td.que b { font-weight: 500; display: block; }
    table.matriz td.que span { font-size: 13px; color: var(--tinta-3); }
    table.matriz tr.cambiada td { background: #F7F9FE; }
    .barra-guardar { position: sticky; bottom: 16px; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; border-radius: 10px; background: var(--barra); color: #fff; box-shadow: 0 8px 24px rgba(18, 22, 31, 0.25); }
    .barra-guardar .acciones { display: flex; gap: 10px; }
    .barra-guardar .btn-ghost { background: transparent; color: #fff; border-color: #333A48; }
  `,
})
export class PermisosPantalla {
  private readonly api = inject(RedisenoService);

  readonly matriz = signal<MatrizPermisos | null>(null);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  readonly guardando = signal(false);
  /** Lo que se ha marcado en pantalla y no se ha guardado, por puesto. */
  readonly borrador = signal<Record<number, Set<string>>>({});

  readonly roles = computed<RolPermisos[]>(() => {
    const m = this.matriz();
    if (!m) return [];
    // El administrador va primero: es la columna de referencia, la que no cambia.
    // Los demás, en el orden en que se dieron de alta (gerente, cajero,
    // almacenista y luego los puestos nuevos), que es de más a menos permisos.
    return [...m.roles].sort((a, b) => Number(b.es_admin) - Number(a.es_admin) || a.id - b.id);
  });

  readonly pantallas = computed(() => this.agrupar('pantalla'));
  readonly acciones = computed(() => this.agrupar('accion'));

  /** Puestos con cambios sin guardar. */
  readonly pendientes = computed(() => {
    const b = this.borrador();
    return this.roles().filter((r) => b[r.id] && !this.iguales(b[r.id], new Set(r.claves)));
  });

  // ---- Nuevo puesto ----
  readonly nuevoAbierto = signal(false);
  readonly creando = signal(false);
  readonly errorNuevo = signal<string | null>(null);
  nuevo = { nombre: '', copiarDe: null as number | null };

  constructor() {
    this.cargar();
  }

  cargar(): void {
    this.api.permisos().subscribe({
      next: (m) => {
        this.matriz.set(m);
        this.borrador.set({});
      },
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  private agrupar(tipo: 'pantalla' | 'accion'): GrupoFilas[] {
    const grupos: GrupoFilas[] = [];
    for (const p of this.matriz()?.catalogo ?? []) {
      if (p.tipo !== tipo) continue;
      let g = grupos.find((x) => x.titulo === p.grupo);
      if (!g) grupos.push((g = { titulo: p.grupo, filas: [] }));
      g.filas.push(p);
    }
    return grupos;
  }

  /** Lo que tiene el puesto en pantalla: su borrador si lo tocaron, si no lo guardado. */
  private claves(r: RolPermisos): Set<string> {
    return this.borrador()[r.id] ?? new Set(r.claves);
  }

  marcado(r: RolPermisos, clave: string): boolean {
    return r.es_admin || this.claves(r).has(clave);
  }

  /** ¿Esta fila tiene algún cambio sin guardar? Para resaltarla. */
  filaCambiada(clave: string): boolean {
    const b = this.borrador();
    return this.roles().some((r) => b[r.id] && b[r.id].has(clave) !== r.claves.includes(clave));
  }

  alternar(r: RolPermisos, clave: string, valor: boolean): void {
    if (r.es_admin) return;
    this.mensaje.set(null);
    const nuevas = new Set(this.claves(r));
    if (valor) nuevas.add(clave);
    else nuevas.delete(clave);
    this.borrador.update((b) => ({ ...b, [r.id]: nuevas }));
  }

  descartar(): void {
    this.borrador.set({});
    this.mensaje.set(null);
  }

  /** Guarda los puestos que cambiaron, uno tras otro; si uno falla, se detiene ahí. */
  guardar(): void {
    const cola = this.pendientes();
    if (cola.length === 0) return;
    this.guardando.set(true);
    this.error.set(null);
    const nombres = cola.map((r) => this.nombre(r));
    const siguiente = (i: number): void => {
      if (i >= cola.length) {
        this.guardando.set(false);
        this.borrador.set({});
        this.mensaje.set(
          `Listo: se guardaron los permisos de ${nombres.join(', ')}. ` +
            'Lo que el servidor valida aplica ya; el menú cambia la próxima vez que la persona entre.'
        );
        return;
      }
      const r = cola[i];
      this.api.guardarPermisos(r.id, [...this.borrador()[r.id]]).subscribe({
        next: (m) => {
          // La respuesta trae la matriz completa: se toma y se sigue con el
          // borrador de los que faltan.
          this.matriz.set(m);
          siguiente(i + 1);
        },
        error: (e) => {
          this.guardando.set(false);
          this.error.set(`No se guardó ${this.nombre(r)}: ${this.msg(e)}`);
        },
      });
    };
    siguiente(0);
  }

  abrirNuevo(): void {
    this.nuevo = { nombre: '', copiarDe: null };
    this.errorNuevo.set(null);
    this.nuevoAbierto.set(true);
  }

  cerrarNuevo(): void {
    this.nuevoAbierto.set(false);
  }

  crearPuesto(): void {
    const nombre = this.nuevo.nombre.trim();
    if (nombre.length < 2) {
      this.errorNuevo.set('Ponle nombre al puesto, por ejemplo "Encargado de sucursal".');
      return;
    }
    this.creando.set(true);
    this.errorNuevo.set(null);
    this.api.crearPuesto(nombre, this.nuevo.copiarDe).subscribe({
      next: (m) => {
        this.creando.set(false);
        this.nuevoAbierto.set(false);
        // Lo que se estuviera editando se conserva: crear un puesto no lo pisa.
        this.matriz.set(m);
        this.mensaje.set(
          `Puesto «${nombre}» creado. Ajusta abajo lo que puede hacer y luego asígnalo a alguien en Personal.`
        );
      },
      error: (e) => {
        this.creando.set(false);
        this.errorNuevo.set(this.msg(e));
      },
    });
  }

  /** Los puestos se guardan en minúsculas ("cajero"); en pantalla van con mayúscula. */
  nombre(r: { nombre: string }): string {
    return r.nombre.charAt(0).toUpperCase() + r.nombre.slice(1);
  }

  private iguales(a: Set<string>, b: Set<string>): boolean {
    return a.size === b.size && [...a].every((x) => b.has(x));
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
