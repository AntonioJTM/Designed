import { TestBed } from '@angular/core/testing';
import { ConfirmacionComponent } from './confirmacion';
import { ConfirmacionService } from '../../core/services/confirmacion.service';

/**
 * Lo que importa de la ventana de confirmación (la que reemplaza al
 * `confirm()` del navegador):
 *   · dice la pregunta, qué pasa y el verbo del botón;
 *   · aceptar contesta que sí, cancelar que no;
 *   · Escape contesta que no y NO llega al modal de abajo (que se cerraría).
 */
describe('ConfirmacionComponent', () => {
  async function montar() {
    await TestBed.configureTestingModule({ imports: [ConfirmacionComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ConfirmacionComponent);
    fixture.detectChanges();
    return { fixture, svc: TestBed.inject(ConfirmacionService) };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('enseña la pregunta y aceptar contesta que sí', async () => {
    const { fixture, svc } = await montar();
    const respuesta = svc.pedir({ titulo: '¿Eliminar la caja?', mensaje: 'No se puede deshacer.', aceptar: 'Eliminar', peligro: true });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('¿Eliminar la caja?');
    expect(el.textContent).toContain('No se puede deshacer.');
    const aceptar = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Eliminar')!;
    expect(aceptar.classList).toContain('btn-rojo');
    aceptar.click();
    expect(await respuesta).toBe(true);
    fixture.detectChanges();
    expect(el.querySelector('.confirmacion')).toBeNull();
  });

  it('cancelar contesta que no', async () => {
    const { fixture, svc } = await montar();
    const respuesta = svc.pedir({ titulo: '¿Vaciar el carrito?' });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cancelar')!.click();
    expect(await respuesta).toBe(false);
  });

  it('Escape contesta que no y no cierra el modal de abajo', async () => {
    const { fixture, svc } = await montar();
    let modalDeAbajo = 0;
    const oyente = () => modalDeAbajo++;
    document.addEventListener('keydown', oyente);
    const respuesta = svc.pedir({ titulo: '¿Eliminar el almacén?' });
    fixture.detectChanges();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await respuesta).toBe(false);
    expect(modalDeAbajo).toBe(0);
    document.removeEventListener('keydown', oyente);
  });
});
