import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ClienteFormModal } from './cliente-form-modal';
import { ClientesService } from '../../../core/services/clientes.service';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { AuthService } from '../../../core/services/auth.service';
import { Cliente, LugarEntrega } from '../../../core/models/clientes.models';
import { hoyLocal } from '../../../shared/fecha.pipe';

/**
 * El modal del cliente:
 *   · al editar abre LLENO (el input se lee en ngOnInit, no en el constructor);
 *   · el alta arranca con "cliente desde" en hoy y solo exige el nombre;
 *   · al crear NO se cierra: ofrece capturar otro, porque los clientes de años
 *     se capturan uno tras otro; al editar sí se cierra;
 *   · (2026-10-14) no manda número, apodo ni cumpleaños: el número lo da el
 *     sistema; y el lugar de entrega se elige o se da de alta ahí mismo.
 */
describe('ClienteFormModal', () => {
  const cliente: Cliente = {
    id: 3, codigo: 'C-0003', nombre: 'Mercería La Esperanza', nombre_comercial: 'La Esperanza', telefono: '445 210 8890',
    tipo_cliente_id: 2, limite_credito: '10000.00', activo: 1, cliente_desde: '2018-05-01',
    lugar_entrega_id: 2,
  };
  const LUGARES: LugarEntrega[] = [
    { id: 1, nombre: 'Tenango de Doria', estado: 'Hidalgo', num_clientes: 1 },
    { id: 2, nombre: 'Tulancingo', estado: 'Hidalgo', num_clientes: 4 },
  ];

  let enviados: unknown[];
  let lugaresCreados: unknown[];
  let repetido = false;
  const clientesFalso = {
    crear: (b: Partial<Cliente>) => { enviados.push(b); return of({ ...cliente, ...b, id: 9, codigo: 'C-0009' } as Cliente); },
    actualizar: (id: number, b: Partial<Cliente>) => { enviados.push(b); return of({ ...cliente, ...b, id } as Cliente); },
    lugaresEntrega: () => of({ lugares: LUGARES, clientes_activos: 5, sin_lugar: 0 }),
    crearLugar: (b: { nombre: string; estado: string }) => {
      lugaresCreados.push(b);
      if (repetido) {
        return throwError(() => ({ error: { error: { code: 'LUGAR_REPETIDO', message: 'Ya está', detalles: { id: 2 } } } }));
      }
      return of({ id: 7, ...b, num_clientes: 0 });
    },
  };

  async function montar(c: Cliente | null) {
    await TestBed.configureTestingModule({
      imports: [ClienteFormModal],
      providers: [
        { provide: ClientesService, useValue: clientesFalso },
        { provide: CatalogoService, useValue: { tiposCliente: () => of([]) } },
        {
          provide: AuthService,
          useValue: {
            puede: (k: string) => permisos.has(k),
            puedeOPide: (k: string) => permisos.has(k) || permisos.has(k.replace(/^hacer:/, 'pedir:')),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ClienteFormModal);
    fixture.componentRef.setInput('cliente', c);
    fixture.detectChanges();
    return fixture;
  }

  let permisos = new Set<string>();
  beforeEach(() => {
    permisos = new Set(['hacer:dar_credito']);
    enviados = [];
    lugaresCreados = [];
    repetido = false;
  });
  afterEach(() => TestBed.resetTestingModule());

  it('el crédito: quien no lo da ni lo pide no lo mueve (y al guardar se manda el que tenía)', async () => {
    permisos = new Set();
    const f = await montar(cliente);
    expect(f.componentInstance.form.controls.limite_credito.disabled).toBe(true);
    expect(f.componentInstance.form.getRawValue().limite_credito).toBe(10000);
    expect(f.nativeElement.textContent).toContain('Lo cambia quien da crédito');
  });

  it('el crédito: quien solo lo pide sí lo escribe, y se le dice que se autoriza', async () => {
    permisos = new Set(['pedir:dar_credito']);
    const f = await montar(cliente);
    expect(f.componentInstance.form.controls.limite_credito.disabled).toBe(false);
    expect(f.nativeElement.textContent).toContain('Subirlo lo autoriza quien da crédito');
  });

  it('al editar llena el formulario con el cliente', async () => {
    const f = await montar(cliente);
    const v = f.componentInstance.form.getRawValue();
    expect(f.componentInstance.esEdicion()).toBe(true);
    expect(v.nombre).toBe('Mercería La Esperanza');
    expect(v.lugar_entrega_id).toBe(2);
    expect(v.limite_credito).toBe(10000);
    // El número se ve, pero no es un campo del formulario: no se puede cambiar.
    const numero = f.nativeElement.querySelector('input.numero') as HTMLInputElement;
    expect(numero.value).toBe('C-0003');
    expect(numero.readOnly).toBe(true);
    expect('codigo' in v).toBe(false);
    // Ya no se piden "como le dicen" ni el cumpleaños.
    expect(f.nativeElement.textContent).not.toContain('Como le dicen');
    expect(f.nativeElement.textContent).not.toContain('Cumpleaños');
    expect(v.cliente_desde).toBe('2018-05-01');
  });

  it('el alta arranca vacía, desde hoy, y no deja guardar sin nombre', async () => {
    const f = await montar(null);
    const c = f.componentInstance;
    expect(c.form.getRawValue().nombre).toBe('');
    expect(c.form.getRawValue().cliente_desde).toBe(hoyLocal());
    c.guardar();
    expect(enviados.length).toBe(0);
  });

  it('al crear ofrece capturar otro y no se cierra', async () => {
    const f = await montar(null);
    const c = f.componentInstance;
    let cerrado = 0;
    const guardados: Cliente[] = [];
    c.cerrado.subscribe(() => cerrado++);
    c.guardado.subscribe((g) => guardados.push(g));

    c.form.patchValue({ nombre: 'Doña Chela', tipo_cliente_id: 2 });
    c.guardar();
    expect(guardados.length).toBe(1);
    expect(cerrado).toBe(0);
    expect(c.creado()?.id).toBe(9);
    // El número lo da el sistema: no se manda, ni apodo ni cumpleaños.
    const body = enviados[0] as Record<string, unknown>;
    expect('codigo' in body).toBe(false);
    expect('nombre_comercial' in body).toBe(false);
    expect('fecha_nacimiento' in body).toBe(false);
    expect(body['lugar_entrega_id']).toBeNull();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('C-0009');

    c.otro();
    expect(c.creado()).toBeNull();
    expect(c.form.getRawValue().nombre).toBe('');
    // La lista de precios se conserva: al capturar de corrido suele repetirse.
    expect(c.form.getRawValue().tipo_cliente_id).toBe(2);
  });

  it('da de alta un lugar de entrega ahí mismo y lo deja elegido', async () => {
    const f = await montar(null);
    const c = f.componentInstance;
    c.form.patchValue({ lugar_entrega_id: 2 });
    c.abrirLugar();
    // Propone el estado del lugar que estaba elegido.
    expect(c.lugarEstado.value).toBe('Hidalgo');
    c.guardarLugar();
    expect(c.errorLugar()).toBe('Pon el municipio o el lugar.');
    c.lugarNombre.setValue('Acaxochitlán');
    c.guardarLugar();
    expect(lugaresCreados).toEqual([{ nombre: 'Acaxochitlán', estado: 'Hidalgo' }]);
    expect(c.form.getRawValue().lugar_entrega_id).toBe(7);
    expect(c.agregandoLugar()).toBe(false);
    expect(c.lugares().map((l) => l.nombre)).toEqual(['Acaxochitlán', 'Tenango de Doria', 'Tulancingo']);
  });

  it('si el lugar ya estaba en la lista, elige ese', async () => {
    const f = await montar(null);
    const c = f.componentInstance;
    repetido = true;
    c.abrirLugar();
    c.lugarNombre.setValue('tulancingo');
    c.lugarEstado.setValue('hidalgo');
    c.guardarLugar();
    expect(c.form.getRawValue().lugar_entrega_id).toBe(2);
    expect(c.agregandoLugar()).toBe(false);
  });

  it('al capturar otro conserva el lugar de entrega', async () => {
    const f = await montar(null);
    const c = f.componentInstance;
    c.form.patchValue({ nombre: 'Uno', lugar_entrega_id: 1 });
    c.guardar();
    c.otro();
    expect(c.form.getRawValue().lugar_entrega_id).toBe(1);
  });

  it('al editar se cierra después de guardar', async () => {
    const f = await montar(cliente);
    let cerrado = 0;
    f.componentInstance.cerrado.subscribe(() => cerrado++);
    f.componentInstance.guardar();
    expect(cerrado).toBe(1);
  });
});
