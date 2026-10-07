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
 * confirmar mande el código y la tienda correcta, y que NO se cierre al
 * terminar —bajar varios paquetes seguidos es lo normal—.
 *
 * Desde el 2026-10-06 los conos solo se bajan en TIENDAS (la bodega ni se
 * ofrece) y el paquete se abre donde está; el destare se captura POR CONO y se
 * multiplica por los conos que salen.
 */
describe('DesarmeModal', () => {
  const almacenes = [
    { id: 1, nombre: 'Bodega', es_punto_venta: 0, es_matriz: 1, es_tienda_linea: 0 },
    { id: 2, nombre: 'Tienda principal', es_punto_venta: 1, es_matriz: 0, es_tienda_linea: 1 },
  ] as unknown as Almacen[];

  const previa: PreviaDesarme = {
    // El paquete está en la tienda: ahí se puede abrir.
    bulto: { codigo: 'B-001', peso_kg: '10.750', lote: 'L1', conos: 7, almacen_id: 2, almacen: 'Tienda principal', en_tienda: true },
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
    existencias: [
      { almacen_id: 1, almacen: 'Bodega', cantidad: '1919.710' },
      { almacen_id: 2, almacen: 'Tienda principal', cantidad: '40.000' },
    ],
  };
  // El mismo hilo, pero ESTE paquete sigue en la bodega.
  const enBodega: PreviaDesarme = {
    ...previa,
    bulto: { ...previa.bulto, codigo: 'B-002', almacen_id: 1, almacen: 'Bodega', en_tienda: false },
  };

  let enviado: DesarmeInput | null = null;

  const invFalso = {
    previaDesarme: (codigo: string) =>
      codigo === 'B-001'
        ? of(previa)
        : codigo === 'B-002'
          ? of(enBodega)
          : throwError(() => ({ error: { error: { message: 'No es un código' } } })),
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

  beforeEach(() => {
    enviado = null;
    try { localStorage.removeItem('destare_por_cono'); } catch { /* sin almacenamiento */ }
  });
  afterEach(() => TestBed.resetTestingModule());

  it('solo ofrece tiendas: la bodega no', async () => {
    const fixture = await montar();
    expect(fixture.componentInstance.tiendas().map((t) => t.nombre)).toEqual(['Tienda principal']);
  });

  it('al escanear muestra el bulto y propone la tienda donde está', async () => {
    const fixture = await montar();
    const c = fixture.componentInstance;

    c.codigo = 'B-001';
    c.escanear();
    fixture.detectChanges();

    expect(c.previaBulto()?.bulto.codigo).toBe('B-001');
    expect(c.tienda).toBe(2);
    expect(c.problemaUbicacion()).toBeNull();
    // El campo queda libre para el siguiente disparo del lector.
    expect(c.codigo).toBe('');
  });

  it('si el paquete NO está en la tienda, avisa dónde está y no deja bajarlo', async () => {
    const fixture = await montar();
    const c = fixture.componentInstance;

    c.codigo = 'B-002';
    c.escanear();
    fixture.detectChanges();

    expect(c.problemaUbicacion()).toContain('no está en «Tienda principal»');
    expect(c.problemaUbicacion()).toContain('«Bodega»');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Primero mándalo a la tienda con Surtir sucursal');
    const boton = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Bajar a mostrador'))!;
    expect(boton.disabled).toBe(true);
    c.bajar();
    expect(enviado).toBeNull();
  });

  it('si viene en camino, primero se recibe', async () => {
    const fixture = await montar();
    const c = fixture.componentInstance;
    c.previaBulto.set({ ...previa, bulto: { ...previa.bulto, en_camino_folio: 'TRA-9' } });
    c.tienda = 2;
    expect(c.problemaUbicacion()).toContain('viene en camino (TRA-9)');
  });

  it('el destare es por cono: se multiplica por los conos y se suma a lo que entra', async () => {
    const fixture = await montar();
    const c = fixture.componentInstance;

    c.codigo = 'B-001';
    c.escanear();
    expect(c.pesoEnconado()).toBe(10.75);

    // 7 conos × 0.05 kg = 0.35 kg más.
    c.destarePorCono = 0.05;
    expect(c.destareTotal(7)).toBe(0.35);
    expect(c.pesoEnconado()).toBe(11.1);
    expect(c.gramos()).toBe(50);
  });

  it('al bajar manda el código y la tienda, avisa, recuerda el destare y NO se cierra', async () => {
    const fixture = await montar();
    const c = fixture.componentInstance;

    let hechos = 0;
    let cerrados = 0;
    c.hecho.subscribe(() => hechos++);
    c.cerrado.subscribe(() => cerrados++);

    c.codigo = 'B-001';
    c.escanear();
    c.destarePorCono = 0.05;
    c.bajar();

    // Se abre donde está: la misma tienda de un lado y del otro.
    expect(enviado).toEqual({
      codigo_bulto: 'B-001',
      almacen_origen_id: 2,
      almacen_destino_id: 2,
      destare_por_cono_kg: 0.05,
      motivo: undefined,
    });
    expect(hechos).toBe(1);
    // Sigue abierto para escanear el siguiente paquete.
    expect(cerrados).toBe(0);
    expect(c.previaBulto()).toBeNull();
    expect(c.mensaje()).toContain('B-001');
    // El tubo es el mismo para el siguiente paquete: el destare se queda.
    expect(c.destarePorCono).toBe(0.05);
    expect(localStorage.getItem('destare_por_cono')).toBe('0.05');
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

    // Con destare por cono, los 7 conos suman 7 × 0.03 = 0.21 kg.
    c.destarePorCono = 0.03;
    expect(c.previaManual()?.destare).toBe(0.21);
    expect(c.previaManual()?.kgEnconados).toBe(10.96);
    // A mano también se abre en una tienda.
    expect(c.manual.tienda).toBe(2);
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
