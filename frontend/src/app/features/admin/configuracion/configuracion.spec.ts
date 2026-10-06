import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Configuracion } from './configuracion';
import { clabeLegible, clabeValida } from './cuenta-bancaria-modal';
import { TiendaService } from '../../../core/services/tienda.service';
import { CuentaBancaria, OpcionConfiguracion } from '../../../core/models/tienda.models';

/**
 * Con la tienda en línea apagada, la tarifa de envío (que solo cobra el pedido
 * en línea) no se dibuja, ni siquiera en "Otros". Lo demás sí, con las
 * etiquetas del diseño, y una clave nueva aparece sola en "Otros".
 * Guardar solo manda lo que cambió. Las cuentas para transferencias son una
 * lista aparte (pueden ser varias) y las claves viejas `transferencia_*` ya no
 * se dibujan.
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

  const cuenta = (id: number, banco: string, activa = 1): CuentaBancaria => ({
    id, banco, titular: 'Tienda de hilos', numero_cuenta: '0123456789', clabe: '032180000118359719',
    activa, creado_en: '', actualizado_en: '',
  });

  let enviado: Record<string, string | null> | null = null;
  const tiendaFalsa = {
    configuracionCompleta: () => of(opciones),
    cuentasBancarias: () => of([cuenta(1, 'BBVA'), cuenta(2, 'Banorte', 0)]),
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
    expect(texto).not.toContain('Para recibir depósitos');
    expect(texto).toContain('Leyenda al pie del ticket');
    expect(texto).toContain('Apagada');
  });

  it('enseña las cuentas para transferencias, cada una con su número y su CLABE', async () => {
    const fixture = await montar();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Cuentas para transferencias');
    expect(texto).toContain('BBVA');
    expect(texto).toContain('Banorte');
    expect(texto).toContain('0123456789');
    expect(texto).toContain('032 180 00011835971 9');
    expect(texto).toContain('Oculta');
  });

  it('revisa la CLABE como el backend', () => {
    expect(clabeValida('032180000118359719')).toBe(true);
    expect(clabeValida('032180000118359718')).toBe(false);
    expect(clabeValida('12345')).toBe(false);
    expect(clabeLegible('032180000118359719')).toBe('032 180 00011835971 9');
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
