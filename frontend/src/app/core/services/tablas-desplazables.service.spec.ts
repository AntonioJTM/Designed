import { TestBed } from '@angular/core/testing';
import { TablasDesplazables } from './tablas-desplazables.service';

/** 2026-10-15: la tabla que no cabe se mueve con el teclado, tiene nombre y avisa que hay más. */
describe('TablasDesplazables', () => {
  let raiz: HTMLElement;
  let svc: TablasDesplazables;

  /** Una tarjeta con su título y una tabla de `anchoTabla` px dentro de una caja de 200 px. */
  function tarjeta(anchoTabla: number, extra = ''): HTMLElement {
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-head"><div><h2>Sus compras</h2></div></div>
      <div class="tabla-scroll" style="width: 200px; overflow-x: auto" ${extra}>
        <table style="width: ${anchoTabla}px"><tr><td>POS-6C4E</td></tr></table>
      </div>`;
    raiz.appendChild(card);
    return card.querySelector('.tabla-scroll') as HTMLElement;
  }

  beforeEach(() => {
    raiz = document.createElement('div');
    document.body.appendChild(raiz);
    TestBed.configureTestingModule({});
    svc = TestBed.inject(TablasDesplazables);
    TestBed.runInInjectionContext(() => svc.iniciar(raiz));
  });
  afterEach(() => {
    raiz.remove();
    TestBed.resetTestingModule();
  });

  it('la que no cabe: se llega con Tab, se llama como su tarjeta y avisa que hay más a la derecha', () => {
    const caja = tarjeta(600);
    svc.revisar(raiz);
    expect(caja.tabIndex).toBe(0);
    expect(caja.getAttribute('role')).toBe('region');
    expect(caja.getAttribute('aria-label')).toBe('Tabla: Sus compras');
    expect(caja.classList.contains('hay-mas-der')).toBeTrue();
    expect(caja.classList.contains('hay-mas-izq')).toBeFalse();
  });

  it('al llegar al final, el aviso pasa a la izquierda', async () => {
    const caja = tarjeta(600);
    svc.revisar(raiz);
    caja.scrollLeft = caja.scrollWidth;
    caja.dispatchEvent(new Event('scroll'));
    expect(caja.classList.contains('hay-mas-izq')).toBeTrue();
    expect(caja.classList.contains('hay-mas-der')).toBeFalse();
  });

  it('la que cabe no agrega una parada de Tab ni nombre', () => {
    const caja = tarjeta(150);
    svc.revisar(raiz);
    expect(caja.hasAttribute('tabindex')).toBeFalse();
    expect(caja.hasAttribute('role')).toBeFalse();
    expect(caja.className).toBe('tabla-scroll');
  });

  it('si deja de desbordar (la pantalla creció), se le quita todo', () => {
    const caja = tarjeta(600);
    svc.revisar(raiz);
    caja.style.width = '700px';
    svc.revisar(raiz);
    expect(caja.hasAttribute('tabindex')).toBeFalse();
    expect(caja.hasAttribute('role')).toBeFalse();
    expect(caja.hasAttribute('aria-label')).toBeFalse();
    expect(caja.classList.contains('hay-mas-der')).toBeFalse();
  });

  it('respeta lo que la pantalla le puso por su cuenta', () => {
    const caja = tarjeta(600, 'tabindex="-1" aria-label="Mía"');
    svc.revisar(raiz);
    expect(caja.getAttribute('tabindex')).toBe('-1');
    expect(caja.getAttribute('aria-label')).toBe('Mía');
    expect(caja.hasAttribute('role')).toBeFalse();
  });

  it('una tabla que aparece después se revisa sola', async () => {
    const caja = tarjeta(600);
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
    expect(caja.tabIndex).toBe(0);
  });
});
