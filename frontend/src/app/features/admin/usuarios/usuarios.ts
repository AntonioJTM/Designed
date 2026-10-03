import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UsuariosService } from '../../../core/services/usuarios.service';
import { AuthService } from '../../../core/services/auth.service';
import { ApiError, Rol, Usuario } from '../../../core/models/auth.models';
import { FechaPipe, hoyLocal } from '../../../shared/fecha.pipe';
import { UsuarioFormModal } from './usuario-form-modal';

/** "administrador" → "Administrador": los puestos se guardan en minúscula. */
export function nombrePuesto(rol: string | null | undefined): string {
  const r = (rol ?? '').trim();
  return r ? r.charAt(0).toUpperCase() + r.slice(1) : '—';
}

/**
 * Personal (rediseño 2026-10): quién trabaja en la tienda y en qué puesto. Lo
 * que puede hacer cada puesto se decide en Permisos, que es solo del
 * administrador; por eso el botón "Ver permisos" solo le aparece a él.
 *
 * NUNCA se muestra una contraseña ni su hash: el backend no los manda en el
 * listado (`CAMPOS_PUBLICOS`) y aquí solo se teclea una nueva al dar de alta o
 * para restablecerla.
 *
 * El puesto de administrador lo da y lo quita solo otro administrador: con el
 * permiso de Personal, un gerente podría darse a sí mismo —o a quien sea— acceso
 * a sueldos, costos y permisos.
 */
@Component({
  selector: 'app-usuarios',
  imports: [RouterLink, UsuarioFormModal],
  templateUrl: './usuarios.html',
})
export class Usuarios {
  private readonly api = inject(UsuariosService);
  private readonly auth = inject(AuthService);
  private readonly fechaPipe = new FechaPipe();

  readonly usuarios = signal<Usuario[]>([]);
  readonly roles = signal<Rol[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);

  /** `null` = cerrado, `'nuevo'` = alta, un usuario = edición de ese renglón. */
  readonly modal = signal<Usuario | 'nuevo' | null>(null);

  /** Permisos es solo del administrador: a nadie más se le enlaza. */
  readonly esAdmin = computed(() => this.auth.esAdmin());

  /** Los puestos que se pueden asignar desde esta sesión. */
  readonly rolesAsignables = computed(() =>
    this.esAdmin() ? this.roles() : this.roles().filter((r) => r.nombre !== 'administrador')
  );

  /** Activos primero, y dentro de cada grupo por nombre. */
  readonly ordenados = computed(() =>
    [...this.usuarios()].sort(
      (a, b) => Number(!!b.activo) - Number(!!a.activo) || a.nombre.localeCompare(b.nombre)
    )
  );

  constructor() {
    this.api.roles().subscribe({
      next: (r) => this.roles.set(r),
      error: (e) => this.error.set(this.msg(e)),
    });
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.api.listar().subscribe({
      next: (u) => {
        this.usuarios.set(u);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  puesto(u: Usuario): string {
    return nombrePuesto(u.rol);
  }

  /** Administrador y gerente en azul (deciden); el resto en gris. */
  puestoAzul(u: Usuario): boolean {
    return u.rol === 'administrador' || u.rol === 'gerente';
  }

  /** Solo un administrador edita a un administrador (ver la nota de la clase). */
  puedeEditar(u: Usuario): boolean {
    return this.esAdmin() || u.rol !== 'administrador';
  }

  /** "hoy 9:02", "ayer 18:30" o la fecha completa: así se lee de un vistazo quién entró. */
  acceso(u: Usuario): string {
    if (!u.ultimo_acceso) return 'Nunca ha entrado';
    const limpio = String(u.ultimo_acceso).replace('T', ' ').replace('Z', '').trim();
    const [dia, hora = ''] = limpio.split(' ');
    const hhmm = hora.slice(0, 5).replace(/^0(\d)/, '$1');
    const hoy = hoyLocal();
    if (dia === hoy) return `hoy ${hhmm}`.trim();
    const ayer = new Date(`${hoy}T12:00:00`);
    ayer.setDate(ayer.getDate() - 1);
    const p = (n: number) => String(n).padStart(2, '0');
    if (dia === `${ayer.getFullYear()}-${p(ayer.getMonth() + 1)}-${p(ayer.getDate())}`) {
      return `ayer ${hhmm}`.trim();
    }
    return this.fechaPipe.transform(limpio);
  }

  /** Usuario que edita el modal (`null` cuando es un alta). */
  usuarioModal(): Usuario | null {
    const m = this.modal();
    return m === 'nuevo' || m === null ? null : m;
  }

  abrirNuevo(): void {
    this.mensaje.set(null);
    this.error.set(null);
    this.modal.set('nuevo');
  }

  abrirEdicion(u: Usuario): void {
    if (!this.puedeEditar(u)) return;
    this.mensaje.set(null);
    this.error.set(null);
    this.modal.set(u);
  }

  guardado(u: Usuario, eraAlta: boolean): void {
    this.mensaje.set(eraAlta ? `${u.nombre} quedó dado de alta.` : `Se guardaron los cambios de ${u.nombre}.`);
    this.cargar();
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
