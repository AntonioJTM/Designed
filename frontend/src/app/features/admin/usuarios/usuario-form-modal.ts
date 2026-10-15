import { Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { UsuariosService } from '../../../core/services/usuarios.service';
import { ApiError, Rol, Usuario } from '../../../core/models/auth.models';

/**
 * Alta y edición de un empleado, en modal sobre el listado de Personal. No pide
 * nada al servidor: el renglón trae al usuario y el listado ya tiene los
 * puestos, así que entran por input y el modal abre armado.
 *
 * Una persona puede tener VARIOS puestos (2026-10-06): el PRINCIPAL (el select:
 * el que sale en nómina) y los que tiene ADEMÁS (las casillas de "También
 * trabaja como"). Puede lo de todos juntos. Las casillas nunca ofrecen el
 * principal, y al guardar se descarta si quedó marcado de antes.
 *
 * La contraseña solo se TECLEA: al dar de alta es obligatoria y al editar sirve
 * para restablecerla. Nunca se muestra la que tiene, ni su hash (el backend no
 * los manda).
 *
 * El CARGADOR (2026-10-14) es un puesto que NO entra al sistema
 * (`entra_al_sistema: false`): con él elegido se esconden el correo, la
 * contraseña y los otros puestos, y el alta va sin ellos. Sí sale en Nómina.
 * Si alguien que entraba pasa a cargador, se le avisa que deja de entrar; si un
 * cargador pasa a un puesto que entra, se le piden correo y contraseña.
 */
@Component({
  selector: 'app-usuario-form-modal',
  imports: [ReactiveFormsModule],
  templateUrl: './usuario-form-modal.html',
  styleUrl: './usuario-form-modal.scss',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class UsuarioFormModal implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(UsuariosService);
  private readonly destroyRef = inject(DestroyRef);

  /** Usuario a editar; `null` = alta. */
  readonly usuario = input<Usuario | null>(null);
  /** Los puestos que esta sesión puede asignar (sin "administrador" si no lo es). */
  readonly roles = input<Rol[]>([]);

  readonly cerrado = output<void>();
  readonly guardado = output<Usuario>();

  readonly esEdicion = computed(() => this.usuario() !== null);

  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  /** Los puestos que tiene ADEMÁS del principal (ids). */
  readonly otros = signal<number[]>([]);

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
    // Cambiar el puesto cambia si lleva correo y contraseña (el cargador no).
    this.form.controls.rol_id.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.ajustarAcceso());
    const u = this.usuario();
    if (!u) {
      this.form.patchValue({ rol_id: this.rolPorOmision() });
      this.ajustarAcceso();
      return;
    }
    this.otros.set((u.otros_roles ?? []).map((r) => r.id));
    this.form.reset({
      rol_id: u.rol_id,
      nombre: u.nombre,
      correo: u.correo ?? '',
      telefono: u.telefono ?? '',
      contrasena: '',
      activo: !!u.activo,
    });
    this.ajustarAcceso();
  }

  /** El puesto principal que está elegido. */
  rolElegido(): Rol | undefined {
    const id = this.form.controls.rol_id.value;
    return this.roles().find((r) => r.id === id);
  }

  /**
   * ¿El puesto elegido NO entra al sistema (el cargador)? Es un MÉTODO y no un
   * `computed`: el puesto es un control del formulario, no una señal.
   */
  sinAcceso(): boolean {
    return this.rolElegido()?.entra_al_sistema === false;
  }

  /** Lo que se edita ya entraba al sistema (tiene correo). */
  teniaAcceso(): boolean {
    return !!this.usuario()?.correo;
  }

  /**
   * Se teclea el correo (y la contraseña es obligatoria) cuando todavía no tiene
   * con qué entrar: en el alta de alguien que entra, o cuando un cargador pasa a
   * un puesto que sí entra.
   */
  pideCorreo(): boolean {
    return !this.sinAcceso() && !this.teniaAcceso();
  }

  /** Entraba al sistema y lo están pasando a un puesto que no entra: se le avisa. */
  pierdeAcceso(): boolean {
    return this.esEdicion() && this.teniaAcceso() && this.sinAcceso();
  }

  /**
   * Prende o apaga el correo y la contraseña según el puesto. Apagados no
   * validan, así el cargador se guarda sin ellos. El correo de quien ya entra
   * se queda apagado: no se cambia, es con lo que entra.
   */
  private ajustarAcceso(): void {
    const { correo, contrasena } = this.form.controls;
    if (this.sinAcceso()) {
      correo.disable({ emitEvent: false });
      contrasena.disable({ emitEvent: false });
      return;
    }
    if (this.pideCorreo()) correo.enable({ emitEvent: false });
    else correo.disable({ emitEvent: false });
    contrasena.enable({ emitEvent: false });
    contrasena.setValidators(
      this.pideCorreo() ? [Validators.required, Validators.minLength(8)] : [Validators.minLength(8)]
    );
    contrasena.updateValueAndValidity({ emitEvent: false });
  }

  guardar(): void {
    // Si los puestos llegaron después de abrir, el alta arranca como cajero igual.
    if (this.form.controls.rol_id.value === null) {
      this.form.patchValue({ rol_id: this.rolPorOmision() });
    }
    this.ajustarAcceso();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.guardando.set(true);
    this.error.set(null);

    const v = this.form.getRawValue();
    const u = this.usuario();
    // El cargador no entra al sistema: va sin correo, sin contraseña y sin otros puestos.
    const sin = this.sinAcceso();
    const otros_roles = sin ? [] : this.otrosParaGuardar(v.rol_id);
    const obs = u
      ? this.api.actualizar(u.id, {
          rol_id: v.rol_id!,
          otros_roles,
          nombre: v.nombre.trim(),
          telefono: v.telefono.trim() || null,
          activo: v.activo,
          correo: this.pideCorreo() ? v.correo.trim() : undefined,
          contrasena: sin ? undefined : v.contrasena.trim() || undefined,
        })
      : this.api.crear({
          rol_id: v.rol_id!,
          otros_roles,
          nombre: v.nombre.trim(),
          telefono: v.telefono.trim() || undefined,
          ...(sin ? {} : { correo: v.correo.trim(), contrasena: v.contrasena }),
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
  nombrePuesto(r: Rol | undefined): string {
    return r?.nombre ? r.nombre.charAt(0).toUpperCase() + r.nombre.slice(1) : '';
  }

  /**
   * Los puestos que se pueden marcar como "además": todos menos el principal.
   * Es un MÉTODO y no un `computed`: el principal es un control del formulario,
   * no una señal, y un `computed` se quedaría con el primero que vio.
   */
  otrosDisponibles(): Rol[] {
    const principal = this.form.controls.rol_id.value;
    // El que no entra al sistema (el cargador) no se da "además": no daría nada.
    return this.roles().filter((r) => r.id !== principal && r.entra_al_sistema !== false);
  }

  tieneOtro(id: number): boolean {
    return this.otros().includes(id);
  }

  alternarOtro(id: number, marcado: boolean): void {
    this.otros.update((o) => (marcado ? [...new Set([...o, id])] : o.filter((x) => x !== id)));
  }

  /** Lo que se manda: sin el principal y solo de los puestos que esta sesión puede dar. */
  private otrosParaGuardar(principal: number | null): number[] {
    const asignables = new Set(this.otrosDisponibles().map((r) => r.id));
    return this.otros().filter((id) => id !== principal && asignables.has(id));
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
