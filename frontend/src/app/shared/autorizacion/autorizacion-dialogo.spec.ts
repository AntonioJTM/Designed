import { TestBed } from '@angular/core/testing';
import { AutorizacionDialogo } from './autorizacion-dialogo';
import { AutorizacionDialogoService, EleccionAutorizacion } from '../../core/services/autorizacion-dialogo.service';
import { NecesitaAutorizacion } from '../../core/models/autorizaciones.models';

/** La ventana "Hace falta autorización" (2026-10-19). */
describe('AutorizacionDialogo', () => {
  const INFO: NecesitaAutorizacion = {
    operacion: 'corregir_deuda', nombre: 'Corregir la deuda de un cliente', resumen: 'Agregarle $50.00 a la deuda de Doña Lupe',
    solo_en_el_momento: false, autorizadores: [
      { id: 2, nombre: 'Jairo Domínguez', con_clave: true },
      { id: 1, nombre: 'Yessica Lucio', con_clave: true },
      { id: 5, nombre: 'Adriana Pérez', con_clave: false },
    ],
  };
  const espera = () => new Promise((r) => setTimeout(r));

  async function montar(info: NecesitaAutorizacion) {
    await TestBed.configureTestingModule({ imports: [AutorizacionDialogo] }).compileComponents();
    const f = TestBed.createComponent(AutorizacionDialogo);
    const svc = TestBed.inject(AutorizacionDialogoService);
    const elegida = svc.preguntar(info);
    f.detectChanges();
    await espera();
    f.detectChanges();
    return { f, svc, elegida };
  }

  it('lo que se escribe en "Su clave de autorización" llega como TEXTO, con quien autoriza', async () => {
    const { f, elegida } = await montar(INFO);
    const el = f.nativeElement as HTMLElement;
    const clave = el.querySelector<HTMLInputElement>('input[type=password]')!;
    expect(clave.value).toBe(''); // antes salía "[object HTMLInputElement]"
    // Sin <form>: el navegador no ofrece guardar la clave en la caja.
    expect(el.querySelector('form')).toBeNull();
    clave.value = '4821';
    clave.dispatchEvent(new Event('input'));
    f.detectChanges();
    el.querySelector<HTMLButtonElement>('.aqui button.btn-primary')!.click();
    expect(await elegida).toEqual({ tipo: 'aqui', usuario_id: 2, clave: '4821' } as EleccionAutorizacion);
  });

  it('para autorizar aquí solo ofrece a quien ya puso su clave; pedirlo le llega a todos', async () => {
    const { f } = await montar(INFO);
    const el = f.nativeElement as HTMLElement;
    const opciones = [...el.querySelectorAll('.aqui option')].map((o) => o.textContent?.trim());
    expect(opciones).toEqual(['Jairo Domínguez', 'Yessica Lucio']);
    expect(el.textContent).toContain('Adriana');
  });

  it('si nadie ha puesto su clave, dice dónde se pone', async () => {
    const { f } = await montar({ ...INFO, autorizadores: INFO.autorizadores.map((u) => ({ ...u, con_clave: false })) });
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('input[type=password]')).toBeNull();
    expect(el.textContent).toContain('«Mi clave»');
  });

  it('dice qué se pide y a quién le llega si se pide', async () => {
    const { f } = await montar(INFO);
    const texto = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Agregarle $50.00 a la deuda de Doña Lupe');
    expect(texto).toContain('Le llega a Jairo, Yessica o Adriana');
  });

  it('lo que es "solo en el momento" no ofrece pedirlo', async () => {
    const { f } = await montar({ ...INFO, solo_en_el_momento: true });
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('Pedir autorización');
    expect(el.textContent).toContain('el cliente está enfrente');
  });

  it('sin nadie que pueda autorizar, lo dice y solo deja no hacerlo', async () => {
    const { f, svc, elegida } = await montar({ ...INFO, autorizadores: [] });
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Nadie puede autorizar esto');
    expect(el.querySelector('input[type=password]')).toBeNull();
    svc.elegir({ tipo: 'no' });
    expect(await elegida).toEqual({ tipo: 'no' });
  });
});
