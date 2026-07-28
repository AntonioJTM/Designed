import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { DesarmeModal } from './desarme-modal';
import {
  DesarmeInput,
  InventarioService,
  PreviaDesarme,
} from '../../../core/services/inventario.service';
import { Almacen } from '../../../core/models/inventario.models';

/**
 * Lo que importa del modal: que escanear muestre lo que trae el bulto, que al
 * confirmar mande el código y los almacenes correctos, y que NO se cierre al
 * terminar —bajar varios paquetes seguidos es lo normal—.
 */
describe('DesarmeModal', () => {
  const almacenes = [
    { id: 1, nombre: 'Bodega', es_punto_venta: 0, es_matriz: 1, es_tienda_linea: 0 },
    { id: 2, nombre: 'Tienda principal', es_punto_venta: 1, es_matriz: 0, es_tienda_linea: 1 },
  ] as unknown as Almacen[];

  const previa: PreviaDesarme = {
    bulto: { codigo: 'B-001', peso_kg: '10.750', lote: 'L1', conos: 7 },
    paquete: {
      variante_id: 5,
      sku: 'NEGRO',
      producto: 'NEGRO',
      presentacion: 'Paquete',
      peso_kg: '19.197',
      precio: '50.00',
    },
    cono: null,
    conos_a_generar: 7,
    // El bulto está en la bodega, no en el mostrador.
    existencias: [{ almacen_id: 1, almacen: 'Bodega', cantidad: '1919.710' }],
  };

  let enviado: DesarmeInput | null = null;

  const invFalso = {
    previaDesarme: (codigo: string) =>
      codigo === 'B-001' ? of(previa) : throwError(() => ({ error: { error: { message: 'No es un código' } } })),
    desarmar: (body: DesarmeInput) => {
      enviado = body;
      return of({
        conversion_id: 1,
        producto: 'NEGRO',
        paquetes: 1,
        kg_consumidos: 10.75,
        kg_enconados: 11.25,
        destare_kg: 0.5,
        piezas_generadas: 7,
        paquete: { variante_id: 5, sku: 'NEGRO', almacen_id: 1, saldo_nuevo: 1908.96 },
        cono: { variante_id: 9, sku: 'NEGRO-CONO', almacen_id: 2, saldo_nuevo: 11.25 },
      });
    },
  };

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [DesarmeModal],
      providers: [{ provide: InventarioService, useValue: invFalso }],
    }).compileComponents();

    const fixture = TestBed.createComponent(DesarmeModal);
    fixture.componentRef.setInput('almacenes', almacenes);
    fixture.componentRef.setInput('conos', []);
    fixture.componentRef.setInput('conversiones', []);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => (enviado = null));
  afterEach(() => TestBed.resetTestingModule());

  it('al escanear muestra el bulto y propone bodega → mostrador', async () => {
    const fixture = await montar();
    const c = fixture.componentInstance;

    c.codigo = 'B-001';
    c.escanear();

    expect(c.previaBulto()?.bulto.codigo).toBe('B-001');
    // El origen sale de donde de verdad está la mercancía…
    expect(c.origen).toBe(1);
    // …y el destino es un mostrador distinto del origen.
    expect(c.bajarA).toBe(2);
    // El campo queda libre para el siguiente disparo del lector.
    expect(c.codigo).toBe('');
  });

  it('el destare se suma a los kilos que entran, no a los que salen', async () => {
    const fixture = await montar();
    const c = fixture.componentInstance;

    c.codigo = 'B-001';
    c.escanear();
    expect(c.pesoEnconado()).toBe(10.75);

    c.destare = 0.5;
    expect(c.pesoEnconado()).toBe(11.25);
  });

  it('al bajar manda el código y los almacenes, avisa y NO se cierra', async () => {
    const fixture = await montar();
    const c = fixture.componentInstance;

    let hechos = 0;
    let cerrados = 0;
    c.hecho.subscribe(() => hechos++);
    c.cerrado.subscribe(() => cerrados++);

    c.codigo = 'B-001';
    c.escanear();
    c.destare = 0.5;
    c.bajar();

    expect(enviado).toEqual({
      codigo_bulto: 'B-001',
      almacen_origen_id: 1,
      almacen_destino_id: 2,
      destare_kg: 0.5,
      motivo: undefined,
    });
    expect(hechos).toBe(1);
    // Sigue abierto para escanear el siguiente paquete.
    expect(cerrados).toBe(0);
    expect(c.previaBulto()).toBeNull();
    expect(c.mensaje()).toContain('B-001');
    expect(c.destare).toBeNull();
  });

  it('la previa de la captura a mano reacciona al teclear', async () => {
    // Venía de un `computed` sobre campos de ngModel, que no son señales: se
    // calculaba una vez y se quedaba pegado.
    await TestBed.configureTestingModule({
      imports: [DesarmeModal],
      providers: [{ provide: InventarioService, useValue: invFalso }],
    }).compileComponents();
    const fixture = TestBed.createComponent(DesarmeModal);
    fixture.componentRef.setInput('almacenes', almacenes);
    fixture.componentRef.setInput('conos', [
      {
        id: 9,
        sku: 'NEGRO-CONO',
        producto: 'NEGRO',
        tipo_presentacion: 'cono',
        paquete_sku: 'NEGRO',
        paquete_peso_kg: '19.197',
        piezas_por_origen: 12,
      },
    ]);
    fixture.componentRef.setInput('conversiones', []);
    fixture.detectChanges();
    const c = fixture.componentInstance;

    c.manual.paquetes = 1;
    expect(c.previaManual()?.kg).toBe(19.197);
    expect(c.previaManual()?.piezas).toBe(12);

    c.manual.paquetes = 2;
    expect(c.previaManual()?.kg).toBe(38.394);
    expect(c.previaManual()?.piezas).toBe(24);

    // Un bulto que rinde menos: los kilos y los conos reales ganan al nominal.
    c.manual.paquetes = 1;
    c.manual.kg = 10.75;
    c.manual.conos = 7;
    expect(c.previaManual()?.kg).toBe(10.75);
    expect(c.previaManual()?.ajustado).toBe(true);
    expect(c.previaManual()?.piezas).toBe(7);
    expect(c.previaManual()?.piezasAjustadas).toBe(true);
  });

  it('un código que no existe deja el error y no muestra previa', async () => {
    const fixture = await montar();
    const c = fixture.componentInstance;

    c.codigo = 'XXX';
    c.escanear();

    expect(c.previaBulto()).toBeNull();
    expect(c.error()).toBe('No es un código');
  });
});
