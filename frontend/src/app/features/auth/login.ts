import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ApiError, SesionActual } from '../../core/models/auth.models';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './auth.scss',
})
export class Login {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    correo: ['', [Validators.required, Validators.email]],
    contrasena: ['', [Validators.required, Validators.minLength(1)]],
  });

  enviar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.cargando.set(true);
    this.error.set(null);

    const { correo, contrasena } = this.form.getRawValue();
    this.auth.login(correo, contrasena).subscribe({
      next: (sesion) => this.router.navigateByUrl(this.destino(sesion)),
      error: (err) => {
        this.error.set(this.mensajeError(err));
        this.cargando.set(false);
      },
    });
  }

  /** Destino tras el login: returnUrl si existe; si no, panel (staff) o tienda (cliente). */
  private destino(sesion: SesionActual): string {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    if (returnUrl) return returnUrl;
    return sesion.tipo === 'usuario' ? '/admin' : '/tienda';
  }

  private mensajeError(err: unknown): string {
    const apiErr = (err as { error?: { error?: ApiError } })?.error?.error;
    if (apiErr?.message) return apiErr.message;
    if ((err as ApiError)?.message) return (err as ApiError).message;
    return 'No se pudo iniciar sesión. Revisa tus datos o la conexión.';
  }
}
