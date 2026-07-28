import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MaterialFormModal } from './material-form-modal';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { Categoria } from '../../../core/models/catalogo.models';

/**
 * Mismo riesgo que en el modal del producto: si el input se lee en el
 * constructor, la edición abre en blanco. Aquí se comprueba que llegue llena y
 * que el alta arranque vacía.
 */
describe('MaterialFormModal', () => {
  const material: Categoria = {
    id: 4,
    nombre: 'Acrilán',
    descripcion: 'Material de prueba',
    calibres: '1/30,2/30',
    orden: 2,
    activo: 1,
  };

  const catalogoFalso = {
    crearCategoria: (b: Partial<Categoria>) => of({ ...material, ...b, id: 9 }),
    actualizarCategoria: (id: number, b: Partial<Categoria>) => of({ ...material, ...b, id }),
  };

  async function montar(m: Categoria | null) {
    await TestBed.configureTestingModule({
      imports: [MaterialFormModal],
      providers: [{ provide: CatalogoService, useValue: catalogoFalso }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MaterialFormModal);
    fixture.componentRef.setInput('material', m);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('al editar llena el formulario con el material', async () => {
    const fixture = await montar(material);
    const c = fixture.componentInstance;

    expect(c.esEdicion()).toBe(true);
    expect(c.form.getRawValue()).toEqual({
      nombre: 'Acrilán',
      descripcion: 'Material de prueba',
      calibres: '1/30,2/30',
      orden: 2,
      activo: true,
    });
  });

  it('en alta arranca vacío y activo', async () => {
    const fixture = await montar(null);
    const c = fixture.componentInstance;

    expect(c.esEdicion()).toBe(false);
    expect(c.form.getRawValue().nombre).toBe('');
    expect(c.form.getRawValue().activo).toBe(true);
  });

  it('al guardar avisa al listado y se cierra', async () => {
    const fixture = await montar(material);
    const c = fixture.componentInstance;

    const guardados: Categoria[] = [];
    let cerrado = 0;
    c.guardado.subscribe((g) => guardados.push(g));
    c.cerrado.subscribe(() => cerrado++);

    c.form.patchValue({ nombre: 'Viscosa' });
    c.guardar();

    expect(guardados.length).toBe(1);
    expect(guardados[0].nombre).toBe('Viscosa');
    expect(cerrado).toBe(1);
    expect(c.guardando()).toBe(false);
  });
});
