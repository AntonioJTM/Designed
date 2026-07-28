import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ProductoFormModal } from './producto-form-modal';
import { CatalogoService } from '../../../core/services/catalogo.service';

/**
 * Lo que se comprueba es que EDITAR llegue con los datos puestos. Se rompió una
 * vez: la carga estaba en el constructor, donde los inputs de señal todavía no
 * están asignados, así que `productoId()` valía `null` y el modal se comportaba
 * como un alta con los campos vacíos.
 */
describe('ProductoFormModal', () => {
  const producto = {
    id: 7,
    nombre: 'MARINO OSCURO',
    categoria_id: 1,
    unidad_medida_id: 2,
    impuesto_id: null,
    linea_id: 3,
    descripcion: 'Hilo de prueba',
    grosor_calibre: '2/30',
    precio_kg: '185.50',
    multipresentacion: 1,
    por_lotes: 0,
    destacado: 0,
    activo: 1,
    variantes: [],
  };

  const catalogoFalso = {
    listarCategorias: () =>
      of({ items: [{ id: 1, nombre: 'Acrilán', calibres: '1/30,2/30' }], total: 1 }),
    opciones: (tipo: string) =>
      of(
        tipo === 'unidades'
          ? [{ id: 2, nombre: 'Kilogramo', abreviatura: 'kg' }]
          : tipo === 'lineas'
            ? [{ id: 3, nombre: 'Turco' }]
            : []
      ),
    obtenerProducto: (id: number) => of({ ...producto, id }),
  };

  async function montar(productoId: number | null): Promise<ComponentFixture<ProductoFormModal>> {
    await TestBed.configureTestingModule({
      imports: [ProductoFormModal],
      providers: [{ provide: CatalogoService, useValue: catalogoFalso }],
    }).compileComponents();

    const fixture = TestBed.createComponent(ProductoFormModal);
    fixture.componentRef.setInput('productoId', productoId);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('al editar llena el formulario con el producto y quita el velo', async () => {
    const fixture = await montar(7);
    const c = fixture.componentInstance;

    expect(c.esEdicion()).toBe(true);
    expect(c.cargando()).toBe(false);
    expect(fixture.nativeElement.querySelector('.modal-cargando')).toBeNull();

    const v = c.form.getRawValue();
    expect(v.nombre).toBe('MARINO OSCURO');
    expect(v.categoria_id).toBe(1);
    expect(v.linea_id).toBe(3);
    expect(v.grosor_calibre).toBe('2/30');
    expect(v.precio_kg).toBe(185.5);
    expect(v.multipresentacion).toBe(true);
    // El calibre guardado debe estar entre las opciones o el select lo borraría.
    expect(c.calibres()).toContain('2/30');
    // Ya se puede capturar.
    expect(c.form.enabled).toBe(true);
  });

  it('en alta arranca vacío, con kilogramo puesto', async () => {
    const fixture = await montar(null);
    const c = fixture.componentInstance;

    expect(c.esEdicion()).toBe(false);
    expect(c.cargando()).toBe(false);
    expect(c.form.getRawValue().nombre).toBe('');
    expect(c.form.getRawValue().unidad_medida_id).toBe(2);
  });
});
