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

/**
 * El CARGADOR (2026-10-14) no entra al sistema:
 *   · con él elegido no se piden correo, contraseña ni otros puestos, y el alta va sin ellos;
 *   · no se ofrece como "también trabaja como";
 *   · un cargador que pasa a un puesto que sí entra necesita correo y contraseña;
 *   · a quien entraba y pasa a cargador se le avisa que deja de entrar.
 */
describe('UsuarioFormModal (cargador)', () => {
  const roles: Rol[] = [
    { id: 3, nombre: 'cajero', entra_al_sistema: true },
    { id: 4, nombre: 'almacenista', entra_al_sistema: true },
    { id: 6, nombre: 'cargador', entra_al_sistema: false },
  ];
  const beto = {
    id: 9, rol_id: 6, rol: 'cargador', entra_al_sistema: 0, nombre: 'Beto', correo: null, telefono: null,
    activo: true, otros_roles: [], creado_en: '', actualizado_en: '',
  } as unknown as Usuario;
  const toño = {
    id: 7, rol_id: 3, rol: 'cajero', entra_al_sistema: 1, nombre: 'Toño', correo: 'tono@x.mx', telefono: null,
    activo: true, otros_roles: [{ id: 4, nombre: 'almacenista' }], creado_en: '', actualizado_en: '',
  } as unknown as Usuario;

  let enviado: Record<string, unknown> | null = null;

  async function montar(usuario: Usuario | null) {
    const responder = (b: Record<string, unknown>) => {
      enviado = b;
      return of(beto);
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

  const campo = (f: { nativeElement: HTMLElement }, nombre: string) =>
    f.nativeElement.querySelector(`[formcontrolname="${nombre}"]`);

  beforeEach(() => (enviado = null));
  afterEach(() => TestBed.resetTestingModule());

  it('al elegir cargador no pide correo, contraseña ni otros puestos, y el alta va sin ellos', async () => {
    const f = await montar(null);
    const c = f.componentInstance;
    c.alternarOtro(4, true);
    c.form.patchValue({ nombre: 'Beto', rol_id: 6 });
    f.detectChanges();
    expect(c.sinAcceso()).toBe(true);
    expect(campo(f, 'correo')).toBeNull();
    expect(campo(f, 'contrasena')).toBeNull();
    expect(f.nativeElement.querySelector('.casillas')).toBeNull();
    expect(f.nativeElement.textContent).toContain('no entra al sistema');
    c.guardar();
    expect(enviado).toEqual({ rol_id: 6, otros_roles: [], nombre: 'Beto', telefono: undefined });
  });

  it('el cargador no se ofrece como otro puesto', async () => {
    const f = await montar(null);
    expect(f.componentInstance.otrosDisponibles().map((r) => r.nombre)).toEqual(['almacenista']);
  });

  it('un cargador que pasa a cajero necesita correo y contraseña', async () => {
    const f = await montar(beto);
    const c = f.componentInstance;
    expect(c.sinAcceso()).toBe(true);
    c.form.patchValue({ rol_id: 3 });
    f.detectChanges();
    expect(c.pideCorreo()).toBe(true);
    c.guardar();
    expect(enviado).toBeNull(); // sin correo ni contraseña no se manda
    c.form.patchValue({ correo: 'beto@x.mx', contrasena: '12345678' });
    c.guardar();
    expect(enviado).toEqual(jasmine.objectContaining({ rol_id: 3, correo: 'beto@x.mx', contrasena: '12345678' }));
  });

  it('a quien entraba y pasa a cargador se le avisa, y se manda sin contraseña ni otros puestos', async () => {
    const f = await montar(toño);
    const c = f.componentInstance;
    c.form.patchValue({ rol_id: 6, contrasena: 'no-se-manda' });
    f.detectChanges();
    expect(c.pierdeAcceso()).toBe(true);
    expect(f.nativeElement.querySelector('.aviso')?.textContent).toContain('ya no podrá entrar');
    c.guardar();
    expect(enviado).toEqual(jasmine.objectContaining({ rol_id: 6, otros_roles: [], contrasena: undefined, correo: undefined }));
  });
});
