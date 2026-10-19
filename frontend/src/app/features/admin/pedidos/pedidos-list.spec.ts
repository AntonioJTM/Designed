import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { PedidosList } from './pedidos-list';
import { VentasService } from '../../../core/services/ventas.service';
import { RedisenoService } from '../../../core/services/rediseno.service';
import { Pedido } from '../../../core/models/ventas.models';
import { hoyLocal } from '../../../shared/fecha.pipe';

/**
 * LAS NOTAS DE VENTA (2026-10-16): clave, cliente con su número, estatus
 * (emitida, cancelada, devolución o devolución parcial), cuándo se elaboró, si
 * fue de contado, de qué almacén salió, quién la elaboró y el importe; y los
 * filtros por cliente, estatus y periodo (hoy, 7 días, este mes o todo).
 */
describe('PedidosList (notas de venta)', () => {
  let pedidos: Pedido[];
  let pedido: Record<string, unknown> | null;

  const venta = (extra: Partial<Pedido>): Pedido => ({
    id: 1, numero_pedido: 'POS-1792036260049-468D', canal: 'punto_venta', estado: 'pagado', total: '2726.00',
    creado_en: `${hoyLocal()} 21:51:00`, cliente: 'INES HERNANDEZ', cliente_codigo: 'C-0001', usuario: 'Yessica',
    almacen: 'SUCURSAL MOROLEON', contado: true, situacion: 'emitida', ...extra,
  } as Pedido);

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [PedidosList],
      providers: [
        provideRouter([]),
        {
          provide: VentasService,
          useValue: {
            listarPedidos: (f: Record<string, unknown>) => { pedido = f; return of({ items: pedidos, total: pedidos.length, page: 1, limit: 50, paginas: 1 }); },
            cajas: () => of([]),
          },
        },
        { provide: RedisenoService, useValue: { resumenPedidos: () => of({ hoy: { ventas: 0, total: 0 }, semana: { ventas: 0, total: 0 }, por_cobrar: { ventas: 0, total: 0 }, canceladas_mes: { ventas: 0, total: 0 } }) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(PedidosList);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => { pedidos = []; pedido = null; });
  afterEach(() => TestBed.resetTestingModule());

  it('cada renglón: clave, cliente con su número, estatus, hora, contado, almacén, quién y el importe', async () => {
    pedidos = [venta({})];
    const fixture = await montar();
    const tr = (fixture.nativeElement as HTMLElement).querySelector('tbody tr')!;
    const celdas = [...tr.querySelectorAll('td')].map((td) => td.textContent!.replace(/\s+/g, ' ').trim());
    expect(celdas[0]).toBe('POS-468D');
    expect(celdas[1]).toBe('INES HERNANDEZ C-0001');
    expect(celdas[2]).toBe('Emitida');
    expect(celdas[3]).toBe('hoy 21:51');
    expect(celdas[4]).toBe('Sí');
    expect(celdas[5]).toBe('SUCURSAL MOROLEON');
    expect(celdas[6]).toBe('Yessica');
    expect(celdas[7]).toBe('$2,726.00');
  });

  it('el estatus: emitida, cancelada, devolución y devolución parcial, con su color', async () => {
    const c = (await montar()).componentInstance;
    expect(c.situacionDe(venta({ situacion: 'emitida' }))).toEqual({ texto: 'Emitida', tono: 'azul' });
    expect(c.situacionDe(venta({ situacion: 'cancelada' }))).toEqual({ texto: 'Cancelada', tono: 'rojo' });
    expect(c.situacionDe(venta({ situacion: 'devolucion' }))).toEqual({ texto: 'Devolución', tono: 'ambar' });
    expect(c.situacionDe(venta({ situacion: 'devolucion_parcial' }))).toEqual({ texto: 'Devolución parcial', tono: 'ambar' });
  });

  it('de contado "No" dice por qué y cuánto falta (o que ya se liquidó)', async () => {
    const c = (await montar()).componentInstance;
    expect(c.contadoDe(venta({ contado: false, fiada: true, falta: 1200 } as Partial<Pedido>))).toEqual({ si: false, porque: 'a crédito', falta: 1200 });
    expect(c.contadoDe(venta({ contado: false, nota_pendiente: 1, falta: 0 } as Partial<Pedido>))).toEqual({ si: false, porque: 'pendiente de pago', falta: 0 });
    // Una cancelada no debe nada: solo dice por qué no fue de contado.
    expect(c.contadoDe(venta({ contado: false, fiada: true, estado: 'cancelado', falta: 0 } as Partial<Pedido>)).falta).toBeNull();
  });

  it('en la columna: "a crédito · falta $1,200.00" en ámbar, o "a crédito · ya liquidada"', async () => {
    pedidos = [
      venta({ id: 1, contado: false, fiada: true, falta: 1200 } as Partial<Pedido>),
      venta({ id: 2, contado: false, fiada: true, falta: 0 } as Partial<Pedido>),
    ];
    const fixture = await montar();
    const filas = [...(fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')];
    const contado = (tr: Element) => tr.querySelectorAll('td')[4];
    expect(contado(filas[0]).textContent!.replace(/\s+/g, ' ').trim()).toBe('No a crédito · falta $1,200.00');
    expect(contado(filas[0]).querySelector('.debe')).not.toBeNull();
    expect(contado(filas[1]).textContent!.replace(/\s+/g, ' ').trim()).toBe('No a crédito · ya liquidada');
  });

  it('filtra por estatus y por periodo: hoy, 7 días, este mes o todo', async () => {
    const c = (await montar()).componentInstance;
    c.situacion = 'con_devolucion';
    c.buscar();
    expect(pedido!['situacion']).toBe('con_devolucion');

    c.ponerPeriodo('hoy');
    expect(pedido!['desde']).toBe(hoyLocal());
    expect(pedido!['hasta']).toBe(hoyLocal());
    expect(c.periodo()).toBe('hoy');
    expect(c.tituloLista()).toBe('Ventas de hoy');

    c.ponerPeriodo('mes');
    expect(pedido!['desde']).toBe(hoyLocal().slice(0, 8) + '01');
    expect(c.periodo()).toBe('mes');

    c.ponerPeriodo('todo');
    expect(pedido!['desde']).toBeUndefined();
    expect(c.tituloLista()).toBe('Todas las ventas');
  });
});
