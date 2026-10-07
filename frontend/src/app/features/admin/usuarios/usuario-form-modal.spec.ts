import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { UsuarioFormModal } from './usuario-form-modal';
import { UsuariosService } from '../../../core/services/usuarios.service';
import { Rol, Usuario } from '../../../core/models/auth.models';

/**
 * Varios puestos por persona (2026-10-06):
 *   · abre con los demás puestos que ya tiene, marcados;
 *   · las casillas nunca ofrecen el puesto principal;
 *   · lo que se manda no repite el principal, aunque haya quedado marcado de antes.
 */
describe('UsuarioFormModal (varios puestos)', () => {
  const roles: Rol[] = [
    { id: 2, nombre: 'gerente' },
    { id: 3, nombre: 'cajero' },
    { id: 4, nombre: 'almacenista' },
  ];
  const toño = {
    id: 7, rol_id: 3, rol: 'cajero', nombre: 'Toño', correo: 'tono@x.mx', telefono: null, activo: true,
    otros_roles: [{ id: 4, nombre: 'almacenista' }], creado_en: '', actualizado_en: '',
  } as unknown as Usuario;

  let enviado: Record<string, unknown> | null = null;

  async function montar(usuario: Usuario | null) {
    const responder = (b: Record<string, unknown>) => {
      enviado = b;
      return of(toño);
    };
    await TestBed.configureTestingModule({
      imports: [UsuarioFormModal],
      providers: [
        {
          provide: UsuariosService,
          useValue: {
            crear: (b: Record<string, unknown>) => responder(b),
            actualizar: (_id: number, b: Record<string, unknown>) => responder(b),
          },
        },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(UsuarioFormModal);
    f.componentRef.setInput('roles', roles);
    f.componentRef.setInput('usuario', usuario);
    f.detectChanges();
    return f;
  }

  beforeEach(() => (enviado = null));
  afterEach(() => TestBed.resetTestingModule());

  it('abre con sus demás puestos marcados y sin ofrecer el principal', async () => {
    const f = await montar(toño);
    const c = f.componentInstance;
    expect(c.otrosDisponibles().map((r) => r.nombre)).toEqual(['gerente', 'almacenista']);
    expect(c.tieneOtro(4)).toBe(true);
    const marcadas = [...(f.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>('.casillas input')]
      .filter((i) => i.checked);
    expect(marcadas.length).toBe(1);
  });

  it('manda sus demás puestos sin repetir el principal', async () => {
    const f = await montar(toño);
    const c = f.componentInstance;
    c.alternarOtro(2, true);
    // Lo cambian a almacenista de principal: ya no va entre los demás.
    c.form.patchValue({ rol_id: 4 });
    c.guardar();
    expect(enviado).toEqual(jasmine.objectContaining({ rol_id: 4, otros_roles: [2] }));
  });

  it('un alta arranca de cajero y sin otros puestos', async () => {
    const f = await montar(null);
    const c = f.componentInstance;
    c.form.patchValue({ nombre: 'Nuevo', correo: 'nuevo@x.mx', contrasena: '12345678' });
    c.guardar();
    expect(enviado).toEqual(jasmine.objectContaining({ rol_id: 3, otros_roles: [] }));
  });
});
