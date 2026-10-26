import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { DesarmeModal } from './desarme-modal';
import {
  DesarmeInput,
  InventarioService,
  PreviaDesarme,
} from '../../../core/services/inventario.service';
import { Almacen } from '../../../core/models/inventario.models';
import { TiendaService } from '../../../core/services/tienda.service';

/**
 * Lo que importa del modal: que escanear muestre lo que trae el bulto, que al
 * confirmar mande el código y la tienda correcta, y que NO se cierre al
 * terminar —bajar varios paquetes seguidos es lo normal—.
 *
 * Desde el 2026-10-06 los conos solo se bajan en TIENDAS (la bodega ni se
 * ofrece) y el paquete se abre donde está. Desde el 2026-10-21 el destare es el
 * del PAQUETE completo (lo que pesan los tubos de todos sus conos), no por cono.
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
  /** El tope del destare que puso la tienda en Configuración (2026-10-20). */
  let tope: string | null = null;

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
      providers: [
        { provide: InventarioService, useValue: invFalso },
        { provide: TiendaService, useValue: { configuracion: () => of({ desarme_destare_max_kg: tope }) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DesarmeModal);
    fixture.componentRef.setInput('almacenes', almacenes);
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

  it('el destare es del paquete completo: se suma tal cual, sin multiplicar por los conos (2026-10-21)', async () => {
    const fixture = await montar();
    const c = fixture.componentInstance;

    c.codigo = 'B-001';
    c.escanear();
    expect(c.pesoEnconado()).toBe(10.75);

    // 0.35 kg de destare del paquete: entran 10.75 + 0.35 = 11.1 kg (no 0.35 × 7).
    c.destarePaquete = 0.35;
    expect(c.destare()).toBe(0.35);
    expect(c.pesoEnconado()).toBe(11.1);
    // Entre sus 7 conos son 50 g por cono: se enseña para notar un error de dedo.
    expect(c.gramosPorCono()).toBe(50);
    fixture.detectChanges();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Destare del paquete');
    expect(texto).not.toContain('Destare por cono');
    expect(texto).toContain('10.75 kg del paquete + 0.35 kg de destare');
    expect(texto).toContain('50 g por cono');
  });

  it('al bajar manda el código, la tienda y el destare del paquete, avisa y NO se cierra', async () => {
    const fixture = await montar();
    const c = fixture.componentInstance;

    let hechos = 0;
    let cerrados = 0;
    c.hecho.subscribe(() => hechos++);
    c.cerrado.subscribe(() => cerrados++);

    c.codigo = 'B-001';
    c.escanear();
    c.destarePaquete = 0.35;
    c.bajar();

    // Se abre donde está: la misma tienda de un lado y del otro; el destare va
    // como el TOTAL del paquete.
    expect(enviado).toEqual({
      codigo_bulto: 'B-001',
      almacen_origen_id: 2,
      almacen_destino_id: 2,
      destare_kg: 0.35,
      motivo: undefined,
    });
    expect(hechos).toBe(1);
    // Sigue abierto para escanear el siguiente paquete.
    expect(cerrados).toBe(0);
    expect(c.previaBulto()).toBeNull();
    expect(c.mensaje()).toContain('B-001');
    // Mientras la ventana siga abierta, el destare se queda para el siguiente.
    expect(c.destarePaquete).toBe(0.35);
  });

  it('lo recordado de antes era por cono: ya no se propone y se olvida', async () => {
    localStorage.setItem('destare_por_cono', '0.035');
    const fixture = await montar();
    expect(fixture.componentInstance.destarePaquete).toBeNull();
    expect(localStorage.getItem('destare_por_cono')).toBeNull();
  });

  it('el tope de la tienda es por cono: para el paquete es eso × sus conos', async () => {
    tope = '0.05';
    enviado = null;
    const fixture = await montar();
    const c = fixture.componentInstance;
    expect(c.topeDestare()).toBe(0.05);

    c.codigo = 'B-001';
    c.escanear();
    // 7 conos × 50 g = hasta 0.35 kg para este paquete.
    expect(c.topeDelPaquete()).toBe(0.35);
    // El error de antes: 0.8 escrito como si fuera de un cono.
    c.destarePaquete = 0.8;
    expect(c.pasaDelTope()).toBeTrue();
    c.bajar();
    expect(enviado).toBeNull();
    expect(c.error()).toContain('114 g por cono');
    expect(c.error()).toContain('el tope es de 50 g por cono');
    expect(c.error()).toContain('hasta 0.35 kg');

    c.destarePaquete = 0.245;
    expect(c.pasaDelTope()).toBeFalse();
    c.bajar();
    expect(enviado!.destare_kg).toBe(0.245);
    tope = null;
  });

  it('sin tope de la tienda vale 1 kg por cono', async () => {
    const fixture = await montar();
    const c = fixture.componentInstance;
    c.codigo = 'B-001';
    c.escanear();
    expect(c.topeDelPaquete()).toBe(7);
    c.destarePaquete = 7.5;
    expect(c.pasaDelTope()).toBeTrue();
    c.destarePaquete = 0.8;
    expect(c.pasaDelTope()).toBeFalse();
  });

  it('solo se baja con el codigo del paquete: ya no hay captura a mano (2026-10-18)', async () => {
    const fixture = await montar();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('details.a-mano')).toBeNull();
    expect(el.textContent).not.toContain('Capturar a mano');
    expect(el.textContent).not.toContain('Desarmar sin escanear');
    // Lo que se manda es el codigo del paquete: ni cono, ni paquetes, ni kilos.
    const c = fixture.componentInstance;
    c.codigo = 'B-001';
    c.escanear();
    c.bajar();
    expect(enviado).toBeTruthy();
    expect(enviado!.codigo_bulto).toBe('B-001');
    expect(Object.keys(enviado!)).not.toContain('kg');
    expect(Object.keys(enviado!)).not.toContain('paquetes');
    expect(Object.keys(enviado!)).not.toContain('cono_variante_id');
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
