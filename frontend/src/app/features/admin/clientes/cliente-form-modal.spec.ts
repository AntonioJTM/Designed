import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ClienteFormModal } from './cliente-form-modal';
import { ClientesService } from '../../../core/services/clientes.service';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { Cliente } from '../../../core/models/clientes.models';
import { hoyLocal } from '../../../shared/fecha.pipe';

/**
 * El modal del cliente:
 *   · al editar abre LLENO (el input se lee en ngOnInit, no en el constructor);
 *   · el alta arranca con "cliente desde" en hoy y solo exige el nombre;
 *   · al crear NO se cierra: ofrece capturar otro, porque los clientes de años
 *     se capturan uno tras otro; al editar sí se cierra.
 */
describe('ClienteFormModal', () => {
  const cliente: Cliente = {
    id: 3, nombre: 'Mercería La Esperanza', nombre_comercial: 'La Esperanza', telefono: '445 210 8890',
    tipo_cliente_id: 2, limite_credito: '10000.00', activo: 1, cliente_desde: '2018-05-01',
  };

  let enviados: unknown[];
  const clientesFalso = {
    crear: (b: Partial<Cliente>) => { enviados.push(b); return of({ ...cliente, ...b, id: 9 } as Cliente); },
    actualizar: (id: number, b: Partial<Cliente>) => { enviados.push(b); return of({ ...cliente, ...b, id } as Cliente); },
  };

  async function montar(c: Cliente | null) {
    await TestBed.configureTestingModule({
      imports: [ClienteFormModal],
      providers: [
        { provide: ClientesService, useValue: clientesFalso },
        { provide: CatalogoService, useValue: { tiposCliente: () => of([]) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ClienteFormModal);
    fixture.componentRef.setInput('cliente', c);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => (enviados = []));
  afterEach(() => TestBed.resetTestingModule());

  it('al editar llena el formulario con el cliente', async () => {
    const f = await montar(cliente);
    const v = f.componentInstance.form.getRawValue();
    expect(f.componentInstance.esEdicion()).toBe(true);
    expect(v.nombre).toBe('Mercería La Esperanza');
    expect(v.nombre_comercial).toBe('La Esperanza');
    expect(v.limite_credito).toBe(10000);
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
    // Los opcionales vacíos van como null: un código '' choca con el UNIQUE.
    expect((enviados[0] as { codigo: unknown }).codigo).toBeNull();

    c.otro();
    expect(c.creado()).toBeNull();
    expect(c.form.getRawValue().nombre).toBe('');
    // La lista de precios se conserva: al capturar de corrido suele repetirse.
    expect(c.form.getRawValue().tipo_cliente_id).toBe(2);
  });

  it('al editar se cierra después de guardar', async () => {
    const f = await montar(cliente);
    let cerrado = 0;
    f.componentInstance.cerrado.subscribe(() => cerrado++);
    f.componentInstance.guardar();
    expect(cerrado).toBe(1);
  });
});
