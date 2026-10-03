import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Configuracion } from './configuracion';
import { TiendaService } from '../../../core/services/tienda.service';
import { OpcionConfiguracion } from '../../../core/models/tienda.models';

/**
 * Con la tienda en línea apagada, la tarifa de envío (que solo cobra el pedido
 * en línea) no se dibuja, ni siquiera en "Otros". Lo demás sí, con las
 * etiquetas del diseño, y una clave nueva aparece sola en "Otros".
 * Guardar solo manda lo que cambió.
 */
describe('Configuracion', () => {
  const op = (clave: string, valor: string | null, descripcion = ''): OpcionConfiguracion => ({
    clave, valor, descripcion, publica: 1, actualizado_en: '',
  });
  const opciones = [
    op('envio_costo_fijo', '80.00', 'Lo que se cobra por enviar'),
    op('transferencia_banco', 'BBVA'),
    op('transferencia_titular', null),
    op('transferencia_clabe', null),
    op('tienda_telefono', null),
    op('tienda_direccion', null),
    op('ticket_leyenda', null, 'Leyenda al pie del ticket'),
  ];

  let enviado: Record<string, string | null> | null = null;
  const tiendaFalsa = {
    configuracionCompleta: () => of(opciones),
    guardarConfiguracion: (c: Record<string, string | null>) => {
      enviado = c;
      return of(opciones);
    },
  };

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [Configuracion],
      providers: [{ provide: TiendaService, useValue: tiendaFalsa }],
    }).compileComponents();
    const fixture = TestBed.createComponent(Configuracion);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => (enviado = null));
  afterEach(() => TestBed.resetTestingModule());

  it('esconde el envío y dibuja lo demás con sus etiquetas', async () => {
    const fixture = await montar();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).not.toContain('Costo de envío');
    expect(texto).not.toContain('Lo que se cobra por enviar');
    expect(texto).toContain('La tienda');
    expect(texto).toContain('Para recibir depósitos');
    expect(texto).toContain('CLABE');
    expect(texto).toContain('Leyenda al pie del ticket');
    expect(texto).toContain('Apagada');
  });

  it('guardar solo manda lo que cambió', async () => {
    const fixture = await montar();
    const c = fixture.componentInstance;
    expect(c.hayCambios()).toBe(false);
    c.valores['tienda_telefono'] = ' 445 123 4567 ';
    c.guardar();
    expect(enviado).toEqual({ tienda_telefono: '445 123 4567' });
  });
});
