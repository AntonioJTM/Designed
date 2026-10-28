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
import { AutorizacionesService } from '../../../core/services/autorizaciones.service';
import { provideRouter } from '@angular/router';
import { SolicitudTraspaso } from '../../../core/services/inventario.service';
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

  /** Los almacenes que contesta el servidor; una prueba los cambia. */
  let almacenesActuales: Almacen[] = almacenes;
  /** ¿Se preguntó cuánto hay en el origen? */
  let pidioEquivalencia = false;

  /** Los pedidos con autorización (2026-10-20). */
  let solicitudesActuales: SolicitudTraspaso[] = [];
  let retiradas: number[] = [];
  /** Los PDF que se pidieron (2026-10-20): "77-envio", "77-recepcion". */
  let pdfs: string[] = [];

  const invFalso = {
    almacenes: () => of(almacenesActuales),
    solicitudesTraspaso: () => of(solicitudesActuales),
    traspasos: () => of({ items: [enTransito], total: 1, page: 1, limit: 50, paginas: 1 }),
    equivalenciaPaquetes: () => {
      pidioEquivalencia = true;
      return of(eqActual);
    },
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
    pdfTraspaso: (id: number, tipo: string) => {
      pdfs.push(`${id}-${tipo}`);
      return of(new Blob(['%PDF'], { type: 'application/pdf' }));
    },
  };

  /** Los permisos del puesto; null = todos (el administrador). */
  let permisos: string[] | null = null;
  const authFalso = {
    puede: (p: string) => permisos === null || permisos.includes(p),
    puedeOPide: (p: string) => permisos === null || permisos.includes(p) || permisos.includes(p.replace('hacer:', 'pedir:')),
    veTodasLasTiendas: () => todasLasTiendas,
  };
  /** ¿Ve todas las tiendas? Una prueba lo apaga (pedir a ciegas). */
  let todasLasTiendas = true;

  /** El historial que contesta el servidor; una prueba lo cambia. */
  let historial: Traspaso[] = [enTransito];

  async function montarFixture() {
    await TestBed.configureTestingModule({
      imports: [Traspasos],
      providers: [
        { provide: InventarioService, useValue: { ...invFalso, traspasos: () => of({ items: historial, total: historial.length, page: 1, limit: 100, paginas: 1 }) } },
        { provide: AuthService, useValue: authFalso },
        { provide: AutorizacionesService, useValue: { cancelar: (id: number) => { retiradas.push(id); return of({}); } } },
        provideRouter([]),
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
    todasLasTiendas = true;
    almacenesActuales = almacenes;
    pidioEquivalencia = false;
    pdfs = [];
    // Que la prueba no descargue de verdad.
    spyOn(HTMLAnchorElement.prototype, 'click');
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

  it('se pide en PAQUETES y avisa cuando no alcanza', async () => {
    const c = await montar();
    c.agregar(paquete);
    // Arranca en 1 paquete.
    expect(c.lineas()[0].paquetes).toBe(1);

    // Hay 3 bultos: los 3 caben en lo libre.
    c.cambiarPaquetes(c.lineas()[0], 3);
    expect(c.insuficiente(c.lineas()[0])).toBe(false);
    expect(c.hayInsuficientes()).toBe(false);

    c.cambiarPaquetes(c.lineas()[0], 4);
    expect(c.insuficiente(c.lineas()[0])).toBe(true);
    expect(c.hayInsuficientes()).toBe(true);
  });

  it('los kilos son un aproximado: paquetes × el peso promedio del origen', async () => {
    const c = await montar();
    c.agregar(paquete);
    // Quien surte agarra los que tenga a la mano: 2 × 19.011 (el promedio).
    c.cambiarPaquetes(c.lineas()[0], 2);
    expect(c.pesoPaquete(c.lineas()[0])).toBe(19.011);
    expect(c.pesoDeCatalogo(c.lineas()[0])).toBe(false);
    expect(c.kgAprox(c.lineas()[0])).toBe(38.022);
    expect(c.totalPaquetes()).toBe(2);
    expect(c.totalKg()).toBe(38.022);
    expect(c.paquetesLibres(c.lineas()[0])).toBe(3);
  });

  it('sin paquetes con peso en el origen, usa el del catálogo y lo dice', async () => {
    eqActual = { ...equivalencia, peso_referencia: 19.094, referencia_nominal: true };
    const c = await montar();
    c.agregar(paquete);
    c.cambiarPaquetes(c.lineas()[0], 2);
    expect(c.pesoDeCatalogo(c.lineas()[0])).toBe(true);
    expect(c.kgAprox(c.lineas()[0])).toBe(38.188);
  });

  it('con una línea insuficiente NO manda la solicitud', async () => {
    const c = await montar();
    c.agregar(paquete);
    c.cambiarPaquetes(c.lineas()[0], 30);
    c.solicitar();

    expect(solicitado).toBeNull();
    expect(c.error()).toContain('sin existencia suficiente');
  });

  it('la solicitud manda PAQUETES y avisa que la mercancía quedó apartada', async () => {
    const c = await montar();
    c.agregar(paquete);
    c.cambiarPaquetes(c.lineas()[0], 2);
    c.solicitar();

    expect(solicitado).toEqual({
      almacen_origen_id: 1,
      almacen_destino_id: 2,
      notas: undefined,
      items: [{ variante_id: 10, paquetes: 2 }],
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
    expect(c.mensaje()).toContain('llegó incompleto');
    // El acuse se cierra al firmar.
    expect(c.recibiendo()).toBeNull();
  });

  it('con los paquetes escaneados se palomean los que NO llegaron y se mandan sus códigos (2026-10-20)', async () => {
    const f = await montarFixture();
    const c = f.componentInstance;
    const conPaquetes = {
      ...enTransito,
      lineas: (enTransito.lineas ?? []).map((l, i) => i === 0
        ? { ...l, paquetes: 3, enviados: [
          { codigo: 'P-1', peso_kg: '19.100', falto: false },
          { codigo: 'P-2', peso_kg: '18.400', falto: false },
          { codigo: 'P-3', peso_kg: '19.500', falto: false },
        ] }
        : l),
    } as typeof enTransito;
    c.abrirRecepcion(conPaquetes);
    const linea = c.lineasRecepcion()[0];
    expect(linea.paquetes.length).toBe(3);
    expect(linea.recibido).toBe(3);

    c.marcarFalta(linea.detalle_id, 'P-2', true);
    const l2 = c.lineasRecepcion()[0];
    expect(l2.recibido).toBe(2);
    expect(c.kgFaltan(l2)).toBe(18.4);
    expect(c.faltantesRecepcion().length).toBe(1);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).toContain('falta 1 paquete');

    c.confirmarRecepcion();
    expect(recibido!.body.recibido![0]).toEqual({ detalle_id: linea.detalle_id, faltan: ['P-2'] });
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

    // 1 paquete (≈ 19.011 kg) cabe; 2 (≈ 38.022 kg) ya no.
    expect(c.paquetesLibres(c.lineas()[0])).toBe(1);
    c.cambiarPaquetes(c.lineas()[0], 1);
    expect(c.insuficiente(c.lineas()[0])).toBe(false);
    c.cambiarPaquetes(c.lineas()[0], 2);
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

  /*
   * CADA QUIEN, SUS TIENDAS (2026-10-15, "nada de la Matriz"): quien es de una
   * sola tienda pide para la suya y no ve cuánto hay en la matriz; si no hay
   * tantos, le mandan los que tengan. Surtir le toca a la matriz.
   */
  /*
   * LA BARRA DE CADA HILO (2026-10-16): cuántos paquetes van de los pedidos;
   * por enviar, los escaneados; en camino, los que salieron. Verde completa.
   */
  it('por enviar: la barra dice cuántos van escaneados de los pedidos y sus kilos', async () => {
    const linea = { ...enTransito.lineas[0], paquetes: 8, paquetes_solicitados: 8, cantidad: 152.4,
      guardados: [{ codigo: 'A', peso_kg: '19.05', variante_id: 10 }, { codigo: 'B', peso_kg: '19.10', variante_id: 10 },
        { codigo: 'C', peso_kg: '18.95', variante_id: 10 }] };
    const solicitud = { ...enTransito, id: 81, folio: 'TRA-81', estado: 'solicitado', lineas: [linea] } as Traspaso;
    historial = [solicitud];
    const fixture = await montarFixture();
    const c = fixture.componentInstance;
    expect(c.avanceLinea(solicitud, linea)).toEqual({ van: 3, de: 8, kg: 57.1, pct: 38, completo: false });
    const el = (fixture.nativeElement as HTMLElement).querySelector('.avance-linea')!;
    expect(el.classList.contains('completo')).toBe(false);
    expect(el.textContent!.replace(/\s+/g, ' ')).toContain('3 de 8 paquetes · 57.1 kg');
    expect(el.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('3');
  });

  it('en camino: los que salieron; completa va en verde', async () => {
    historial = [enTransito];
    const fixture = await montarFixture();
    const c = fixture.componentInstance;
    const a = c.avanceLinea(enTransito, enTransito.lineas[0])!;
    expect(a.completo).toBe(true);
    expect(a.van).toBe(a.de);
    const el = (fixture.nativeElement as HTMLElement).querySelector('.avance-linea')!;
    expect(el.classList.contains('completo')).toBe(true);
  });

  it('quien solo es de la MATRIZ surte: manda a cualquier tienda y no pide a ciegas', async () => {
    todasLasTiendas = false;
    almacenesActuales = [
      { ...almacenes[0], mio: true },
      { ...almacenes[1], mio: false },
    ] as Almacen[];
    const c = await montar();
    expect(c.origen).toBe(1);
    expect(c.aCiegas()).toBe(false);
    expect(c.destinos().map((a) => a.id)).toEqual([2]);
    expect(c.destino).toBe(2);
  });

  it('quien es de una sola tienda pide A CIEGAS y no surte lo de la matriz', async () => {
    todasLasTiendas = false;
    almacenesActuales = [
      { ...almacenes[0], mio: false },
      { ...almacenes[1], mio: true },
    ] as Almacen[];
    historial = [{ ...enTransito, id: 80, folio: 'TRA-80', estado: 'solicitado', almacen_origen_id: 1, almacen_destino_id: 2 }];
    // Pide con autorización (2026-10-26: sin poder pedir, la solicitud ya no se ofrece).
    permisos = ['ver:surtir', 'hacer:enviar_traspaso', 'pedir:surtir_sucursal'];
    const fixture = await montarFixture();
    const c = fixture.componentInstance;

    expect(c.origen).toBe(1);
    expect(c.aCiegas()).toBe(true);
    // Solo pide para SU tienda.
    expect(c.destinos().map((a) => a.id)).toEqual([2]);

    c.agregar(paquete);
    c.cambiarPaquetes(c.lineas()[0], 2);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    // No pregunta cuánto hay allá, ni lo dice, ni lo detiene.
    expect(pidioEquivalencia).toBe(false);
    expect(el.textContent).not.toContain('Hay libre');
    expect(c.hayInsuficientes()).toBe(false);
    // Los kilos van con el peso del catálogo.
    expect(c.kgAprox(c.lineas()[0])).toBe(38.022);
    expect(el.textContent).toContain('te mandan los que tengan');

    // La solicitud que espera a la matriz no la surte ella.
    const botones = [...el.querySelectorAll('.traspaso-acciones button')].map((b) => b.textContent!.trim());
    expect(botones).not.toContain('Enviar');
    expect(botones).toContain('Cancelar');
  });

  it('LOS PDF (2026-10-20): bajan solos al enviar y al recibir', async () => {
    const c = await montar();
    c.alEnviar({ id: 77, folio: 'TRA-77', estado: 'en_transito', lineas: [] });
    expect(pdfs).toEqual(['77-envio']);
    expect(c.mensaje()).toContain('Se bajó el PDF del envío');

    c.abrirRecepcion(enTransito);
    c.confirmarRecepcion();
    expect(pdfs).toEqual(['77-envio', '77-recepcion']);
    expect(c.mensaje()).toContain('Se bajó el PDF de la recepción');
  });

  it('LOS PDF: en camino se saca el del envío; recibido, los dos; sin enviar, ninguno', async () => {
    const recibidoT: Traspaso = { ...enTransito, id: 78, folio: 'TRA-78', estado: 'recibido', enviado_en: '2026-10-20 10:00:00', recibido_en: '2026-10-20 12:00:00' };
    // Cancelado en camino: ya regresó al origen, no tiene PDF.
    const canceladoT: Traspaso = { ...enTransito, id: 79, folio: 'TRA-79', estado: 'cancelado', enviado_en: '2026-10-20 09:00:00' };
    historial = [{ ...enTransito, enviado_en: '2026-10-20 10:00:00' }, recibidoT, canceladoT];
    const fixture = await montarFixture();
    const el: HTMLElement = fixture.nativeElement;
    const botones = (texto: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent?.trim() === texto);
    expect(botones('PDF del envío').length).toBe(1);
    // En Traspasos cerrados: el recibido trae los dos; el cancelado, ninguno.
    expect(botones('Envío').length).toBe(1);
    expect(botones('Recepción').length).toBe(1);

    botones('Recepción')[0].click();
    botones('PDF del envío')[0].click();
    expect(pdfs).toEqual(['78-recepcion', '77-envio']);
  });

  it('enseña los pedidos con autorización: esperando, autorizado por menos y rechazado (2026-10-20)', async () => {
    const base = {
      interrumpida: false, origen: 'Matriz', destino: 'Moroleón', notas: null, solicitante: 'Carlos',
      solicitado_en: '2026-10-20 09:00:00', autorizador: null, resuelto_en: null, motivo: null, nota_aprobacion: null,
      ultimo_error: null, traspaso: null, es_mia: false, puedo_autorizar: false,
    };
    solicitudesActuales = [
      { ...base, id: 1, estado: 'pendiente', lineas: [{ hilo: 'BLACK 2/30', unidad: 'paquetes', pedido: 20 }], es_mia: true, puedo_autorizar: true },
      { ...base, id: 2, estado: 'aprobada', lineas: [{ hilo: 'OPTIK 2/30', unidad: 'paquetes', pedido: 5 }], autorizador: 'Antonio',
        nota_aprobacion: 'Autorizó menos de lo pedido: OPTIK 2/30: 3 de 5 paquetes.', traspaso: { id: 70, folio: 'TRA-1-ABCD', estado: 'en_transito' } },
      { ...base, id: 3, estado: 'rechazada', lineas: [{ hilo: 'MARINO 2/30', unidad: 'paquetes', pedido: 2 }], autorizador: 'Antonio', motivo: 'Ya llevan' },
    ] as SolicitudTraspaso[];
    retiradas = [];
    const f = await montarFixture();
    const t = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(t).toContain('Pedidos con autorización');
    expect(t).toContain('Esperando autorización');
    expect(t).toContain('Autorizar o rechazar');
    expect(t).toContain('Autorizado por menos');
    expect(t).toContain('3 de 5 paquetes');
    expect(t).toContain('en camino');
    expect(t).toContain('Rechazado');
    expect(t).toContain('Ya llevan');
    f.componentInstance.retirarSolicitud(solicitudesActuales[0]);
    expect(retiradas).toEqual([1]);
    solicitudesActuales = [];
  });
});
