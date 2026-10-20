import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ClientesService } from '../../../core/services/clientes.service';
import { AuthService } from '../../../core/services/auth.service';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { Cliente, ClienteInput, LugarEntrega } from '../../../core/models/clientes.models';
import { TipoCliente } from '../../../core/models/catalogo.models';
import { ApiError } from '../../../core/models/auth.models';
import { hoyLocal } from '../../../shared/fecha.pipe';
import { ESTADOS_MX } from './clientes-ui';

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
 *
 * 2026-10-14 (usuario): sin "Como le dicen" ni "Cumpleaños"; el NÚMERO DE
 * CLIENTE lo da el sistema al guardar (C-0001) y aquí solo se ve; y el LUGAR DE
 * ENTREGA (municipio y estado, de una lista que se amplía aquí mismo) para
 * contar a cuántos clientes se les entrega en cada lugar. Al editar un cliente
 * de antes, su apodo y su cumpleaños se conservan: no se mandan y el servidor
 * deja lo que tenía.
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
    .field .error-campo { font-size: 0.75rem; font-weight: 400; color: var(--peligro-t); }
    .intro { margin: 0 0 16px; }
    .sin-margen { margin: 0; }
    .sin-margen-arriba { margin-top: 0; }
    .numero { background: var(--fondo); color: var(--tinta); cursor: default; }
    .elige-lugar { display: flex; gap: 8px; align-items: center; }
    .elige-lugar > select { flex: 1 1 auto; min-width: 0; }
    .elige-lugar > .btn { flex: 0 0 auto; }
    .nuevo-lugar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .nuevo-lugar > input { flex: 1 1 180px; min-width: 0; }
    .nuevo-lugar > .botones { display: flex; gap: 8px; }
  `,
})
export class ClienteFormModal implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly clientes = inject(ClientesService);
  private readonly catalogo = inject(CatalogoService);

  /** Cliente a editar; `null` = alta. */
  readonly cliente = input<Cliente | null>(null);
  private readonly auth = inject(AuthService);
  /** Darle o subirle el crédito (2026-10-19): directo, o pedirlo con autorización. */
  readonly puedeDarCredito = () => this.auth.puede('hacer:dar_credito');
  readonly puedePedirCredito = () => this.auth.puedeOPide('hacer:dar_credito');

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
  /** Los lugares de entrega, para elegir uno. */
  readonly lugares = signal<LugarEntrega[]>([]);

  // --- Alta de un lugar sin salir del cliente ---
  readonly agregandoLugar = signal(false);
  readonly guardandoLugar = signal(false);
  readonly errorLugar = signal<string | null>(null);
  readonly lugarNombre = new FormControl('', { nonNullable: true });
  readonly lugarEstado = new FormControl('', { nonNullable: true });

  /** Los 32 estados, de sugerencia: así "Hidalgo" se escribe igual en todos los lugares. */
  readonly ESTADOS = ESTADOS_MX;

  /** Cómo llegó. Son las respuestas de siempre; el campo admite otra cosa. */
  readonly origenes = ['Recomendación', 'Ya era cliente', 'Pasó por la tienda',
                       'Redes sociales', 'Tienda en línea'];

  readonly form = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.minLength(1)]],
    telefono: [''],
    telefono_alt: [''],
    correo: [''],
    rfc: [''],
    tipo_cliente_id: [null as number | null],
    direccion: [''],
    ciudad: [''],
    estado: [''],
    lugar_entrega_id: [null as number | null],
    como_llego: [''],
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
    // Quien no lo da ni lo pide no lo mueve (sigue yendo al guardar: getRawValue).
    if (!this.puedePedirCredito()) this.form.controls.limite_credito.disable();
    const c = this.cliente();
    if (c) {
      this.form.reset({
        nombre: c.nombre,
        telefono: c.telefono ?? '',
        telefono_alt: c.telefono_alt ?? '',
        correo: c.correo ?? '',
        rfc: c.rfc ?? '',
        tipo_cliente_id: c.tipo_cliente_id ?? null,
        direccion: c.direccion ?? '',
        ciudad: c.ciudad ?? '',
        estado: c.estado ?? '',
        lugar_entrega_id: c.lugar_entrega_id ? Number(c.lugar_entrega_id) : null,
        como_llego: c.como_llego ?? '',
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
    // Sin la lista de lugares el cliente se guarda igual, sin lugar.
    this.clientes.lugaresEntrega().subscribe({
      next: (r) => this.lugares.set(r.lugares),
      error: () => this.lugares.set([]),
    });
  }

  // ------------------------------------------------------------ lugar de entrega

  abrirLugar(): void {
    // Propone el estado del lugar elegido o, si no hay, el que más lugares
    // tiene: los clientes de la tienda suelen ser de la misma región.
    const elegido = this.lugares().find((l) => l.id === this.form.getRawValue().lugar_entrega_id);
    this.lugarNombre.setValue('');
    this.lugarEstado.setValue(elegido?.estado ?? this.estadoMasComun());
    this.errorLugar.set(null);
    this.agregandoLugar.set(true);
  }

  private estadoMasComun(): string {
    const cuenta = new Map<string, number>();
    for (const l of this.lugares()) cuenta.set(l.estado, (cuenta.get(l.estado) ?? 0) + 1);
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  }

  cancelarLugar(): void {
    this.agregandoLugar.set(false);
    this.errorLugar.set(null);
  }

  guardarLugar(): void {
    const nombre = this.lugarNombre.value.trim();
    const estado = this.lugarEstado.value.trim();
    if (!nombre || !estado) {
      this.errorLugar.set(!nombre ? 'Pon el municipio o el lugar.' : 'Pon el estado.');
      return;
    }
    this.guardandoLugar.set(true);
    this.errorLugar.set(null);
    this.clientes.crearLugar({ nombre, estado }).subscribe({
      next: (l) => {
        this.guardandoLugar.set(false);
        this.lugares.set([...this.lugares(), l].sort((a, b) =>
          a.estado.localeCompare(b.estado, 'es') || a.nombre.localeCompare(b.nombre, 'es')));
        this.form.patchValue({ lugar_entrega_id: l.id });
        this.agregandoLugar.set(false);
      },
      error: (e) => {
        this.guardandoLugar.set(false);
        const api = (e as { error?: { error?: ApiError & { detalles?: { id?: number } } } })?.error?.error;
        // Ya estaba en la lista: se elige ese, no hace falta otro.
        const ya = api?.code === 'LUGAR_REPETIDO' ? this.lugares().find((l) => l.id === api.detalles?.id) : null;
        if (ya) {
          this.form.patchValue({ lugar_entrega_id: ya.id });
          this.agregandoLugar.set(false);
          return;
        }
        this.errorLugar.set(api?.message ?? 'No se pudo guardar el lugar.');
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
    // Los opcionales vacíos van como null y no como cadena vacía: un `correo`
    // en '' choca con el UNIQUE en cuanto hay dos clientes sin correo. El número
    // de cliente no va: lo da el sistema.
    const limpio = (x: string) => (x.trim() === '' ? null : x.trim());
    const body: ClienteInput = {
      nombre: v.nombre.trim(),
      telefono: limpio(v.telefono),
      telefono_alt: limpio(v.telefono_alt),
      correo: limpio(v.correo),
      rfc: limpio(v.rfc),
      tipo_cliente_id: v.tipo_cliente_id || null,
      direccion: limpio(v.direccion),
      ciudad: limpio(v.ciudad),
      estado: limpio(v.estado),
      lugar_entrega_id: v.lugar_entrega_id || null,
      como_llego: limpio(v.como_llego),
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
    // Se conservan la lista de precios, el lugar de entrega y el "cómo llegó":
    // al capturar de corrido suelen repetirse (los de un mismo pueblo van
    // juntos). Lo demás arranca vacío, y "cliente desde" en hoy.
    const { tipo_cliente_id, lugar_entrega_id, como_llego } = this.form.getRawValue();
    this.form.reset();
    this.form.patchValue({ tipo_cliente_id, lugar_entrega_id, como_llego, cliente_desde: hoyLocal() });
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
