import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ClientesService } from '../../../core/services/clientes.service';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { Cliente } from '../../../core/models/clientes.models';
import { TipoCliente } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';
import { hoyLocal } from '../../../shared/fecha.pipe';

/**
 * Alta y edición del cliente, en modal sobre el listado.
 *
 * El único campo OBLIGATORIO es el nombre. Es a propósito: el usuario dijo que
 * va a capturar sus clientes de años uno por uno, y exigirle correo o dirección
 * a alguien que solo sabe "Doña Chela, la del teléfono tal" haría que no los
 * capturara. Lo demás se completa cuando se sepa.
 *
 * Las listas de precio SÍ se piden al servidor, así que el formulario se dibuja
 * completo desde el primer cuadro y se tapa con el velo mientras cargan, en vez
 * de pintar un "Cargando…" chico que luego crece.
 *
 * Al dar de ALTA no se cierra solo: ofrece capturar otro (el usuario va a
 * capturar sus clientes de años uno tras otro, y reabrir el modal cada vez
 * sobra) o ir a su expediente. Al editar, sí se cierra al guardar.
 */
@Component({
  selector: 'app-cliente-form-modal',
  imports: [ReactiveFormsModule],
  templateUrl: './cliente-form-modal.html',
  host: { '(document:keydown.escape)': 'cerrar()' },
  styles: `
    .grupo { grid-column: 1 / -1; margin: 6px 0 -4px; }
    .grupo:first-child { margin-top: 0; }
    .req { color: var(--peligro-t); font-weight: 700; }
    .moneda { position: relative; display: block; }
    .moneda > span { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--tinta-3); font-weight: 600; }
    .moneda > input { padding-left: 26px; }
    .field .error-campo { font-size: 12px; font-weight: 400; color: var(--peligro-t); }
  `,
})
export class ClienteFormModal implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly clientes = inject(ClientesService);
  private readonly catalogo = inject(CatalogoService);

  /** Cliente a editar; `null` = alta. */
  readonly cliente = input<Cliente | null>(null);

  readonly cerrado = output<void>();
  readonly guardado = output<Cliente>();
  /** "Ver su expediente" después de un alta. */
  readonly irAExpediente = output<number>();

  /** Cliente recién creado: mientras está puesto, el modal ofrece el paso siguiente. */
  readonly creado = signal<Cliente | null>(null);

  readonly esEdicion = computed(() => this.cliente() !== null);

  readonly guardando = signal(false);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly tipos = signal<TipoCliente[]>([]);

  /** Cómo llegó. Son las respuestas de siempre; el campo admite otra cosa. */
  readonly origenes = ['Recomendación', 'Ya era cliente', 'Pasó por la tienda',
                       'Redes sociales', 'Tienda en línea'];

  readonly form = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.minLength(1)]],
    nombre_comercial: [''],
    codigo: [''],
    telefono: [''],
    telefono_alt: [''],
    correo: [''],
    rfc: [''],
    tipo_cliente_id: [null as number | null],
    direccion: [''],
    ciudad: [''],
    estado: [''],
    como_llego: [''],
    fecha_nacimiento: [''],
    cliente_desde: [''],
    limite_credito: [0],
    notas: [''],
    activo: [true],
  });

  /**
   * El input se lee AQUÍ y no en el constructor: las señales de input todavía no
   * están asignadas cuando corre el constructor y el modal abriría en blanco.
   * Ya pasó con el modal de producto y hay pruebas que lo cubren.
   */
  ngOnInit(): void {
    const c = this.cliente();
    if (c) {
      this.form.reset({
        nombre: c.nombre,
        nombre_comercial: c.nombre_comercial ?? '',
        codigo: c.codigo ?? '',
        telefono: c.telefono ?? '',
        telefono_alt: c.telefono_alt ?? '',
        correo: c.correo ?? '',
        rfc: c.rfc ?? '',
        tipo_cliente_id: c.tipo_cliente_id ?? null,
        direccion: c.direccion ?? '',
        ciudad: c.ciudad ?? '',
        estado: c.estado ?? '',
        como_llego: c.como_llego ?? '',
        fecha_nacimiento: c.fecha_nacimiento ?? '',
        cliente_desde: c.cliente_desde ?? '',
        limite_credito: Number(c.limite_credito ?? 0),
        notas: c.notas ?? '',
        activo: !!c.activo,
      });
    } else {
      // Un cliente nuevo es cliente desde hoy; si es de años, se corrige. En
      // hora LOCAL: `toISOString()` da el día en UTC y después de las 18:00 ya
      // decía mañana.
      this.form.patchValue({ cliente_desde: hoyLocal() });
    }

    this.catalogo.tiposCliente().subscribe({
      next: (t) => {
        this.tipos.set(t.filter((x) => x.activo));
        this.cargando.set(false);
      },
      error: () => {
        // Sin listas de precio el cliente se puede capturar igual: cobrará el
        // precio público. No vale la pena bloquear el alta por esto.
        this.tipos.set([]);
        this.cargando.set(false);
      },
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
    // Los opcionales vacíos van como null y no como cadena vacía: un `codigo`
    // en '' choca con el UNIQUE en cuanto hay dos clientes sin código.
    const limpio = (x: string) => (x.trim() === '' ? null : x.trim());
    const body = {
      nombre: v.nombre.trim(),
      nombre_comercial: limpio(v.nombre_comercial),
      codigo: limpio(v.codigo),
      telefono: limpio(v.telefono),
      telefono_alt: limpio(v.telefono_alt),
      correo: limpio(v.correo),
      rfc: limpio(v.rfc),
      tipo_cliente_id: v.tipo_cliente_id || null,
      direccion: limpio(v.direccion),
      ciudad: limpio(v.ciudad),
      estado: limpio(v.estado),
      como_llego: limpio(v.como_llego),
      fecha_nacimiento: limpio(v.fecha_nacimiento),
      cliente_desde: limpio(v.cliente_desde),
      limite_credito: Number(v.limite_credito) || 0,
      notas: limpio(v.notas),
      activo: v.activo,
    };

    const c = this.cliente();
    const obs = c ? this.clientes.actualizar(c.id, body) : this.clientes.crear(body);

    obs.subscribe({
      next: (r) => {
        this.guardando.set(false);
        // La pantalla de atrás se recarga en los dos casos. Al editar no hay
        // nada más que decir; al crear se ofrece el siguiente paso.
        this.guardado.emit(r);
        if (c) this.cerrar();
        else this.creado.set(r);
      },
      error: (e) => {
        this.error.set(this.msg(e));
        this.guardando.set(false);
      },
    });
  }

  /** Guardó uno y quiere capturar el siguiente sin cerrar el modal. */
  otro(): void {
    this.creado.set(null);
    this.error.set(null);
    // Se conserva la lista de precios y el "cómo llegó": al capturar de corrido
    // suelen repetirse. Lo demás arranca vacío, y "cliente desde" en hoy.
    const { tipo_cliente_id, como_llego } = this.form.getRawValue();
    this.form.reset();
    this.form.patchValue({ tipo_cliente_id, como_llego, cliente_desde: hoyLocal() });
  }

  cerrar(): void {
    this.cerrado.emit();
  }

  /** Los DECIMAL llegan como texto. */
  num(v: unknown): number {
    return Number(v ?? 0);
  }

  private msg(e: unknown): string {
    const api = (e as { error?: { error?: ApiError } })?.error?.error;
    return api?.message ?? 'Ocurrió un error.';
  }
}
