import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AdminLayout } from './admin-layout';
import { AuthService } from '../../core/services/auth.service';
import { NotificacionesService, Pendientes } from '../../core/services/notificaciones.service';

/**
 * LA CAMPANA y el WhatsApp de la tienda (2026-10-16): "si un día se cierra la
 * sesión, el cajero se entera hasta que intenta mandar un ticket". El aviso lo
 * ve quien entra a Configuración, cuenta en el globo y lleva a Configuración.
 */
describe('Campana · WhatsApp de la tienda desconectado', () => {
  const vacio = (extra: Partial<Pendientes> = {}): Pendientes => ({
    traspasos_por_enviar: [], traspasos_por_recibir: [], alertas_stock: 0,
    cobranza: { clientes: [], num_clientes: 0, monto: 0, dias: 15 },
    enfriados: { clientes: [], num_clientes: 0, dias: 60 },
    nuevos_sin_credito: { clientes: [], num_clientes: 0, dias: 15 },
    total: 0,
    ...extra,
  });

  async function montar(permisos: string[], p: Pendientes) {
    await TestBed.configureTestingModule({
      imports: [AdminLayout],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            sesion: signal({ tipo: 'usuario', nombre: 'Lupita', correo: 'x@x', rol: 'administrador', permisos }),
            puede: (k: string) => permisos.includes(k),
            cargarPerfil: () => of(null),
            logout: () => {},
          },
        },
        {
          provide: NotificacionesService,
          useValue: { pendientes: signal(p), iniciar: () => {}, detener: () => {}, refrescar: () => {} },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AdminLayout);
    fixture.detectChanges();
    fixture.componentInstance.abierto.set(true);
    fixture.detectChanges();
    return fixture;
  }
  const texto = (el: HTMLElement) => el.textContent!.replace(/\s+/g, ' ');
  afterEach(() => TestBed.resetTestingModule());

  it('quien entra a Configuración lo ve, cuenta en el globo y dice cómo resolverlo', async () => {
    const fixture = await montar(['ver:config'], vacio({ whatsapp: { motivo: 'sesion_cerrada', desde: '2026-10-16 17:05:00' }, total: 1 }));
    const el = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.total()).toBe(1);
    expect(texto(el)).toContain('El WhatsApp de la tienda se desconectó');
    expect(texto(el)).toContain('los tickets se mandan a mano hasta volver a enlazarlo');
    expect(texto(el)).toContain('Enlazar ›');
  });

  it('si no se puede conectar, lo dice distinto; quien no entra a Configuración no lo ve', async () => {
    let fixture = await montar(['ver:config'], vacio({ whatsapp: { motivo: 'sin_conexion', desde: '2026-10-16 17:05:00' }, total: 1 }));
    expect(texto(fixture.nativeElement)).toContain('El WhatsApp de la tienda no se puede conectar');

    TestBed.resetTestingModule();
    fixture = await montar(['ver:pos'], vacio({ whatsapp: { motivo: 'sesion_cerrada', desde: null }, total: 1 }));
    expect(fixture.componentInstance.total()).toBe(0);
    expect(texto(fixture.nativeElement)).not.toContain('WhatsApp de la tienda');
  });
});
