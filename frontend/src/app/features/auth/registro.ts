import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ApiError } from '../../core/models/auth.models';

@Component({
  selector: 'app-registro',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './registro.html',
  styleUrl: './auth.scss',
})
export class Registro {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  // El registro público es solo para clientes de la tienda.
  readonly form = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.minLength(2)]],
    correo: ['', [Validators.required, Validators.email]],
    telefono: [''],
    contrasena: ['', [Validators.required, Validators.minLength(8)]],
    acepta_marketing: [false],
  });

  enviar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.cargando.set(true);
    this.error.set(null);

    const v = this.form.getRawValue();
    this.auth
      .registrarCliente({
        nombre: v.nombre,
        correo: v.correo,
        contrasena: v.contrasena,
        telefono: v.telefono.trim() || undefined,
        acepta_marketing: v.acepta_marketing,
      })
      .subscribe({
        next: () => this.router.navigateByUrl('/tienda'),
        error: (err) => {
          this.error.set(this.mensajeError(err));
          this.cargando.set(false);
        },
      });
  }

  private mensajeError(err: unknown): string {
    const apiErr = (err as { error?: { error?: ApiError } })?.error?.error;
    if (apiErr?.message) return apiErr.message;
    if ((err as ApiError)?.message) return (err as ApiError).message;
    return 'No se pudo completar el registro.';
  }
}
