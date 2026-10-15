import { TestBed } from '@angular/core/testing';
import { FocoVentanas } from './foco-ventanas.service';

/** 2026-10-13: el foco del teclado entra a cada ventana, da la vuelta dentro y regresa. */
describe('FocoVentanas', () => {
  let raiz: HTMLElement;
  let svc: FocoVentanas;
  const esperar = (ms = 90) => new Promise((r) => setTimeout(r, ms));
  const tab = (shift = false) => {
    const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
    (document.activeElement ?? document.body).dispatchEvent(e);
    return e;
  };

  function ventana(html: string): HTMLElement {
    const d = document.createElement('div');
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.innerHTML = html;
    raiz.appendChild(d);
    return d;
  }

  beforeEach(() => {
    raiz = document.createElement('div');
    raiz.innerHTML = '<button id="abrir">Abrir</button><a href="#" id="menu">Menú</a>';
    document.body.appendChild(raiz);
    TestBed.configureTestingModule({});
    svc = TestBed.inject(FocoVentanas);
    TestBed.runInInjectionContext(() => svc.iniciar(raiz));
  });
  afterEach(() => {
    raiz.remove();
    TestBed.resetTestingModule();
  });

  it('al abrirse, el foco entra al primer campo del cuerpo (no a la ✕)', async () => {
    (raiz.querySelector('#abrir') as HTMLElement).focus();
    const v = ventana('<button class="cerrar">✕</button><div class="modal-body"><p>Hola</p><input id="kilos" /></div>');
    await esperar();
    expect(document.activeElement).toBe(v.querySelector('#kilos'));
  });

  it('si la ventana ya puso su foco, no se lo quita', async () => {
    const v = ventana('<div class="modal-body"><input id="a" /><input id="lector" /></div>');
    (v.querySelector('#lector') as HTMLElement).focus();
    await esperar();
    expect(document.activeElement).toBe(v.querySelector('#lector'));
  });

  it('Tab da la vuelta dentro de la ventana, en los dos sentidos', async () => {
    const v = ventana('<div class="modal-body"><input id="a" /></div><div class="modal-foot"><button id="cancelar">Cancelar</button><button id="guardar">Guardar</button></div>');
    await esperar();
    (v.querySelector('#guardar') as HTMLElement).focus();
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(v.querySelector('#a'));
    expect(tab(true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(v.querySelector('#guardar'));
    // En medio, Tab sigue su camino normal.
    (v.querySelector('#a') as HTMLElement).focus();
    expect(tab().defaultPrevented).toBe(false);
  });

  it('al cerrarse, el foco regresa al botón que la abrió', async () => {
    const abrir = raiz.querySelector('#abrir') as HTMLElement;
    abrir.focus();
    const v = ventana('<div class="modal-body"><input /></div>');
    await esperar();
    v.remove();
    await esperar(10);
    expect(document.activeElement).toBe(abrir);
  });

  it('si la ventana todavía cargaba, el foco espera en la ✕ y entra al campo cuando aparece (2026-10-14)', async () => {
    const v = ventana('<button class="cerrar" aria-label="Cerrar">✕</button><div class="modal-body"><p>Cargando…</p></div>');
    await esperar();
    expect(document.activeElement).toBe(v.querySelector('.cerrar'));
    // Llegan los datos: aparece el lector.
    v.querySelector('.modal-body')!.innerHTML = '<input id="lector" />';
    await esperar(10);
    expect(document.activeElement).toBe(v.querySelector('#lector'));
  });

  it('si la persona ya movió el foco mientras cargaba, no se lo quita', async () => {
    const v = ventana('<button class="cerrar">✕</button><div class="modal-body"></div><div class="modal-foot"><button id="otro">Otro</button></div>');
    await esperar();
    expect(document.activeElement).toBe(v.querySelector('.cerrar'));
    (v.querySelector('#otro') as HTMLElement).focus();
    v.querySelector('.modal-body')!.insertAdjacentHTML('beforeend', '<input id="lector" />');
    await esperar(10);
    expect(document.activeElement).toBe(v.querySelector('#otro'));
  });

  it('una ventana sin nada que enfocar recibe el foco ella misma', async () => {
    const v = ventana('<p>Solo texto</p>');
    await esperar();
    expect(document.activeElement).toBe(v);
  });
});
