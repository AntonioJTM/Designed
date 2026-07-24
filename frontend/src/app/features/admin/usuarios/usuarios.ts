import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { UsuariosService } from '../../../core/services/usuarios.service';
import { Rol, Usuario } from '../../../core/models/auth.models';
import { ApiError } from '../../../core/models/auth.models';

@Component({
  selector: 'app-usuarios',
  imports: [ReactiveFormsModule],
  templateUrl: './usuarios.html',
})
export class Usuarios {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(UsuariosService);

  readonly usuarios = signal<Usuario[]>([]);
  readonly roles = signal<Rol[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly mensaje = signal<string | null>(null);
  readonly editandoId = signal<number | null>(null);

  readonly form = this.fb.nonNullable.group({
    rol_id: [null as number | null, Validators.required],
    nombre: ['', [Validators.required, Validators.minLength(2)]],
    correo: ['', [Validators.required, Validators.email]],
    telefono: [''],
    contrasena: [''],
    activo: [true],
  });

  constructor() {
    this.api.roles().subscribe({
      next: (r) => {
        this.roles.set(r);
        if (r[0]) this.form.patchValue({ rol_id: r[0].id });
      },
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

  nuevo(): void {
    this.editandoId.set(null);
    this.form.reset({
      rol_id: this.roles()[0]?.id ?? null,
      nombre: '',
      correo: '',
      telefono: '',
      contrasena: '',
      activo: true,
    });
    this.form.get('correo')?.enable();
    this.form.get('contrasena')?.setValidators([Validators.required, Validators.minLength(8)]);
    this.form.get('contrasena')?.updateValueAndValidity();
  }

  editar(u: Usuario): void {
    this.editandoId.set(u.id);
    this.form.reset({
      rol_id: u.rol_id,
      nombre: u.nombre,
      correo: u.correo,
      telefono: u.telefono ?? '',
      contrasena: '',
      activo: !!u.activo,
    });
    // Al editar, el correo no se cambia y la contraseña es opcional (solo si se quiere resetear).
    this.form.get('correo')?.disable();
    this.form.get('contrasena')?.clearValidators();
    this.form.get('contrasena')?.updateValueAndValidity();
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    this.mensaje.set(null);

    const v = this.form.getRawValue();
    const id = this.editandoId();

    if (id) {
      this.api
        .actualizar(id, {
          rol_id: v.rol_id!,
          nombre: v.nombre,
          telefono: v.telefono.trim() || null,
          activo: v.activo,
          contrasena: v.contrasena.trim() || undefined,
        })
        .subscribe({
          next: () => this.tras('Usuario actualizado.'),
          error: (e) => this.fallo(e),
        });
    } else {
      this.api
        .crear({
          rol_id: v.rol_id!,
          nombre: v.nombre,
          correo: v.correo,
          telefono: v.telefono.trim() || undefined,
          contrasena: v.contrasena,
        })
        .subscribe({
          next: () => this.tras('Usuario dado de alta.'),
          error: (e) => this.fallo(e),
        });
    }
  }

  private tras(msg: string): void {
    this.guardando.set(false);
    this.mensaje.set(msg);
    this.nuevo();
    this.cargar();
  }

  private fallo(e: unknown): void {
    this.error.set(this.msg(e));
    this.guardando.set(false);
  }

  private msg(e: unknown): string {
    return (e as { error?: { error?: ApiError } })?.error?.error?.message ?? 'Ocurrió un error.';
  }
}
