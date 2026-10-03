import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TipoClienteFormModal } from './tipo-cliente-form-modal';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { TipoCliente } from '../../../core/models/catalogo.models';
import type { ListaPrecio } from './tipos-cliente';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';

/**
 * El público es la lista base: sin él no hay precio con qué cobrar. No se puede
 * eliminar ni desactivar, y el modal ni lo ofrece. Las demás sí, desde el modal
 * (la tabla solo tiene "Editar").
 */
describe('TipoClienteFormModal', () => {
  const publico: ListaPrecio = { id: 1, nombre: 'Público', es_publico: 1, orden: 1, activo: 1, num_clientes: 18 };
  const mayoreo: ListaPrecio = {
    id: 2, nombre: 'Mayoreo', es_publico: 0, orden: 3, activo: 1, num_clientes: 9, num_precios: 52,
  };

  let actualizado: Partial<TipoCliente> | null = null;
  let eliminados = 0;
  const catalogoFalso = {
    crearTipoCliente: (b: Partial<TipoCliente>) => of({ ...mayoreo, ...b, id: 7 }),
    actualizarTipoCliente: (id: number, b: Partial<TipoCliente>) => {
      actualizado = b;
      return of({ ...publico, ...b, id });
    },
    eliminarTipoCliente: () => {
      eliminados++;
      return of({});
    },
  };

  async function montar(t: ListaPrecio | null) {
    await TestBed.configureTestingModule({
      imports: [TipoClienteFormModal],
      providers: [
        { provide: CatalogoService, useValue: catalogoFalso },
        // La ventana de confirmación del sistema: en la prueba siempre dice que sí.
        { provide: ConfirmacionService, useValue: { pedir: () => Promise.resolve(true) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(TipoClienteFormModal);
    fixture.componentRef.setInput('tipo', t);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    actualizado = null;
    eliminados = 0;
  });
  afterEach(() => TestBed.resetTestingModule());

  it('el público no ofrece Eliminar ni la casilla de activa, y se guarda activo', async () => {
    const fixture = await montar(publico);
    const el = fixture.nativeElement as HTMLElement;
    const botones = Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(botones).not.toContain('Eliminar');
    expect(el.querySelector('input[type="checkbox"]')).toBeNull();

    const c = fixture.componentInstance;
    c.form.patchValue({ activo: false });
    c.guardar();
    expect(actualizado!.activo).toBe(true);

    await c.eliminar();
    expect(eliminados).toBe(0);
  });

  it('otra lista sí se puede eliminar desde el modal y dice cuánto se usa', async () => {
    const fixture = await montar(mayoreo);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('La usan 9 clientes');
    expect(el.textContent).toContain('52 presentaciones');

    const c = fixture.componentInstance;
    let avisos = 0;
    c.eliminado.subscribe(() => avisos++);
    await c.eliminar();
    expect(eliminados).toBe(1);
    expect(avisos).toBe(1);
  });
});
