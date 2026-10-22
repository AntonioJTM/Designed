import { Component, computed, input, signal } from '@angular/core';
import { DetalleCarga, HiloCarga, LoteCarga } from '../../../core/models/autorizaciones.models';
import { CantidadPipe } from '../../../shared/cantidad.pipe';
import { DineroPipe } from '../../../shared/dinero.pipe';
import { FechaPipe } from '../../../shared/fecha.pipe';

/** Cuántos hilos se ven sin tocar "Ver los N hilos". */
export const HILOS_A_LA_VISTA = 6;

/**
 * QUÉ SE VA A CARGAR, dentro de la solicitud (2026-10-21, usuario: "en la
 * solicitud solo me sale el resumen y yo quiero datos más específicos: qué color
 * de hilo, peso de paquetes"). Lo arma el servidor con lo que se guardó al
 * pedirla (`remesas/solicitud.js`) y aquí solo se enseña, igual que en "Revisa y
 * confirma" de Surtir inventario: cada hilo con su material, línea, si ya existe
 * y cuánto hay hoy de él en ese almacén; tocar el color abre sus lotes y cada
 * paquete (renglón del Excel, código, peso y conos).
 */
@Component({
  selector: 'app-carga-solicitud',
  imports: [CantidadPipe, DineroPipe, FechaPipe],
  templateUrl: './carga-solicitud.html',
  // Los lotes y paquetes se ven como en Surtir inventario: la MISMA hoja.
  styleUrls: ['./carga-solicitud.scss', '../remesas/carga-lista-paquetes.scss'],
})
export class CargaSolicitud {
  readonly carga = input.required<DetalleCarga>();
  /** El id de la solicitud, para los ids de la página. */
  readonly solicitud = input.required<number>();

  readonly HILOS = HILOS_A_LA_VISTA;
  readonly verTodos = signal(false);
  private readonly abiertos = signal<ReadonlySet<string>>(new Set());

  readonly visibles = computed(() => {
    const h = this.carga().hilos;
    return this.verTodos() ? h : h.slice(0, HILOS_A_LA_VISTA);
  });

  readonly hayCosto = computed(() => this.carga().ve_costos && this.carga().hilos.some((h) => h.costo_kg != null));

  /** Lo que hay hoy en el almacén: solo a quien ve sus existencias. */
  readonly hayHoy = computed(() => this.carga().ve_existencias);

  /** Las columnas de la tabla (la de los paquetes ocupa todas). */
  readonly columnas = computed(() => 6 + (this.hayHoy() ? 1 : 0) + (this.hayCosto() ? 1 : 0));

  /** De quién llegó y con qué papeles; solo lo que se capturó. */
  readonly papeles = computed(() => {
    const p = this.carga().papeles;
    const lista: { k: string; v: string; mono?: boolean; fecha?: boolean }[] = [];
    if (p.proveedor) lista.push({ k: 'Proveedor', v: p.proveedor });
    if (p.documento) lista.push({ k: 'Lista', v: p.documento });
    if (p.factura) lista.push({ k: 'Factura', v: p.factura, mono: true });
    if (p.pedimento) lista.push({ k: 'Pedimento', v: p.pedimento, mono: true });
    if (p.contenedor) lista.push({ k: 'Contenedor', v: p.contenedor, mono: true });
    if (p.fecha_ingreso) lista.push({ k: 'Llegó el', v: p.fecha_ingreso, fecha: true });
    if (p.notas) lista.push({ k: 'Notas', v: p.notas });
    return lista;
  });

  alternar(clave: string): void {
    const s = new Set(this.abiertos());
    if (s.has(clave)) s.delete(clave);
    else s.add(clave);
    this.abiertos.set(s);
  }

  abierto(clave: string): boolean {
    return this.abiertos().has(clave);
  }

  /** "18.5 a 19.85"; un solo número si todos pesan igual. */
  rango(h: HiloCarga): string {
    if (h.peso_min == null) return '—';
    return h.peso_min === h.peso_max ? `${h.peso_min}` : `${h.peso_min} a ${h.peso_max}`;
  }

  /** Lo que habrá de este hilo en el almacén al cargarlo. */
  despues(h: HiloCarga): number {
    return Math.round(((h.hoy_kg ?? 0) + h.kg) * 1000) / 1000;
  }

  /** Los lotes de un hilo, para el título del renglón ("0094878 y 0094879"). */
  nombresLotes(h: HiloCarga): string {
    return h.lotes.map((l) => l.lote ?? 'sin lote').join(', ');
  }

  registradosDe(l: LoteCarga): number {
    return l.bultos.filter((b) => b.registrado).length;
  }

  /** "1 paquete", "2 paquetes". */
  plural(n: number, uno: string, varios: string): string {
    return `${n.toLocaleString('es-MX')} ${n === 1 ? uno : varios}`;
  }
}
