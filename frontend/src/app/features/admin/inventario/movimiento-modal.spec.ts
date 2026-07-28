import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MovimientoModal } from './movimiento-modal';
import { InventarioService } from '../../../core/services/inventario.service';
import { Almacen } from '../../../core/models/inventario.models';

describe('MovimientoModal', () => {
  const almacenes = [
    { id: 3, nombre: 'Bodega', es_punto_venta: 0, es_matriz: 1, es_tienda_linea: 0 },
  ] as unknown as Almacen[];

  let enviado: Record<string, unknown> | null = null;

  /** 100 bultos de 1,919.71 kg: el promedio real es 19.197, como el caso de la tienda. */
  const equivalencia = {
    sku: 'NEGRO',
    producto: 'NEGRO',
    peso_nominal: '19.197',
    disponible: {
      paquetes: 100,
      kg_en_bultos: 1919.71,
      peso_promedio: 19.197,
      peso_min: 10.75,
      peso_max: 19.8,
      kg_inventario: 1919.71,
    },
    peso_referencia: 19.197,
    referencia_nominal: false,
    sugerencia: null,
  };

  const invFalso = {
    buscarVariantes: (q: string) =>
      of(
        q === 'NEGRO'
          ? [
              {
                id: 5,
                sku: 'NEGRO',
                producto: 'NEGRO',
                presentacion: 'Paquete',
                tipo_presentacion: 'paquete',
                peso_kg: '19.197',
              },
            ]
          : []
      ),
    equivalenciaPaquetes: () => of(equivalencia),
    registrarMovimiento: (body: Record<string, unknown>) => {
      enviado = body;
      return of({ saldo_anterior: 1919.71, saldo_nuevo: 1842.912 });
    },
  };

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [MovimientoModal],
      providers: [{ provide: InventarioService, useValue: invFalso }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MovimientoModal);
    fixture.componentRef.setInput('almacenes', almacenes);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => (enviado = null));
  afterEach(() => TestBed.resetTestingModule());

  it('toma el primer almacén del input y solo ofrece ajuste y merma', async () => {
    const c = (await montar()).componentInstance;
    expect(c.mov.almacen_id).toBe(3);
    expect(c.tipos).toEqual(['ajuste', 'merma']);
    expect(c.esAjuste()).toBe(true);
  });

  it('una coincidencia única se autoselecciona (típico al escanear)', async () => {
    const c = (await montar()).componentInstance;
    c.q = 'NEGRO';
    c.buscar();
    expect(c.varianteSel).toBe(5);
    expect(c.mensaje()).toContain('NEGRO');
  });

  it('sin variante elegida no manda nada', async () => {
    const c = (await montar()).componentInstance;
    c.mov.cantidad = 10;
    c.registrar();
    expect(enviado).toBeNull();
    expect(c.error()).toBe('Elige variante, almacén y cantidad.');
  });

  it('registra la merma, avisa y NO se cierra', async () => {
    const c = (await montar()).componentInstance;
    let hechos = 0;
    let cerrados = 0;
    c.hecho.subscribe(() => hechos++);
    c.cerrado.subscribe(() => cerrados++);

    c.q = 'NEGRO';
    c.buscar();
    c.mov.tipo = 'merma';
    c.mov.cantidad = 5;
    c.mov.motivo = 'Se mojó';
    c.registrar();

    expect(enviado).toEqual({
      variante_id: 5,
      almacen_id: 3,
      tipo: 'merma',
      cantidad: 5,
      motivo: 'Se mojó',
    });
    expect(c.mensaje()).toContain('1919.71 → 1842.912');
    expect(hechos).toBe(1);
    // Sigue abierto: en un conteo se cuadran varios SKU seguidos.
    expect(cerrados).toBe(0);
    expect(c.mov.cantidad).toBeNull();
  });

  describe('captura en paquetes', () => {
    it('traduce paquetes a kilos con el promedio real y manda kilos', async () => {
      const c = (await montar()).componentInstance;
      c.q = 'NEGRO';
      c.buscar();

      expect(c.esPaquete()).toBe(true);
      expect(c.pesoRef()).toBe(19.197);

      c.unidad = 'paq';
      c.mov.cantidad = 96;
      // 96 × 19.197 = 1,842.912
      expect(c.kilos()).toBe(1842.912);

      c.registrar();
      expect(enviado!['cantidad']).toBe(1842.912);
    });

    it('la vista previa REACCIONA al teclear (no es un computed pegado)', async () => {
      const c = (await montar()).componentInstance;
      c.q = 'NEGRO';
      c.buscar();
      c.unidad = 'paq';

      c.mov.cantidad = 1;
      expect(c.kilos()).toBe(19.197);
      c.mov.cantidad = 2;
      expect(c.kilos()).toBe(38.394);
    });

    it('el ajuste sobreescribe el saldo y la merma resta', async () => {
      const c = (await montar()).componentInstance;
      c.q = 'NEGRO';
      c.buscar();

      expect(c.saldoActual()).toBe(1919.71);

      c.mov.tipo = 'ajuste';
      c.unidad = 'paq';
      c.mov.cantidad = 96;
      expect(c.saldoResultante()).toBe(1842.912);

      c.mov.tipo = 'merma';
      c.mov.cantidad = 2;
      // 1,919.71 − 38.394
      expect(c.saldoResultante()).toBe(1881.316);
    });

    it('avisa antes de intentar dejar el saldo en negativo', async () => {
      const c = (await montar()).componentInstance;
      c.q = 'NEGRO';
      c.buscar();

      c.mov.tipo = 'merma';
      c.unidad = 'paq';
      c.mov.cantidad = 200;
      expect(c.quedaNegativo()).toBe(true);
    });
  });
});
