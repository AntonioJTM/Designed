import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Traspasos } from './traspasos';
import {
  EquivalenciaPaquetes,
  InventarioService,
  RecepcionInput,
  Traspaso,
  TraspasoInput,
} from '../../../core/services/inventario.service';
import { AuthService } from '../../../core/services/auth.service';
import { Almacen } from '../../../core/models/inventario.models';
import { Variante } from '../../../core/models/catalogo.models';

/**
 * Lo que se comprueba es lo que pidió el usuario: que se vea de qué hilo se trata
 * (color, calibre, material y línea), que se pida en KILOS y no deje pedir más de
 * lo que hay, que los conos no se traspasen, que el acuse de recibo declare lo
 * que de verdad llegó, y que enviar y recibir solo se ofrezcan a quien puede.
 */
describe('Traspasos', () => {
  const almacenes = [
    { id: 1, nombre: 'Bodega principal', es_matriz: 1, es_punto_venta: 0, activo: 1 },
    { id: 2, nombre: 'Tienda principal', es_matriz: 0, es_punto_venta: 1, activo: 1 },
  ] as unknown as Almacen[];

  const paquete = {
    id: 10,
    sku: 'NEGRO',
    producto: 'NEGRO',
    calibre: '2/30',
    material: 'ACRILAN',
    linea: 'Turco',
    tipo_presentacion: 'paquete',
    peso_kg: '19.011',
    precio: '100',
    activo: 1,
  } as unknown as Variante;

  const cono = {
    id: 11,
    sku: 'NEGRO-CONO',
    producto: 'NEGRO',
    calibre: '2/30',
    tipo_presentacion: 'cono',
    activo: 1,
  } as unknown as Variante;

  /** En la bodega hay 3 bultos: 57.03 kg libres. */
  const equivalencia: EquivalenciaPaquetes = {
    sku: 'NEGRO',
    producto: 'NEGRO',
    peso_nominal: '19.011',
    disponible: {
      paquetes: 3,
      kg_en_bultos: 57.033,
      peso_promedio: 19.011,
      peso_min: 18.5,
      peso_max: 19.8,
      kg_inventario: 57.033,
      kg_apartado: 0,
      kg_libre: 57.033,
    },
    peso_referencia: 19.011,
    referencia_nominal: false,
    sugerencia: null,
  };

  const enTransito: Traspaso = {
    id: 77,
    folio: 'TRA-77',
    estado: 'en_transito',
    almacen_origen: 'Bodega principal',
    almacen_destino: 'Tienda principal',
    num_lineas: 1,
    creado_en: '2026-07-28 10:00:00',
    lineas: [
      {
        detalle_id: 501,
        variante_id: 10,
        sku: 'NEGRO',
        producto: 'NEGRO',
        calibre: '2/30',
        material: 'ACRILAN',
        linea: 'Turco',
        paquetes: 3,
        cantidad: 57.033,
      },
    ],
  };

  let solicitado: TraspasoInput | null = null;
  let recibido: { id: number; body: RecepcionInput } | null = null;
  let cancelado: number | null = null;
  /** La equivalencia que contesta el servidor; una prueba la cambia. */
  let eqActual: EquivalenciaPaquetes = equivalencia;

  const invFalso = {
    almacenes: () => of(almacenes),
    traspasos: () => of({ items: [enTransito], total: 1, page: 1, limit: 50, paginas: 1 }),
    equivalenciaPaquetes: () => of(eqActual),
    buscarVariantes: () => of([paquete, cono]),
    solicitarTraspaso: (body: TraspasoInput) => {
      solicitado = body;
      return of({ id: 1, folio: 'TRA-1', estado: 'solicitado' as const, lineas: [] });
    },
    enviarTraspaso: (id: number) =>
      of({ id, folio: 'TRA-1', estado: 'en_transito' as const, lineas: [] }),
    cancelarTraspaso: (id: number) => {
      cancelado = id;
      return of({ id, folio: 'TRA-77', estado: 'cancelado' as const, lineas: [] });
    },
    recibirTraspaso: (id: number, body: RecepcionInput) => {
      recibido = { id, body };
      return of({ id, folio: 'TRA-77', estado: 'recibido' as const, faltantes: 1, lineas: [] });
    },
  };

  /** Los permisos del puesto; null = todos (el administrador). */
  let permisos: string[] | null = null;
  const authFalso = { puede: (p: string) => permisos === null || permisos.includes(p) };

  /** El historial que contesta el servidor; una prueba lo cambia. */
  let historial: Traspaso[] = [enTransito];

  async function montarFixture() {
    await TestBed.configureTestingModule({
      imports: [Traspasos],
      providers: [
        { provide: InventarioService, useValue: { ...invFalso, traspasos: () => of({ items: historial, total: historial.length, page: 1, limit: 100, paginas: 1 }) } },
        { provide: AuthService, useValue: authFalso },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Traspasos);
    fixture.detectChanges();
    return fixture;
  }

  async function montar() {
    return (await montarFixture()).componentInstance;
  }

  beforeEach(() => {
    solicitado = null;
    recibido = null;
    cancelado = null;
    eqActual = equivalencia;
    permisos = null;
    historial = [enTransito];
  });
  afterEach(() => TestBed.resetTestingModule());

  it('propone la matriz como origen y otra sucursal como destino', async () => {
    const c = await montar();
    expect(c.origen).toBe(1);
    expect(c.destino).toBe(2);
  });

  it('a la sucursal no se le mandan CONOS: se filtran de la búsqueda', async () => {
    const c = await montar();
    c.q = 'NEGRO';
    c.buscar();
    expect(c.resultados().map((v) => v.sku)).toEqual(['NEGRO']);
  });

  it('el hilo se identifica con color, calibre, material y línea', async () => {
    const c = await montar();
    expect(c.etiquetaHilo(paquete)).toBe('NEGRO 2/30 — ACRILAN · Turco');
  });

  it('se pide en KILOS y avisa cuando no alcanza', async () => {
    const c = await montar();
    c.agregar(paquete);

    // Hay 57.033 kg libres.
    c.cambiarKg(c.lineas()[0], 57.033);
    expect(c.insuficiente(c.lineas()[0])).toBe(false);
    expect(c.hayInsuficientes()).toBe(false);

    c.cambiarKg(c.lineas()[0], 60);
    expect(c.insuficiente(c.lineas()[0])).toBe(true);
    expect(c.hayInsuficientes()).toBe(true);
  });

  it('los paquetes son solo referencia: se calculan del peso real promedio', async () => {
    const c = await montar();
    c.agregar(paquete);
    // 100 kg / 19.011 kg por bulto ≈ 5.26 paquetes.
    c.cambiarKg(c.lineas()[0], 100);
    expect(c.enPaquetes(c.lineas()[0])).toBe(5.26);
    // Y el total del pie va en kilos.
    expect(c.totalKg()).toBe(100);
  });

  it('con una línea insuficiente NO manda la solicitud', async () => {
    const c = await montar();
    c.agregar(paquete);
    c.cambiarKg(c.lineas()[0], 500);
    c.solicitar();

    expect(solicitado).toBeNull();
    expect(c.error()).toContain('sin existencia suficiente');
  });

  it('la solicitud manda KILOS y avisa que la mercancía quedó apartada', async () => {
    const c = await montar();
    c.agregar(paquete);
    c.cambiarKg(c.lineas()[0], 38.5);
    c.solicitar();

    expect(solicitado).toEqual({
      almacen_origen_id: 1,
      almacen_destino_id: 2,
      notas: undefined,
      items: [{ variante_id: 10, cantidad: 38.5 }],
    });
    expect(c.mensaje()).toContain('apartada');
    expect(c.lineas().length).toBe(0);
  });

  it('separa los pendientes de los cerrados y dice qué falta hacer', async () => {
    const c = await montar();
    expect(c.pendientes().map((t) => t.folio)).toEqual(['TRA-77']);
    expect(c.cerrados().length).toBe(0);
    expect(c.textoEstado('solicitado')).toBe('Pendiente de envío');
    expect(c.textoEstado('en_transito')).toBe('En tránsito');
    expect(c.siguientePaso(enTransito)).toContain('acepte que lo recibió');
  });

  it('el acuse arranca con TODO lo enviado precargado', async () => {
    const c = await montar();
    c.abrirRecepcion(enTransito);
    const l = c.lineasRecepcion()[0];

    expect(l.detalle_id).toBe(501);
    expect(l.enPaquetes).toBe(true);
    expect(l.enviado).toBe(3);
    expect(l.recibido).toBe(3);
    expect(l.etiqueta).toBe('NEGRO 2/30 — ACRILAN · Turco');
    expect(c.faltantesRecepcion().length).toBe(0);
  });

  it('al aceptar menos, avisa el faltante y lo declara en paquetes', async () => {
    const c = await montar();
    c.abrirRecepcion(enTransito);
    c.cambiarRecibido(501, 2);

    expect(c.faltantesRecepcion().length).toBe(1);
    c.confirmarRecepcion();

    expect(recibido).toEqual({
      id: 77,
      body: { notas: undefined, recibido: [{ detalle_id: 501, paquetes: 2 }] },
    });
    expect(c.mensaje()).toContain('incompletas');
    // El acuse se cierra al firmar.
    expect(c.recibiendo()).toBeNull();
  });

  it('no deja aceptar más de lo que se envió', async () => {
    const c = await montar();
    c.abrirRecepcion(enTransito);
    c.cambiarRecibido(501, 5);
    c.confirmarRecepcion();

    expect(recibido).toBeNull();
    expect(c.error()).toContain('mayor a lo que se envió');
  });

  it('compara contra lo LIBRE, no contra la existencia: lo apartado ya tiene dueño', async () => {
    // Hay 57.033 kg, pero 20 ya los pidió otra sucursal: libres, 37.033.
    eqActual = {
      ...equivalencia,
      disponible: { ...equivalencia.disponible, kg_apartado: 20, kg_libre: 37.033 },
    };
    const c = await montar();
    c.agregar(paquete);
    expect(c.kilosLibres(c.lineas()[0])).toBe(37.033);
    expect(c.kilosApartados(c.lineas()[0])).toBe(20);

    c.cambiarKg(c.lineas()[0], 40);
    expect(c.insuficiente(c.lineas()[0])).toBe(true);
  });

  it('cerrar la pregunta del motivo NO cancela el traspaso', async () => {
    const c = await montar();
    c.cancelar(enTransito);
    expect(c.cancelando()?.id).toBe(77);
    // Cerrar con la ✕, "No cancelar" o Escape es "no cancelo".
    c.alEscape();
    expect(c.cancelando()).toBeNull();
    expect(cancelado).toBeNull();
  });

  it('confirmar sin motivo sí cancela', async () => {
    const c = await montar();
    c.cancelar(enTransito);
    c.confirmarCancelacion();
    expect(cancelado).toBe(77);
    expect(c.cancelando()).toBeNull();
    expect(c.mensaje()).toContain('regresó al origen');
  });

  it('dice en qué paso va y qué lleva', async () => {
    const c = await montar();
    expect(c.pasos(enTransito).map((p) => [p.texto, p.hecho, p.actual])).toEqual([
      ['Pedido', true, false],
      ['En camino', true, true],
      ['Recibido', false, false],
    ]);
    expect(c.resumenLleva(enTransito)).toBe('1 hilo · 57.033 kg · 3 paquetes');
  });

  it('lo que faltó al recibir se cuenta en kilos y se marca en el historial', async () => {
    const hoy = new Date();
    const mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    const recibidoIncompleto: Traspaso = {
      ...enTransito,
      id: 78,
      folio: 'TRA-78',
      estado: 'recibido',
      recibido_en: `${mes}-01 12:00:00`,
      lineas: [{ ...enTransito.lineas[0], cantidad: '57.033', cantidad_recibida: '54.633' }],
    };
    historial = [enTransito, recibidoIncompleto];
    const c = await montar();

    expect(c.faltanteDe(recibidoIncompleto)).toBe(2.4);
    expect(c.estadoCerrado(recibidoIncompleto)).toEqual({ texto: 'Faltaron 2.4 kg', clase: 'ambar' });
    const kpis = c.kpis();
    expect(kpis.find((k) => k.etiqueta === 'En camino')!.valor).toBe('1');
    expect(kpis.find((k) => k.etiqueta === 'Recibidos')!.valor).toBe('1');
    expect(kpis.find((k) => k.etiqueta === 'Faltó al recibir')!.valor).toBe('2.4 kg');
  });

  it('"Confirmar que llegó" solo se ofrece a quien puede recibir', async () => {
    let fixture = await montarFixture();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Confirmar que llegó');
    TestBed.resetTestingModule();

    permisos = ['ver:surtir'];
    fixture = await montarFixture();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('Confirmar que llegó');
    // Pero sí se ve qué le falta.
    expect(el.textContent).toContain('acepte que lo recibió');
  });

  it('"Enviar" solo se ofrece a quien puede enviar', async () => {
    const solicitud: Traspaso = { ...enTransito, id: 79, folio: 'TRA-79', estado: 'solicitado' };
    historial = [solicitud];
    permisos = ['ver:surtir', 'hacer:enviar_traspaso'];
    let fixture = await montarFixture();
    const boton = () =>
      [...(fixture.nativeElement as HTMLElement).querySelectorAll('.traspaso-acciones button')].map(
        (b) => b.textContent!.trim()
      );
    expect(boton()).toContain('Enviar');
    TestBed.resetTestingModule();

    permisos = ['ver:surtir'];
    fixture = await montarFixture();
    expect(boton()).not.toContain('Enviar');
    expect(boton()).toContain('Cancelar');
  });
});
