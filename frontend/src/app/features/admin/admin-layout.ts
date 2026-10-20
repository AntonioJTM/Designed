import { AfterViewInit, Component, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, NavigationStart, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { MENU } from '../../core/navegacion';
import { fechaRelativa } from '../../shared/fecha.pipe';
import { DESTINO_AVISO, urlDe } from '../../core/avisos';
import { CantidadPipe } from '../../shared/cantidad.pipe';
import { TiempoRealService } from '../../core/services/tiempo-real.service';
import { PERMISOS_QUE_AUTORIZAN } from '../../core/models/autorizaciones.models';
import { MiClaveModal } from '../../shared/autorizacion/mi-clave-modal';
import { MisVacacionesModal } from './nomina/mis-vacaciones-modal';

/**
 * El marco del panel: el menú por tareas a la izquierda (rediseño 2026-10) y la
 * pantalla a la derecha. El menú enseña solo lo que el puesto puede ver
 * (Administración → Permisos); lo mismo cuida la guarda de cada ruta.
 */
@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CantidadPipe, MiClaveModal, MisVacacionesModal],
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
  private readonly tiempoReal = inject(TiempoRealService);
  private readonly injector = inject(Injector);
  private readonly titulo = inject(Title);

  /** Lo que se le dice al lector de pantalla al llegar a otra pantalla. */
  readonly anuncio = signal('');
  /** La primera pantalla (al entrar o recargar) no se anuncia: ya la dice el navegador. */
  private primeraPantalla = true;
  /** La ruta sin `?filtros`: cambiar un filtro no es cambiar de pantalla. */
  private rutaAnterior = '';
  /** El enlace de la pantalla que se apretó (una pestaña de Clientes), para devolverle el cursor. */
  private enlaceAntes: string | null = null;

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
  readonly veNotas = computed(() => { this.sesion(); return this.auth.puede('ver:notas_pendientes'); });
  readonly veHoy = computed(() => { this.sesion(); return this.auth.puede('ver:hoy'); });
  /** El aviso del WhatsApp de la tienda: lo atiende quien entra a Configuración. */
  readonly veConfig = computed(() => { this.sesion(); return this.auth.puede('ver:config'); });
  readonly veAutorizaciones = computed(() => { this.sesion(); return this.auth.puede('ver:autorizaciones'); });
  /** Autoriza algo (lo hace directo): ve "Mi clave para autorizar". */
  readonly autoriza = computed(() => { this.sesion(); return PERMISOS_QUE_AUTORIZAN.some((c) => this.auth.puede(c)); });
  readonly miClave = signal(false);
  /** "Mis vacaciones" (2026-10-19): quien las puede pedir. */
  readonly pideVacaciones = computed(() => { this.sesion(); return this.auth.puede('pedir:vacaciones'); });
  readonly misVacaciones = signal(false);

  /** Los trazos de los iconos del panel de avisos (los mismos de Hoy). */
  readonly ICONO = {
    envio: 'M2 6h12v10H2z M14 10h4l3 3v3h-7 M6 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M17 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    existencias: 'M3 8l9-5 9 5v8l-9 5-9-5z M3 8l9 5 9-5 M12 13v8',
    precio: 'M3 12V4h8l10 10-8 8z M7.5 8.5h.01',
    nota: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
    cobro: 'M3 7h18v11H3z M3 11h18 M7 15h4',
    gente: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5',
    // Un círculo con su palomita (una autorización).
    autoriza: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M8.5 12l2.5 2.5 4.5-5',
    // Un globo de chat, con su colita (el WhatsApp de la tienda).
    chat: 'M20.5 11.5a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.6-4.2A8.5 8.5 0 1 1 20.5 11.5z',
  };

  /** El globo cuenta solo lo que este puesto puede atender. */
  readonly total = computed(() => {
    const p = this.pendientes();
    if (!p) return 0;
    let n = 0;
    if (this.veConfig() && p.whatsapp) n += 1;
    // Las solicitudes que esperan SU autorización: el servidor ya las cuenta por persona.
    if (this.veAutorizaciones() && (p.autorizaciones?.num ?? 0) > 0) n += 1;
    if (p.mi_clave_apagada) n += 1;
    if (this.veMercancia()) n += p.traspasos_por_enviar.length + p.traspasos_por_recibir.length;
    if (this.veInventario() && p.alertas_stock > 0) n += 1;
    if (this.veCatalogo() && (p.sin_precio?.num ?? 0) > 0) n += 1;
    if (this.veNotas() && (p.notas_pendientes?.num ?? 0) > 0) n += 1;
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
    // La conexión en vivo (2026-10-19): lo que otros guarden se ve sin recargar.
    this.tiempoReal.iniciar();
    // En el celular el menú se cierra solo al elegir una pantalla.
    this.router.events.pipe(filter((e) => e instanceof NavigationStart)).subscribe(() => {
      const a = document.activeElement;
      this.enlaceAntes = a instanceof HTMLAnchorElement && a.closest('.main') ? a.getAttribute('href') : null;
    });
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => {
      this.menuAbierto.set(false);
      this.llegarAPantalla(e.urlAfterRedirects);
    });
  }

  /**
   * AL CAMBIAR DE PANTALLA (2026-10-13, auditoría): antes el cursor se quedaba
   * en la opción del menú que se apretó y el lector de pantalla no se enteraba
   * de que había otra pantalla. Ahora:
   *   · si el cursor estaba en el menú (o se perdió porque el enlace que se
   *     apretó ya no existe), pasa al título de la pantalla nueva, que el
   *     lector lee; el siguiente Tab ya recorre la pantalla, no el menú;
   *   · si estaba dentro de la pantalla (una pestaña de Clientes, un filtro),
   *     se queda ahí —en la pestaña nueva, si la pantalla se volvió a dibujar—
   *     y solo se anuncia el nombre de la pantalla.
   * Una pantalla que pone su propio cursor (el lector del punto de venta) lo
   * pone después y manda ella.
   */
  private llegarAPantalla(url: string): void {
    const ruta = url.split(/[?#]/)[0];
    const otra = ruta !== this.rutaAnterior;
    this.rutaAnterior = ruta;
    if (this.primeraPantalla) {
      this.primeraPantalla = false;
      return;
    }
    if (!otra) return;
    afterNextRender(() => {
      const activo = document.activeElement;
      const perdido = !activo || activo === document.body || !activo.isConnected;
      const enMenu = !!activo?.closest('.side');
      const nombre = this.titulo.getTitle().split(' · ').slice(0, -1).filter((p) => p !== 'PRUEBAS').join(' · ');
      // La pestaña que se apretó se volvió a dibujar: el cursor vuelve a ella.
      const mismo = perdido && this.enlaceAntes
        ? document.querySelector<HTMLElement>(`.main a[href="${CSS.escape(this.enlaceAntes)}"]`)
        : null;
      if (mismo) mismo.focus();
      if ((perdido && !mismo) || enMenu) {
        this.enfocarContenido();
        this.anuncio.set('');
      } else {
        // Se vacía y se vuelve a poner: el lector solo habla cuando el texto cambia.
        this.anuncio.set('');
        setTimeout(() => this.anuncio.set(nombre), 50);
      }
    }, { injector: this.injector });
  }

  /** "Saltar al contenido": sin cambiar la dirección (el `#` movería el router). */
  irAlContenido(e: Event): void {
    e.preventDefault();
    this.enfocarContenido();
  }

  /** El cursor al título de la pantalla; si todavía no hay título, a la pantalla misma. */
  private enfocarContenido(): void {
    const main = document.getElementById('contenido');
    const h1 = main?.querySelector<HTMLElement>('h1');
    const destino = h1 ?? main;
    if (!destino) return;
    if (destino !== main && !destino.hasAttribute('tabindex')) destino.setAttribute('tabindex', '-1');
    destino.focus();
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
  /** A dónde lleva cada aviso: los mismos destinos que Hoy (`core/avisos.ts`). */
  readonly destino = DESTINO_AVISO;
  readonly url = urlDe;

  /** "Tu clave para autorizar se apagó": se vuelve a poner aquí mismo. */
  abrirMiClave(): void {
    this.abierto.set(false);
    this.miClave.set(true);
  }

  irA(ruta: string): void {
    this.abierto.set(false);
    this.router.navigateByUrl(ruta);
  }

  salir(): void {
    this.notif.detener();
    this.tiempoReal.detener();
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
