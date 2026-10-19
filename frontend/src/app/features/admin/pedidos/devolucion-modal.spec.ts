import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DevolucionModal } from './devolucion-modal';
import { VentasService } from '../../../core/services/ventas.service';
import { ClientesService } from '../../../core/services/clientes.service';
import { DevolverInput, PreviaDevolucion } from '../../../core/models/ventas.models';

/**
 * La ventana de devolución con el caso del usuario (2026-10-13): "me llevé 3
 * paquetes de 12 conos y regreso 2 paquetes intactos y del otro solo 2 conos".
 *   · los paquetes cerrados se escanean: solo los de ESTA nota, una vez cada uno;
 *   · lo suelto se pesa y entra como conos;
 *   · a favor = kilos × el precio con que se vendió ($200): (18.5 + 19 + 3.2) × 200 = $8,140;
 *   · si debe algo, se elige si se descuenta; la venta sin cliente pide a quién.
 */
describe('DevolucionModal', () => {
  function previaBase(): PreviaDevolucion {
    return {
      pedido_id: 7, numero_pedido: 'POS-1-ABCD', estado: 'pagado', almacen_id: 1, almacen: 'Tienda Principal',
      cliente_id: 20, cliente: 'Doña Chela', se_puede: true, saldo_favor: 0,
      deuda: { credito: 0, notas: 0, total: 0 },
      lineas: [{
        detalle_id: 11, hilo: 'ROJO 2/30', descripcion: 'ROJO 2/30 · Paquete', tipo_presentacion: 'paquete',
        cantidad: 56.3, piezas: null, devuelto: 0, disponible: 56.3, precio_kg: 200, sueltos_como: 'conos',
        bultos: [
          { codigo: 'P1', peso_kg: 18.5, lote: 'L1', devolvible: true, devuelto: false, abierto: false },
          { codigo: 'P2', peso_kg: 19, lote: 'L1', devolvible: true, devuelto: false, abierto: false },
          { codigo: 'P3', peso_kg: 18.8, lote: 'L1', devolvible: false, devuelto: false, abierto: true },
        ],
      }],
    };
  }

  let previa: PreviaDevolucion;
  let enviado: DevolverInput | null;

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [DevolucionModal],
      providers: [
        {
          provide: VentasService,
          useValue: {
            previaDevolucion: () => of(previa),
            devolver: (_id: number, body: DevolverInput) => {
              enviado = body;
              return of({ devolucion_id: 1, folio: 'DEV-1', pedido_id: 7, numero_pedido: 'POS-1-ABCD', cliente_id: 20,
                cliente: 'Doña Chela', total: 8140, kg: 40.7, aplicado_a_deuda: 0, aplicaciones: [], saldo_favor: 8140 });
            },
          },
        },
        { provide: ClientesService, useValue: { buscar: () => of([]) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(DevolucionModal);
    fixture.componentRef.setInput('pedidoId', 7);
    fixture.detectChanges();
    return { c: fixture.componentInstance, fixture };
  }

  function escanear(c: DevolucionModal, codigo: string): void {
    c.codigo = codigo;
    c.leer();
  }

  beforeEach(() => {
    previa = previaBase();
    enviado = null;
  });
  afterEach(() => TestBed.resetTestingModule());

  it('el caso del usuario: 2 paquetes cerrados y 2 conos que pesan 3.2 kg → $8,140 a favor', async () => {
    const { c } = await montar();
    const l = c.previa()!.lineas[0];
    escanear(c, 'P1');
    escanear(c, 'P2');
    c.kgSueltos[11] = 3.2;
    c.conos[11] = 2;
    expect(c.kgLinea(l)).toBe(40.7);
    expect(c.total()).toBe(8140);
    expect(c.quedaAFavor()).toBe(8140);
    expect(c.motivoNoListo()).toBeNull();

    let hecho = false;
    c.hecho.subscribe(() => (hecho = true));
    c.registrar();
    expect(enviado).toEqual({
      destino: 'favor', cliente_id: undefined, notas: undefined,
      lineas: [{ detalle_id: 11, codigos: ['P1', 'P2'], kg_sueltos: 3.2, conos: 2 }],
    });
    expect(hecho).toBe(true);
  });

  it('el resumen se anuncia una vez, cuando se deja de teclear (no en cada número)', async () => {
    const { c, fixture } = await montar();
    jasmine.clock().install();
    try {
      c.kgSueltos[11] = 3;
      c.cambio();
      c.kgSueltos[11] = 3.2;
      c.cambio();
      expect(c.anuncio()).toBe('');
      jasmine.clock().tick(1000);
      expect(c.anuncio()).toContain('3.2 kg');
      expect(c.anuncio()).toContain('$640.00.');
    expect(c.anuncio()).toContain('a favor');
      fixture.detectChanges();
      // El bloque del resumen ya no es una región viva: lo dice esta frase.
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.resumen')?.getAttribute('aria-live')).toBeNull();
      expect(el.querySelector('p.oculto[role=status]')?.textContent).toContain('a favor');
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('cada paquete que regresa es la ficha de siempre, con su botón para quitarlo', async () => {
    const { c, fixture } = await montar();
    escanear(c, 'P1');
    fixture.detectChanges();
    const boton = (fixture.nativeElement as HTMLElement).querySelector('.ficha-paquete .ficha-quitar');
    expect(boton?.getAttribute('aria-label')).toBe('Quitar el paquete P1');
    (boton as HTMLButtonElement).click();
    expect(c.codigos[11]).toEqual([]);
  });

  it('solo acepta paquetes de esta nota, una vez, y no uno que ya se bajó a conos', async () => {
    const { c } = await montar();
    escanear(c, 'OTRO');
    expect(c.error()).toContain('no salió en esta nota');
    escanear(c, 'P1');
    expect(c.error()).toBeNull();
    expect(c.ultimo()).toContain('P1');
    escanear(c, 'P1');
    expect(c.error()).toContain('ya está en la lista');
    escanear(c, 'P3');
    expect(c.error()).toContain('se bajó a conos');
    expect(c.codigos[11]).toEqual(['P1']);
  });

  it('no deja regresar más de lo que se llevó', async () => {
    const { c } = await montar();
    c.kgSueltos[11] = 60;
    expect(c.excede(c.previa()!.lineas[0])).toBe(true);
    expect(c.motivoNoListo()).toContain('a lo más regresan');
    c.registrar();
    expect(enviado).toBeNull();
  });

  it('sin nada escaneado ni pesado no se registra', async () => {
    const { c } = await montar();
    expect(c.total()).toBe(0);
    expect(c.motivoNoListo()).toContain('Escanea');
  });

  it('si debe, puede descontarlo de lo que debe: dice cuánto y cuánto le queda', async () => {
    previa = { ...previaBase(), saldo_favor: 100, deuda: { credito: 1000, notas: 2000, total: 3000 } };
    const { c } = await montar();
    escanear(c, 'P1'); // 18.5 × 200 = 3,700
    expect(c.quedaAFavor()).toBe(3800);
    c.destino = 'deuda';
    expect(c.descuentaDeOtras()).toBe(3000);
    expect(c.quedaAFavor()).toBe(800);
    c.registrar();
    expect(enviado!.destino).toBe('deuda');
  });

  it('si lo que regresa no pasa de lo que debe esta nota, no pregunta qué hacer con lo que sobra', async () => {
    previa = { ...previaBase(), debe_esta: 5000, debe_esta_tipo: 'nota', deuda: { credito: 1000, notas: 5000, total: 6000 } };
    const { c, fixture } = await montar();
    escanear(c, 'P1'); // $3,700 < $5,000
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('fieldset.destino')).toBeNull();
    expect(c.descuentaDeEsta()).toBe(3700);
  });

  it('una nota a crédito que todavía se debe: lo que regresa se descuenta de ella, sin preguntar (2026-10-14)', async () => {
    previa = { ...previaBase(), saldo_favor: 0, debe_esta: 2000, debe_esta_tipo: 'credito',
      deuda: { credito: 2000, notas: 0, total: 2000 } };
    const { c, fixture } = await montar();
    escanear(c, 'P1'); // 18.5 × 200 = 3,700
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.debe-esta')?.textContent).toContain('se descuenta de ella');
    // No debe nada más: no se pregunta qué hacer con lo que sobra.
    expect(el.querySelector('fieldset.destino')).toBeNull();
    expect(c.descuentaDeEsta()).toBe(2000);
    expect(c.quedaAFavor()).toBe(1700);
    c.registrar();
    expect(enviado!.destino).toBe('favor');
  });

  it('si además debe otras notas, lo que sobra se puede descontar de ellas', async () => {
    previa = { ...previaBase(), saldo_favor: 0, debe_esta: 1000, debe_esta_tipo: 'credito',
      deuda: { credito: 1000, notas: 500, total: 1500 } };
    const { c, fixture } = await montar();
    escanear(c, 'P1'); // $3,700: $1,000 de esta nota, sobran $2,700
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('fieldset.destino legend')?.textContent).toContain('Además debe');
    c.destino = 'deuda';
    expect(c.descuentaDeEsta()).toBe(1000);
    expect(c.descuentaDeOtras()).toBe(500);
    expect(c.quedaAFavor()).toBe(2200);
  });

  /*
   * ANTES → DESPUÉS (2026-10-16): la tarjeta de abajo dice, en vivo, cómo se
   * reparte lo que regresa: primero baja lo que debe esta nota, luego lo demás
   * (si así se eligió) y lo que sobre le queda a favor. No sale dinero.
   */
  it('el reparto antes → después: baja esta nota, lo demás que debe y lo que le queda a favor', async () => {
    previa = { ...previaBase(), saldo_favor: 300, debe_esta: 1000, debe_esta_tipo: 'credito',
      deuda: { credito: 1000, notas: 500, total: 1500 } };
    const { c, fixture } = await montar();
    escanear(c, 'P1'); // $3,700: $1,000 a esta nota y sobran $2,700
    c.destino = 'deuda';
    expect(c.reparto()).toEqual([
      { que: 'Lo que debe esta nota', antes: 1000, despues: 0 },
      { que: 'Lo demás que debe', antes: 500, despues: 0 },
      { que: 'Su saldo a favor', antes: 300, despues: 2500 },
    ]);
    expect(c.cambioReparto({ antes: 1000, despues: 0 })).toBe('−$1,000.00');
    expect(c.cambioReparto({ antes: 300, despues: 2500 })).toBe('+$2,200.00');

    // Dejarlo a favor: lo demás que debe no se mueve.
    c.destino = 'favor';
    fixture.detectChanges();
    const filas = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.reparto-tabla tbody tr')]
      .map((tr) => tr.textContent!.replace(/\s+/g, ' ').trim());
    expect(filas[1]).toContain('sin cambio');
    expect(filas[2]).toContain('$3,000.00');
    expect((fixture.nativeElement as HTMLElement).querySelector('.reparto')?.classList.contains('card')).toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelector('.reparto-nota')?.textContent).toContain('No sale dinero');
  });

  it('sin deudas solo enseña su saldo a favor, antes y después', async () => {
    const { c } = await montar();
    escanear(c, 'P2'); // 19 × 200 = 3,800
    expect(c.reparto()).toEqual([{ que: 'Su saldo a favor', antes: 0, despues: 3800 }]);
  });

  it('la venta sin cliente pide a quién se le pone el saldo', async () => {
    previa = { ...previaBase(), cliente_id: null, cliente: null };
    const { c } = await montar();
    escanear(c, 'P1');
    expect(c.motivoNoListo()).toContain('a quién');
    c.elegir({ id: 30, nombre: 'Don Juan', limite_credito: 0, saldo: 0, credito_disponible: 0 });
    expect(c.motivoNoListo()).toBeNull();
    c.registrar();
    expect(enviado!.cliente_id).toBe(30);
  });
});
