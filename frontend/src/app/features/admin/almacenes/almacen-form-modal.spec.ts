import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AlmacenFormModal } from './almacen-form-modal';
import { InventarioService } from '../../../core/services/inventario.service';
import { Almacen, AlmacenInput } from '../../../core/models/inventario.models';

/**
 * Lo que importa del modal de almacén:
 *   · el input se lee en ngOnInit, o la edición abre en blanco;
 *   · con la tienda en línea apagada NO se manda `es_tienda_linea`: así el
 *     almacén que la tenga la conserva (el backend no deja quitarla sin
 *     designar otro, y ya no hay dónde).
 */
describe('AlmacenFormModal', () => {
  const almacen: Almacen = {
    id: 3,
    nombre: 'Bodega principal',
    direccion: 'Calle 1',
    es_punto_venta: 0,
    es_tienda_linea: 1,
    es_matriz: 1,
    activo: 1,
  };

  let enviado: AlmacenInput | null = null;
  const invFalso = {
    crearAlmacen: (b: AlmacenInput) => {
      enviado = b;
      return of({ ...almacen, ...b, id: 9 });
    },
    actualizarAlmacen: (id: number, b: AlmacenInput) => {
      enviado = b;
      return of({ ...almacen, ...b, id });
    },
    eliminarAlmacen: () => of({}),
  };

  async function montar(a: Almacen | null) {
    await TestBed.configureTestingModule({
      imports: [AlmacenFormModal],
      providers: [{ provide: InventarioService, useValue: invFalso }],
    }).compileComponents();
    const fixture = TestBed.createComponent(AlmacenFormModal);
    fixture.componentRef.setInput('almacen', a);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => (enviado = null));
  afterEach(() => TestBed.resetTestingModule());

  it('al editar llena el formulario con el almacén', async () => {
    const c = (await montar(almacen)).componentInstance;
    expect(c.esEdicion()).toBe(true);
    expect(c.form.getRawValue()).toEqual({
      nombre: 'Bodega principal',
      direccion: 'Calle 1',
      es_punto_venta: false,
      es_matriz: true,
      activo: true,
    });
  });

  it('al guardar no manda la marca de tienda en línea', async () => {
    const fixture = await montar(almacen);
    const c = fixture.componentInstance;
    let guardados = 0;
    c.guardado.subscribe(() => guardados++);

    c.form.patchValue({ nombre: 'Bodega matriz' });
    c.guardar();

    expect(guardados).toBe(1);
    expect(enviado).not.toBeNull();
    expect('es_tienda_linea' in (enviado as object)).toBe(false);
    expect(enviado!.nombre).toBe('Bodega matriz');
  });

  it('no ofrece la casilla de tienda en línea', async () => {
    const fixture = await montar(null);
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).not.toContain('tienda en línea');
    expect(texto).toContain('Es la matriz');
  });
});
