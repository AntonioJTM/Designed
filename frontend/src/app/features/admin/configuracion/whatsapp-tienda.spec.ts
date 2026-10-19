import { TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';
import { WhatsappTiendaComponent } from './whatsapp-tienda';
import { WhatsappService, WhatsappTienda } from '../../../core/services/whatsapp.service';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';

/**
 * Configuración → WhatsApp de la tienda (2026-10-16): se enlaza con el QR, dice
 * con qué número quedó, manda una prueba y se desenlaza (preguntando antes).
 */
describe('Configuración · WhatsApp de la tienda', () => {
  const w = (estado: WhatsappTienda['estado'], extra: Partial<WhatsappTienda> = {}): WhatsappTienda => ({
    estado, numero: null, nombre: null, desde: null, aviso: null, qr: null, ...extra,
  });
  let respuesta: WhatsappTienda;
  let llamadas: string[];
  let confirmar: boolean;

  async function montar() {
    llamadas = [];
    await TestBed.configureTestingModule({
      imports: [WhatsappTiendaComponent],
      providers: [
        {
          provide: WhatsappService,
          useValue: {
            enlace: (): Observable<WhatsappTienda> => { llamadas.push('enlace'); return of(respuesta); },
            enlazar: () => {
              llamadas.push('enlazar');
              return of(w('esperando_qr', { qr: 'data:image/png;base64,iVBORw0KGgo=' }));
            },
            desenlazar: () => { llamadas.push('desenlazar'); return of(w('sin_enlazar')); },
            prueba: (t: string) => { llamadas.push('prueba ' + t); return of({ enviado: true, numero: '+52 775 123 4567' }); },
          },
        },
        { provide: ConfirmacionService, useValue: { pedir: () => Promise.resolve(confirmar) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(WhatsappTiendaComponent);
    fixture.detectChanges();
    return fixture;
  }
  const texto = (el: HTMLElement) => el.textContent!.replace(/\s+/g, ' ');
  const boton = (el: HTMLElement, t: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === t) as HTMLButtonElement;

  beforeEach(() => { confirmar = true; });
  afterEach(() => {
    // Lo que espera el QR vuelve a preguntar solo: que no se quede corriendo.
    TestBed.resetTestingModule();
  });

  it('sin enlazar: lo explica (con el aviso de que no es la conexión oficial) y al enlazar enseña el QR y los pasos', async () => {
    respuesta = w('sin_enlazar');
    const fixture = await montar();
    const el = fixture.nativeElement as HTMLElement;
    expect(texto(el)).toContain('Sin enlazar');
    expect(texto(el)).toContain('No es la conexión oficial de WhatsApp');
    boton(el, 'Enlazar WhatsApp').click();
    fixture.detectChanges();
    expect(llamadas).toContain('enlazar');
    const qr = el.querySelector('img.qr') as HTMLImageElement;
    expect(qr).not.toBeNull();
    expect(qr.alt).toContain('Código QR');
    expect(texto(el)).toContain('Dispositivos vinculados');
    expect(texto(el)).toContain('Vincular un dispositivo');
    fixture.destroy();
  });

  it('enlazado: dice con qué número, manda una prueba y se desenlaza preguntando antes', async () => {
    respuesta = w('enlazado', { numero: '+52 771 303 6351', nombre: 'Hitex', desde: '2026-10-16T19:00:00.000Z' });
    const fixture = await montar();
    const el = fixture.nativeElement as HTMLElement;
    expect(texto(el)).toContain('Enlazado con +52 771 303 6351 (Hitex)');

    // Sin número, la prueba no sale.
    boton(el, 'Mandar prueba').click();
    fixture.detectChanges();
    expect(llamadas.some((l) => l.startsWith('prueba'))).toBeFalse();
    expect(texto(el)).toContain('Escribe el número');

    fixture.componentInstance.telefonoPrueba = '775 123 4567';
    boton(el, 'Mandar prueba').click();
    fixture.detectChanges();
    expect(llamadas).toContain('prueba 775 123 4567');
    expect(texto(el)).toContain('se mandó la prueba a +52 775 123 4567');

    confirmar = false;
    await fixture.componentInstance.desenlazar();
    expect(llamadas).not.toContain('desenlazar');
    confirmar = true;
    await fixture.componentInstance.desenlazar();
    fixture.detectChanges();
    expect(llamadas).toContain('desenlazar');
    expect(texto(el)).toContain('Enlazar WhatsApp');
  });

  it('el aviso de lo que pasó se enseña (la sesión se cerró desde el celular)', async () => {
    respuesta = w('sin_enlazar', { aviso: 'Se cerró la sesión desde el celular. Para seguir mandando tickets, vuelve a enlazarlo.' });
    const fixture = await montar();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')!.textContent)
      .toContain('Se cerró la sesión desde el celular');
  });
});
