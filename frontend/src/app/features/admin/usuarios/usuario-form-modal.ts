import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { UsuariosService } from '../../../core/services/usuarios.service';
import { ApiError, Rol, Usuario } from '../../../core/models/auth.models';

/**
 * Alta y edición de un empleado, en modal sobre el listado de Personal. No pide
 * nada al servidor: el renglón trae al usuario y el listado ya tiene los
 * puestos, así que entran por input y el modal abre armado.
 *
 * La contraseña solo se TECLEA: al dar de alta es obligatoria y al editar sirve
 * para restablecerla. Nunca se muestra la que tiene, ni su hash (el backend no
 * los manda).
 */
@Component({
  selector: 'app-usuario-form-modal',
  imports: [ReactiveFormsModule],
  templateUrl: './usuario-form-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class UsuarioFormModal implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(UsuariosService);

  /** Usuario a editar; `null` = alta. */
  readonly usuario = input<Usuario | null>(null);
  /** Los puestos que esta sesión puede asignar (sin "administrador" si no lo es). */
  readonly roles = input<Rol[]>([]);

  readonly cerrado = output<void>();
  readonly guardado = output<Usuario>();

  readonly esEdicion = computed(() => this.usuario() !== null);

  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    rol_id: [null as number | null, Validators.required],
    nombre: ['', [Validators.required, Validators.minLength(2)]],
    correo: ['', [Validators.required, Validators.email]],
    telefono: [''],
    contrasena: ['', [Validators.required, Validators.minLength(8)]],
    activo: [true],
  });

  /**
   * Los inputs se leen aquí y NO en el constructor: ahí las señales de input
   * todavía no están asignadas y el modal abriría en blanco.
   */
  ngOnInit(): void {
    const u = this.usuario();
    if (!u) {
      this.form.patchValue({ rol_id: this.rolPorOmision() });
      return;
    }
    this.form.reset({
      rol_id: u.rol_id,
      nombre: u.nombre,
      correo: u.correo,
      telefono: u.telefono ?? '',
      contrasena: '',
      activo: !!u.activo,
    });
    // Al editar, el correo no se cambia (es con lo que entra) y la contraseña
    // es opcional: solo si se quiere restablecer.
    this.form.controls.correo.disable();
    this.form.controls.contrasena.setValidators([Validators.minLength(8)]);
    this.form.controls.contrasena.updateValueAndValidity();
  }

  guardar(): void {
    // Si los puestos llegaron después de abrir, el alta arranca como cajero igual.
    if (this.form.controls.rol_id.value === null) {
      this.form.patchValue({ rol_id: this.rolPorOmision() });
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.guardando.set(true);
    this.error.set(null);

    const v = this.form.getRawValue();
    const u = this.usuario();
    const obs = u
      ? this.api.actualizar(u.id, {
          rol_id: v.rol_id!,
          nombre: v.nombre.trim(),
          telefono: v.telefono.trim() || null,
          activo: v.activo,
          contrasena: v.contrasena.trim() || undefined,
        })
      : this.api.crear({
          rol_id: v.rol_id!,
          nombre: v.nombre.trim(),
          correo: v.correo.trim(),
          telefono: v.telefono.trim() || undefined,
          contrasena: v.contrasena,
        });

    obs.subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.guardado.emit(r);
        this.cerrar();
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.guardando.set(false);
      },
    });
  }

  /** "cajero" → "Cajero": los puestos se guardan en minúscula. */
  nombrePuesto(r: Rol): string {
    return r.nombre ? r.nombre.charAt(0).toUpperCase() + r.nombre.slice(1) : '';
  }

  cerrar(): void {
    this.cerrado.emit();
  }

  /**
   * Con qué puesto arranca un alta: CAJERO, no el primero de la lista. El
   * primero es "administrador" y un descuido al dar de alta a alguien de
   * mostrador le daba acceso a sueldos, costos y configuración.
   */
  private rolPorOmision(): number | null {
    const r = this.roles();
    return (r.find((x) => x.nombre === 'cajero') ?? r.find((x) => x.nombre !== 'administrador') ?? r[0])?.id ?? null;
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
