import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { EnvioModal } from './envio-modal';
import { CodigoResuelto, InventarioService, ResultadoTraspaso, Traspaso } from '../../../core/services/inventario.service';

/**
 * Lo que importa al surtir escaneando (usuario, 2026-10-06):
 *   · cada paquete escaneado entra con su peso REAL y suma a su hilo;
 *   · se avisa en el momento lo que no puede salir: el código de la
 *     presentación, un paquete de otro hilo, uno ya vendido, uno repetido o un
 *     código que no existe;
 *   · al enviar se mandan los códigos escaneados.
 */
describe('EnvioModal', () => {
  const traspaso = {
    id: 7, folio: 'TRA-7', estado: 'solicitado', almacen_origen: 'Bodega', almacen_destino: 'Tienda',
    num_lineas: 1, creado_en: '2026-10-06 10:00:00',
    lineas: [{ detalle_id: 70, variante_id: 10, sku: 'NEGRO-2-30', producto: 'NEGRO', calibre: '2/30',
      material: 'ACRILAN', linea: 'Turco', paquetes: '2.000', cantidad: '38.022' }],
  } as unknown as Traspaso;

  const negro = { id: 10, producto: 'NEGRO', calibre: '2/30' };
  const bulto = (codigo: string, peso: string, extra: object = {}) => ({
    variante: negro, bulto: { id: 1, variante_id: 10, codigo, peso_kg: peso, lote: 'L1', estado: 'disponible', ...extra },
  }) as unknown as CodigoResuelto;

  const respuestas: Record<string, CodigoResuelto> = {
    A1: bulto('A1', '18.650'),
    A2: bulto('A2', '19.450'),
    A3: bulto('A3', '18.900'),
    VENDIDO: bulto('VENDIDO', '19.000', { estado: 'vendido', consumido_folio: 'POS-79FA' }),
    PRESENTACION: { variante: negro, bulto: null } as unknown as CodigoResuelto,
    BLANCO: { variante: { id: 20, producto: 'BLANCO', calibre: '1/30' },
      bulto: { id: 9, variante_id: 20, codigo: 'BLANCO', peso_kg: '19.000', estado: 'disponible' } } as unknown as CodigoResuelto,
  };

  let enviado: { id: number; codigos: string[]; notas?: string } | null = null;
  const invFalso = {
    resolverCodigo: (c: string) =>
      respuestas[c] ? of(respuestas[c]) : throwError(() => ({ status: 404 })),
    enviarTraspaso: (id: number, codigos: string[], notas?: string) => {
      enviado = notas ? { id, codigos, notas } : { id, codigos };
      return of({ id, folio: 'TRA-7', estado: 'en_transito', lineas: [] } as ResultadoTraspaso);
    },
  };

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [EnvioModal],
      providers: [{ provide: InventarioService, useValue: invFalso }],
    }).compileComponents();
    const fixture = TestBed.createComponent(EnvioModal);
    fixture.componentRef.setInput('traspaso', traspaso);
    fixture.detectChanges();
    return fixture;
  }

  function escanear(c: EnvioModal, codigo: string) {
    c.codigo = codigo;
    c.leer();
  }

  beforeEach(() => (enviado = null));
  afterEach(() => TestBed.resetTestingModule());

  it('cada paquete escaneado suma su peso REAL a su hilo', async () => {
    const c = (await montar()).componentInstance;
    escanear(c, 'A1');
    escanear(c, 'A2');
    const l = traspaso.lineas[0];
    expect(c.cuantos(l)).toBe(2);
    expect(c.kgDe(l)).toBe(38.1);
    expect(c.totalKg()).toBe(38.1);
    expect(c.diferencia(l)).toBeNull();
    expect(c.incompletos().length).toBe(0);
    expect(c.ultimo()).toContain('A2');
  });

  it('dice si van de más o faltan contra lo pedido', async () => {
    const c = (await montar()).componentInstance;
    escanear(c, 'A1');
    expect(c.diferencia(traspaso.lineas[0])).toBe('faltan 1');
    escanear(c, 'A2');
    escanear(c, 'A3');
    expect(c.diferencia(traspaso.lineas[0])).toBe('1 de más');
  });

  it('avisa en el momento lo que no puede salir, sin agregarlo', async () => {
    const c = (await montar()).componentInstance;
    escanear(c, 'PRESENTACION');
    expect(c.error()).toContain('es el de la presentación');
    escanear(c, 'BLANCO');
    expect(c.error()).toContain('BLANCO 1/30, que no está en este traspaso');
    escanear(c, 'VENDIDO');
    expect(c.error()).toContain('ya se vendió (POS-79FA)');
    escanear(c, 'NOEXISTE');
    expect(c.error()).toContain('no está registrado');
    expect(c.escaneados().length).toBe(0);
  });

  it('el mismo paquete no entra dos veces', async () => {
    const c = (await montar()).componentInstance;
    escanear(c, 'A1');
    escanear(c, 'A1');
    expect(c.escaneados().length).toBe(1);
    expect(c.error()).toContain('ya está en la lista');
  });

  it('el campo queda vacío tras cada lectura, aunque el Enter llegue pegado al último dígito', async () => {
    const fixture = await montar();
    const input = (fixture.nativeElement as HTMLElement).querySelector('input[type=text]') as HTMLInputElement;
    // Como un lector: escribe y da Enter sin que la pantalla se actualice entre medio.
    input.value = 'A1';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(input.value).toBe('');
    expect(fixture.componentInstance.escaneados().map((p) => p.codigo)).toEqual(['A1']);
  });

  it('quitar uno lo saca de la cuenta', async () => {
    const c = (await montar()).componentInstance;
    escanear(c, 'A1');
    escanear(c, 'A2');
    c.quitar('A1');
    expect(c.escaneados().map((p) => p.codigo)).toEqual(['A2']);
    expect(c.totalKg()).toBe(19.45);
  });

  it('al enviar manda los códigos escaneados y avisa a la pantalla', async () => {
    const c = (await montar()).componentInstance;
    let salio = false;
    c.enviado.subscribe(() => (salio = true));
    escanear(c, 'A1');
    escanear(c, 'A2');
    c.confirmar();
    expect(enviado).toEqual({ id: 7, codigos: ['A1', 'A2'] });
    expect(salio).toBe(true);
  });

  it('sin escanear NO se puede enviar', async () => {
    const fixture = await montar();
    const c = fixture.componentInstance;
    const boton = () =>
      [...(fixture.nativeElement as HTMLElement).querySelectorAll('.modal-foot button')].find(
        (b) => b.textContent?.includes('Enviar')
      ) as HTMLButtonElement;
    fixture.detectChanges();
    expect(boton().disabled).toBe(true);
    c.confirmar();
    expect(enviado).toBeNull();
    // En cuanto cada hilo tiene al menos uno, ya se puede.
    escanear(c, 'A1');
    fixture.detectChanges();
    expect(boton().disabled).toBe(false);
  });

  it('se manda lo que hay: un hilo sin paquetes no sale, y se avisa antes', async () => {
    const dos = {
      ...traspaso,
      lineas: [...traspaso.lineas, { detalle_id: 71, variante_id: 20, sku: 'BLANCO-1-30', producto: 'BLANCO',
        calibre: '1/30', paquetes: '1.000', cantidad: '19.000' }],
    } as unknown as Traspaso;
    await TestBed.configureTestingModule({
      imports: [EnvioModal],
      providers: [{ provide: InventarioService, useValue: invFalso }],
    }).compileComponents();
    const fixture = TestBed.createComponent(EnvioModal);
    fixture.componentRef.setInput('traspaso', dos);
    fixture.detectChanges();
    const c = fixture.componentInstance;
    escanear(c, 'A1');
    c.notas = 'Va en la camioneta 2';
    fixture.detectChanges();
    expect(c.incompletos()).toEqual(['NEGRO 2/30 (1 de 2)', 'BLANCO 1/30 (no sale)']);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('era lo único que había');
    c.confirmar();
    expect(enviado).toEqual({ id: 7, codigos: ['A1'], notas: 'Va en la camioneta 2' });
  });
});
