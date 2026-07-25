import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { Categoria } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';

@Component({
  selector: 'app-categorias',
  imports: [ReactiveFormsModule],
  templateUrl: './categorias.html',
})
export class Categorias {
  private readonly fb = inject(FormBuilder);
  private readonly catalogo = inject(CatalogoService);

  readonly categorias = signal<Categoria[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly editandoId = signal<number | null>(null);

  readonly form = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.minLength(1)]],
    descripcion: [''],
    calibres: [''],
    orden: [0],
    activo: [true],
  });

  constructor() {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.catalogo.listarCategorias().subscribe({
      next: (p) => {
        this.categorias.set(p.items);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.cargando.set(false);
      },
    });
  }

  nueva(): void {
    this.editandoId.set(null);
    this.form.reset({ nombre: '', descripcion: '', calibres: '', orden: 0, activo: true });
  }

  editar(c: Categoria): void {
    this.editandoId.set(c.id);
    this.form.reset({
      nombre: c.nombre,
      descripcion: c.descripcion ?? '',
      calibres: c.calibres ?? '',
      orden: c.orden,
      activo: !!c.activo,
    });
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.guardando.set(true);
    this.error.set(null);

    const v = this.form.getRawValue();
    const body: Partial<Categoria> = {
      nombre: v.nombre,
      descripcion: v.descripcion.trim() || undefined,
      calibres: v.calibres.trim() || null,
      orden: v.orden,
      activo: v.activo,
    };

    const id = this.editandoId();
    const obs = id
      ? this.catalogo.actualizarCategoria(id, body)
      : this.catalogo.crearCategoria(body);

    obs.subscribe({
      next: () => {
        this.guardando.set(false);
        this.nueva();
        this.cargar();
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.guardando.set(false);
      },
    });
  }

  eliminar(c: Categoria): void {
    if (!confirm(`¿Eliminar el material "${c.nombre}"?`)) return;
    this.catalogo.eliminarCategoria(c.id).subscribe({
      next: () => this.cargar(),
      error: (e) => this.error.set(this.msg(e)),
    });
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
