import { AfterViewInit, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { MENU } from '../../core/navegacion';
import { fechaRelativa } from '../../shared/fecha.pipe';
import { CantidadPipe } from '../../shared/cantidad.pipe';

/**
 * El marco del panel: el menú por tareas a la izquierda (rediseño 2026-10) y la
 * pantalla a la derecha. El menú enseña solo lo que el puesto puede ver
 * (Administración → Permisos); lo mismo cuida la guarda de cada ruta.
 */
@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CantidadPipe],
  templateUrl: './admin-layout.html',
  styleUrls: ['./admin-layout.scss', './admin-avisos.scss'],
  host: {
    '(document:keydown.escape)': 'abierto.set(false)',
    '(document:click)': 'clicAfuera($event)',
    '(window:resize)': 'revisarMenu()',
  },
})
export class AdminLayout implements AfterViewInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notif = inject(NotificacionesService);

  readonly sesion = this.auth.sesion;

  /** El menú de este puesto: los grupos vacíos no se dibujan. */
  readonly grupos = computed(() => {
    this.sesion(); // se recalcula al llegar el perfil
    return MENU.map((g) => ({ ...g, opciones: g.opciones.filter((o) => this.auth.puede(o.permiso)) })).filter(
      (g) => g.opciones.length > 0
    );
  });

  /**
   * Lo que está esperando a alguien: solicitudes de las sucursales por surtir,
   * envíos por firmar de recibido, existencias bajo su mínimo, cobranza y
   * clientes. Cada quien ve solo los avisos de lo que su puesto atiende.
   */
  readonly pendientes = this.notif.pendientes;
  readonly abierto = signal(false);
  /** En el celular el menú se abre y se cierra; en pantalla grande siempre está. */
  readonly menuAbierto = signal(false);

  readonly veMercancia = computed(() => { this.sesion(); return this.auth.puede('ver:surtir'); });
  readonly veInventario = computed(() => { this.sesion(); return this.auth.puede('ver:inventario'); });
  readonly veCatalogo = computed(() => { this.sesion(); return this.auth.puede('ver:catalogo'); });
  readonly veClientes = computed(() => { this.sesion(); return this.auth.puede('ver:clientes'); });
  readonly veApartados = computed(() => { this.sesion(); return this.auth.puede('ver:apartados'); });
  readonly veHoy = computed(() => { this.sesion(); return this.auth.puede('ver:hoy'); });

  /** Los trazos de los iconos del panel de avisos (los mismos de Hoy). */
  readonly ICONO = {
    envio: 'M2 6h12v10H2z M14 10h4l3 3v3h-7 M6 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M17 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    existencias: 'M3 8l9-5 9 5v8l-9 5-9-5z M3 8l9 5 9-5 M12 13v8',
    precio: 'M3 12V4h8l10 10-8 8z M7.5 8.5h.01',
    apartado: 'M6 3h12v18l-6-4-6 4z',
    cobro: 'M3 7h18v11H3z M3 11h18 M7 15h4',
    gente: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5',
  };

  /** El globo cuenta solo lo que este puesto puede atender. */
  readonly total = computed(() => {
    const p = this.pendientes();
    if (!p) return 0;
    let n = 0;
    if (this.veMercancia()) n += p.traspasos_por_enviar.length + p.traspasos_por_recibir.length;
    if (this.veInventario() && p.alertas_stock > 0) n += 1;
    if (this.veCatalogo() && (p.sin_precio?.num ?? 0) > 0) n += 1;
    if (this.veApartados() && (p.apartados_listos?.num ?? 0) > 0) n += 1;
    if (this.veClientes()) {
      if ((p.cobranza?.num_clientes ?? 0) > 0) n += 1;
      if ((p.enfriados?.num_clientes ?? 0) > 0) n += 1;
      if ((p.nuevos_sin_credito?.num_clientes ?? 0) > 0) n += 1;
    }
    return n;
  });

  /**
   * La lista del menú se desplaza SIN barra visible (el usuario pidió quitarla).
   * Para que se note que hay más opciones abajo, el final se desvanece mientras
   * quede algo por ver; al llegar al fondo, el desvanecido se quita.
   */
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');
  readonly masAbajo = signal(false);

  revisarMenu(): void {
    const n = this.menu()?.nativeElement;
    if (!n) return;
    this.masAbajo.set(n.scrollTop + n.clientHeight < n.scrollHeight - 4);
  }

  ngAfterViewInit(): void {
    // El menú llega completo cuando llega el perfil (permisos): se revisa al
    // dibujarse y otra vez un momento después.
    this.revisarMenu();
    setTimeout(() => this.revisarMenu(), 300);
  }

  constructor() {
    // Al recargar directo en /admin, la sesión en memoria puede estar vacía;
    // recuperamos el perfil desde el token para saber nombre, puesto y permisos.
    if (!this.auth.sesion()) {
      this.auth.cargarPerfil().subscribe({ next: () => {}, error: () => {} });
    }
    this.notif.iniciar();
    // En el celular el menú se cierra solo al elegir una pantalla.
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.menuAbierto.set(false));
  }

  /** Abre o cierra el menú en el celular. */
  alternarMenu(): void {
    this.menuAbierto.update((v) => !v);
  }

  alternar(): void {
    this.abierto.update((v) => !v);
    // Al abrirla se refresca: si acabas de surtir algo, el número debe bajar.
    if (this.abierto()) this.notif.refrescar();
  }

  /** Dinero para los avisos de la campana. */
  dinero(v: unknown): string {
    return Number(v ?? 0).toLocaleString('es-MX', {
      style: 'currency',
      currency: 'MXN',
      maximumFractionDigits: 0,
    });
  }

  /** "CAMEL 2/30, OPTIK 2/30 y 1 más": los hilos sin precio, en un renglón. */
  hilosSinPrecio(p: { num: number; hilos: { nombre: string; calibre: string | null }[] }): string {
    const nombres = p.hilos.slice(0, 3).map((h) => `${h.nombre}${h.calibre ? ' ' + h.calibre : ''}`);
    const resto = p.num - nombres.length;
    return resto > 0 ? `${nombres.join(', ')} y ${resto} más` : nombres.join(', ');
  }

  /** "hoy a las 0:18", "ayer a las 18:40", "el 30/09 a las 15:10". */
  cuando(iso: string | null | undefined): string {
    return fechaRelativa(iso);
  }

  /**
   * El panel se cierra al tocar fuera de él, como cualquier menú que se
   * despliega: no hay nada que capturar ahí, así que no se pierde nada.
   */
  clicAfuera(ev: MouseEvent): void {
    if (!this.abierto()) return;
    const t = ev.target as HTMLElement | null;
    if (t?.closest('.avisos') || t?.closest('.campana')) return;
    this.abierto.set(false);
  }

  /** Al tocar un pendiente se va a su pantalla y se cierra el panel. */
  irA(ruta: string): void {
    this.abierto.set(false);
    this.router.navigateByUrl(ruta);
  }

  salir(): void {
    this.notif.detener();
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
