import { Component, OnInit, effect, inject, input, model, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  DatosCarga,
  DatosCargaEnvio,
  InventarioService,
  Proveedor,
} from '../../../core/services/inventario.service';
import { ApiError } from '../../../core/models/auth.models';
import { hoyLocal } from '../../../shared/fecha.pipe';

/** Una carga en blanco: sin proveedor ni papeles, y llegó hoy. */
export function datosCargaVacios(): DatosCarga {
  return { proveedor_id: null, factura: '', pedimento: '', contenedor: '', fecha_ingreso: hoyLocal(), costo_kg: null };
}

/**
 * Lo que se manda al servidor. Lo vacío no viaja (es "no se sabe"); el costo
 * solo si `conCosto` (administración y contabilidad): si alguien más lo
 * mandara, el servidor contesta 403.
 */
export function datosParaEnviar(d: DatosCarga, conCosto: boolean): DatosCargaEnvio {
  const texto = (v: string) => (v ?? '').trim() || undefined;
  const envio: DatosCargaEnvio = {
    proveedor_id: d.proveedor_id ?? undefined,
    factura: texto(d.factura),
    pedimento: texto(d.pedimento),
    contenedor: texto(d.contenedor),
    fecha_ingreso: texto(d.fecha_ingreso),
  };
  if (conCosto && d.costo_kg != null && Number(d.costo_kg) > 0) envio.costo_kg = Number(d.costo_kg);
  return envio;
}

/** Para comparar nombres de proveedor: sin mayúsculas, acentos ni espacios de más. */
const normal = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * LOS DATOS DE LA CARGA (2026-10-06, "surtir inventario"): de quién llegó la
 * mercancía y con qué papeles —proveedor, factura, pedimento, contenedor y fecha
 * de ingreso— y, solo para administración y contabilidad, el costo por kilo.
 *
 * Es el mismo bloque en los tres lugares donde se carga mercancía (un hilo, la
 * lista con varios colores y la pantalla de presentaciones) y en la corrección
 * desde el historial. Todo es opcional: se completa después.
 *
 * El proveedor se elige de una LISTA (así no queda escrito de tres formas) y, si
 * es nuevo, se da de alta ahí mismo con su nombre. Si el archivo trae un
 * proveedor (`sugerido`) y ya está en la lista, viene elegido; si no, se ofrece
 * darlo de alta.
 */
@Component({
  selector: 'app-datos-carga',
  imports: [FormsModule],
  templateUrl: './datos-carga.html',
  styleUrl: './datos-carga.scss',
})
export class DatosCargaCampos implements OnInit {
  private readonly inv = inject(InventarioService);

  readonly datos = model.required<DatosCarga>();
  /** Se pide el costo por kilo (quien ve costos, en la carga de UN hilo). */
  readonly conCosto = input(false);
  /** El proveedor que dice el archivo, para proponerlo. */
  readonly sugerido = input<string | null>(null);

  readonly proveedores = signal<Proveedor[]>([]);
  readonly agregando = signal(false);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  nuevoNombre = '';
  readonly hoy = hoyLocal();

  constructor() {
    // El proveedor del archivo puede llegar DESPUÉS de abrir la pantalla (en la
    // lista con varios colores se sube el archivo luego): cuando llegan él o la
    // lista de proveedores, se intenta elegirlo.
    effect(() => {
      this.sugerido();
      this.proveedores();
      untracked(() => this.elegirSugerido());
    });
  }

  /** Los inputs se leen aquí: en el constructor todavía no están puestos. */
  ngOnInit(): void {
    this.inv.proveedores().subscribe({
      next: (ps) => this.proveedores.set(ps),
      error: () => this.proveedores.set([]),
    });
  }

  /** Si el archivo trae un proveedor que ya existe y no se ha elegido otro, se elige. */
  private elegirSugerido(): void {
    const s = this.sugerido();
    if (!s || this.datos().proveedor_id) return;
    const p = this.proveedores().find((x) => normal(x.nombre) === normal(s));
    if (p) this.cambiar('proveedor_id', p.id);
  }

  /** El archivo dice un proveedor que no está en la lista: se ofrece darlo de alta. */
  sugeridoNuevo(): string | null {
    const s = this.sugerido();
    if (!s || this.datos().proveedor_id) return null;
    return this.proveedores().some((x) => normal(x.nombre) === normal(s)) ? null : s;
  }

  cambiar<K extends keyof DatosCarga>(campo: K, valor: DatosCarga[K]): void {
    this.datos.update((d) => ({ ...d, [campo]: valor }));
  }

  abrirNuevo(nombre = ''): void {
    this.nuevoNombre = nombre;
    this.error.set(null);
    this.agregando.set(true);
  }

  /** Da de alta el proveedor y lo deja elegido. Si ya existía, elige el que está. */
  guardarNuevo(): void {
    const nombre = this.nuevoNombre.replace(/\s+/g, ' ').trim();
    if (!nombre) {
      this.error.set('Escribe el nombre del proveedor.');
      return;
    }
    this.guardando.set(true);
    this.inv.crearProveedor(nombre).subscribe({
      next: (p) => {
        this.guardando.set(false);
        this.proveedores.update((ps) => [...ps, p].sort((a, b) => a.nombre.localeCompare(b.nombre)));
        this.cambiar('proveedor_id', p.id);
        this.agregando.set(false);
      },
      error: (e) => {
        this.guardando.set(false);
        const err = (e as { error?: { error?: ApiError } })?.error?.error;
        const existente = this.proveedores().find((x) => normal(x.nombre) === normal(nombre));
        if (err?.code === 'PROVEEDOR_REPETIDO' && existente) {
          this.cambiar('proveedor_id', existente.id);
          this.agregando.set(false);
          return;
        }
        this.error.set(err?.message ?? 'No se pudo dar de alta el proveedor.');
      },
    });
  }
}
