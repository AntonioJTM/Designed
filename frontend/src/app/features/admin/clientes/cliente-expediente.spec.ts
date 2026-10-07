import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ClienteExpediente } from './cliente-expediente';
import { ClientesService } from '../../../core/services/clientes.service';
import { VentasService } from '../../../core/services/ventas.service';
import { CatalogoService } from '../../../core/services/catalogo.service';
import { AuthService } from '../../../core/services/auth.service';
import { Expediente } from '../../../core/models/clientes.models';

/**
 * Lo que importa del expediente:
 *   · corregir la deuda solo se OFRECE con su permiso (el servidor también lo exige);
 *   · el folio de una compra lleva al pedido solo si el puesto ve Pedidos;
 *   · `?ver=deuda` abre directo esa mirada (así llegan las pestañas de Clientes);
 *   · lo cancelado no se presenta como pagado;
 *   · "Ver las N compras" pide TODAS al servidor, no se queda con las 20.
 */
describe('ClienteExpediente', () => {
  function expediente(): Expediente {
    return {
      id: 7, nombre: 'Tejidos Doña Chela', nombre_comercial: 'Doña Chela', telefono: '445 123 4567',
      tipo_cliente: 'Mayoreo', cliente_desde: '2019-03-01', creado_en: '2026-09-01 10:00:00',
      limite_credito: '40000.00', activo: 1, saldo: '20328.00', cargos: '30000.00', abonos: '9672.00',
      credito_disponible: '19672.00', ultimo_abono: '2026-09-18 12:00:00',
      estadisticas: {
        num_pedidos: 47, total_comprado: '250000.00', ticket_promedio: '5319.15', kilos: '900.500',
        primera_compra: '2019-03-02 10:00:00', ultima_compra: '2026-09-08 11:00:00',
        pedidos_mostrador: 47, pedidos_linea: 0, num_devueltos: 1, total_devuelto: '1200.00',
      },
      colores_mas_comprados: [
        { producto_id: 1, color: 'MARINO OSCURO', calibre: '1/30', material: 'ACRILAN', linea: 'Turco', kilos: '62.000', importe: '9000.00', veces: 6 },
        { producto_id: 2, color: 'MARINO OSCURO', calibre: '2/30', material: 'ACRILAN', linea: 'Turco', kilos: '41.000', importe: '6000.00', veces: 4 },
      ],
      pedidos: [
        { id: 90, numero_pedido: 'POS-A1F3', canal: 'punto_venta', estado: 'pendiente', subtotal: '6000', descuento: '0',
          impuestos: '410', costo_envio: '0', total: '6410.00', creado_en: '2026-09-08 11:00:00', num_lineas: 2,
          kilos: '22.400', hilos: [{ producto_id: 1, hilo: 'MARINO OSCURO 1/30', kg: '22.400' }],
          pagado_con: [], a_credito: '6410.00' },
        { id: 80, numero_pedido: 'POS-77C2', canal: 'punto_venta', estado: 'cancelado', subtotal: '5000', descuento: '0',
          impuestos: '0', costo_envio: '0', total: '5000.00', creado_en: '2026-08-28 11:00:00', num_lineas: 1,
          kilos: '18.900', hilos: [], pagado_con: [{ metodo: 'Efectivo', monto: '5000.00' }], a_credito: '0.00' },
      ],
      total_pedidos: 47,
      credito_movimientos: [
        { id: 1, tipo: 'abono', monto: '8000.00', creado_en: '2026-09-18 12:00:00', metodo_pago: 'Efectivo' },
        { id: 2, tipo: 'ajuste', monto: '-500.00', creado_en: '2026-09-10 12:00:00', notas: 'Se cobró doble' },
      ],
      total_movimientos: 2,
      habitos: {
        ritmo: 8, primera: '2019-03-02', ultima: '2026-09-08', dias_sin_venir: 24, veces_su_ritmo: 3,
        dia_de_costumbre: 'sábado', hora_de_costumbre: 11,
        visitas_90: [{ dia: '2026-09-08', hace: 24 }],
        por_dia_semana: [{ dia: 'sábado', n: 30 }], por_mes: [], por_hora: [{ hora: 11, n: 30 }],
        ultimos_90: { compras: 9, total: 52900, kg: 148, kg_cono: 29.6, hilos: 5 },
        anteriores_90: { compras: 9, total: 55100 },
        ticket_tienda_90: 2563,
      },
    } as unknown as Expediente;
  }

  let permisos: Set<string>;
  let ver: string | null;
  let pedidasTodas: boolean[];

  const clientesFalso = {
    expediente: (_id: number, todas = false) => {
      pedidasTodas.push(todas);
      return of(expediente());
    },
  };

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [ClienteExpediente],
      providers: [
        provideRouter([]),
        { provide: ClientesService, useValue: clientesFalso },
        { provide: VentasService, useValue: { metodosPago: () => of([]), cajas: () => of([]) } },
        { provide: CatalogoService, useValue: { tiposCliente: () => of([]) } },
        { provide: AuthService, useValue: { puede: (k: string) => permisos.has(k) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => '7' }, queryParamMap: { get: () => ver } } },
        },
      ],
    }).compileComponents();
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
    const fixture = TestBed.createComponent(ClienteExpediente);
    fixture.detectChanges();
    return fixture;
  }

  const textoDe = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ') ?? '';

  beforeEach(() => {
    permisos = new Set();
    ver = null;
    pedidasTodas = [];
  });
  afterEach(() => TestBed.resetTestingModule());

  it('sin el permiso no ofrece corregir la deuda; con él, sí', async () => {
    let f = await montar();
    expect(textoDe(f.nativeElement)).not.toContain('Corregir la deuda');
    TestBed.resetTestingModule();

    permisos = new Set(['hacer:corregir_deuda']);
    f = await montar();
    expect(textoDe(f.nativeElement)).toContain('Corregir la deuda');
  });

  it('el folio solo enlaza al pedido si el puesto ve Pedidos', async () => {
    let f = await montar();
    expect(f.nativeElement.querySelector('a[href="/admin/ventas/90"]')).toBeNull();
    expect(textoDe(f.nativeElement)).toContain('POS-A1F3');
    TestBed.resetTestingModule();

    permisos = new Set(['ver:pedidos']);
    f = await montar();
    expect(f.nativeElement.querySelector('a[href="/admin/ventas/90"]')).not.toBeNull();
  });

  it('Venderle solo aparece para quien ve el punto de venta', async () => {
    let f = await montar();
    expect(textoDe(f.nativeElement)).not.toContain('Venderle');
    TestBed.resetTestingModule();

    permisos = new Set(['ver:pos']);
    f = await montar();
    expect(textoDe(f.nativeElement)).toContain('Venderle');
  });

  it('?ver=deuda abre directo el estado de cuenta, con el signo correcto de cada movimiento', async () => {
    ver = 'deuda';
    const f = await montar();
    const c = f.componentInstance;
    expect(c.pestana()).toBe('deuda');
    const t = textoDe(f.nativeElement);
    expect(t).toContain('Movimientos de su cuenta');
    // El abono baja la deuda y el ajuste negativo también: nada de "+-$500".
    expect(t).toContain('−$8,000');
    expect(t).toContain('−$500');
    expect(t).not.toContain('+-');
  });

  it('dice cómo va contra su ritmo y lo cancelado no sale como pagado', async () => {
    const f = await montar();
    const t = textoDe(f.nativeElement);
    expect(t).toContain('Se está enfriando');
    expect(t).toContain('Le dicen Doña Chela');
    expect(t).toContain('Cancelado');
    expect(t).toContain('A crédito');
  });

  it('"Ver las N compras" pide todas al servidor', async () => {
    const f = await montar();
    expect(pedidasTodas).toEqual([false]);
    f.componentInstance.verTodasLasCompras();
    expect(pedidasTodas).toEqual([false, true]);
    expect(f.componentInstance.pestana()).toBe('gasto');
  });
});
