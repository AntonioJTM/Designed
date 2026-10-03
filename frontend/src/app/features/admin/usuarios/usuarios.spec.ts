import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Usuarios } from './usuarios';
import { UsuariosService } from '../../../core/services/usuarios.service';
import { AuthService } from '../../../core/services/auth.service';
import { Rol, Usuario } from '../../../core/models/auth.models';

/**
 * Personal:
 *   · "Ver permisos" solo le aparece al administrador (Permisos es solo suyo);
 *   · el puesto de administrador solo lo asigna otro administrador;
 *   · nunca se pinta una contraseña ni un hash, aunque llegaran por error.
 */
describe('Usuarios (Personal)', () => {
  const roles: Rol[] = [
    { id: 1, nombre: 'administrador' },
    { id: 2, nombre: 'gerente' },
    { id: 3, nombre: 'cajero' },
  ];
  const usuarios = [
    { id: 1, rol_id: 1, rol: 'administrador', nombre: 'Ana', correo: 'ana@x.mx', activo: true, creado_en: '', actualizado_en: '' },
    {
      id: 2, rol_id: 3, rol: 'cajero', nombre: 'Lupita', correo: 'lupita@x.mx', activo: true,
      ultimo_acceso: null, creado_en: '', actualizado_en: '',
      // Si el backend lo mandara por error, la pantalla no tiene dónde pintarlo.
      contrasena_hash: '$2b$10$secretosecretosecreto',
    },
  ] as unknown as Usuario[];

  const apiFalso = { listar: () => of(usuarios), roles: () => of(roles) };

  async function montar(esAdmin: boolean) {
    const authFalso = { esAdmin: () => esAdmin, puede: () => esAdmin };
    await TestBed.configureTestingModule({
      imports: [Usuarios],
      providers: [
        provideRouter([]),
        { provide: UsuariosService, useValue: apiFalso },
        { provide: AuthService, useValue: authFalso },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Usuarios);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('al administrador le enlaza Permisos y le deja asignar cualquier puesto', async () => {
    const fixture = await montar(true);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('a[href="/admin/permisos"]')).not.toBeNull();
    expect(fixture.componentInstance.rolesAsignables().map((r) => r.nombre)).toContain('administrador');
  });

  it('a un gerente no le enlaza Permisos ni le deja tocar administradores', async () => {
    const fixture = await montar(false);
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('a[href="/admin/permisos"]')).toBeNull();
    expect(c.rolesAsignables().map((r) => r.nombre)).not.toContain('administrador');
    expect(c.puedeEditar(usuarios[0])).toBe(false);
    expect(c.puedeEditar(usuarios[1])).toBe(true);
  });

  it('no pinta contraseñas ni hashes', async () => {
    const fixture = await montar(true);
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Lupita');
    expect(texto).toContain('Nunca ha entrado');
    expect(texto).not.toContain('$2b$');
  });
});
