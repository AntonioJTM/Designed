import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { HiloModal } from './hilo-modal';
import { BultoLote, DetalleHilo, InventarioService } from '../../../core/services/inventario.service';

/**
 * El detalle de un hilo (2026-10-06):
 *   · abre con el nombre puesto y trae dónde está y sus lotes;
 *   · avisa cuando los paquetes ubicados en un almacén no cuadran con su saldo;
 *   · al tocar un lote trae sus paquetes y abre en "En paquete" (o en "Todos" si
 *     ya no le queda ninguno), con filtro por estado, almacén y código.
 */
describe('HiloModal', () => {
  const lote = (lote: string | null, disp: number, vend: number) => ({
    lote, bultos: disp + vend, kg: (disp + vend) * 19,
    disponibles: { bultos: disp, kg: disp * 19, conos: disp * 12, por_almacen: disp ? [{ almacen_id: 2, almacen: 'Bodega', bultos: disp, kg: disp * 19 }] : [] },
    vendidos: { bultos: vend, kg: vend * 19 },
    apartados: { bultos: 0, kg: 0 },
    desarmados: { bultos: 0, kg: 0, conos: 0, destare_kg: 0 },
    peso_min: 18, peso_max: 20,
    cargas: [{ remesa_id: 1, folio: 'REM-1-AAAA', fecha_ingreso: '2026-09-14', proveedor: 'Canan Tekstil', bultos: disp + vend }],
  });
  const detalle: DetalleHilo = {
    hilo: { producto_id: 187, producto: 'ROJO', calibre: '1/30', material: 'ACRILAN', linea: 'Turco' },
    presentaciones: [
      {
        variante_id: 285, sku: 'ROJO', tipo_presentacion: 'paquete', peso_kg: '18.990', total: 324.05,
        existencias: [
          { almacen_id: 2, almacen: 'Bodega', cantidad: 324.05, reservada: 0, bultos: 25, kg_en_bultos: 480.04 },
        ],
      },
      {
        variante_id: 303, sku: 'ROJO-CONO', tipo_presentacion: 'cono', peso_kg: '1.583', total: 13.077,
        existencias: [{ almacen_id: 1, almacen: 'Tienda', cantidad: 13.077, reservada: 0, bultos: null, kg_en_bultos: null }],
      },
    ],
    lotes: [lote('0368427', 3, 0), lote('0157808', 0, 2)],
    resumen: { lotes: 1, lotes_total: 2, bultos_disponibles: 3, kg_en_bultos: 57, sin_ubicar: 0 },
  };
  const bulto = (id: number, estado: BultoLote['estado'], almacen_id: number): BultoLote => ({
    id, codigo: `C-${id}`, peso_kg: 19, conos: 12, estado, almacen_id, almacen: almacen_id === 2 ? 'Bodega' : 'Tienda',
    sku: 'ROJO', carga_folio: 'REM-1-AAAA', fecha_ingreso: '2026-09-14',
    consumido_en: estado === 'disponible' ? null : '2026-09-20 10:00:00',
    consumido_tipo: estado === 'vendido' ? 'pedido' : estado === 'desarmado' ? 'conversion' : null,
    consumido_id: null, pedido_folio: estado === 'vendido' ? 'POS-1-BBBB' : null, conos_generados: null,
  });
  const bultos = [bulto(1, 'disponible', 2), bulto(2, 'disponible', 2), bulto(3, 'disponible', 2), bulto(4, 'vendido', 1)];

  let pedidoLote: string | null | undefined;

  async function montar(almacenId: number | null = null) {
    pedidoLote = undefined;
    await TestBed.configureTestingModule({
      imports: [HiloModal],
      providers: [
        {
          provide: InventarioService,
          useValue: {
            detalleHilo: () => of(detalle),
            bultosDeLote: (_id: number, l: string | null) => {
              pedidoLote = l;
              return of(bultos);
            },
          },
        },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(HiloModal);
    f.componentRef.setInput('hilo', { producto_id: 187, producto: 'ROJO', calibre: '1/30' });
    f.componentRef.setInput('almacenId', almacenId);
    f.detectChanges();
    return f;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('trae dónde está y sus lotes, y avisa si los paquetes no cuadran con el saldo', async () => {
    const f = await montar();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('h2')?.textContent).toContain('ROJO 1/30');
    expect(f.componentInstance.kgTotal()).toBe(337.127);
    expect(el.textContent).toContain('no cuadra con lo que hay');
    expect(el.querySelectorAll('table.lotes tbody tr').length).toBe(2);
  });

  it('al tocar un lote trae sus paquetes y abre en "En paquete"', async () => {
    const f = await montar();
    const c = f.componentInstance;
    c.abrirLote(detalle.lotes[0]);
    f.detectChanges();
    expect(pedidoLote).toBe('0368427');
    expect(c.estado()).toBe('disponible');
    expect(c.bultosVistos().length).toBe(3);
    expect(c.conteo()).toEqual({ disponible: 3, apartado: 0, desarmado: 0, vendido: 1, todos: 4 });
    c.estado.set('vendido');
    expect(c.bultosVistos().map((b) => b.codigo)).toEqual(['C-4']);
    c.estado.set('todos');
    c.buscar.set('c-2');
    expect(c.bultosVistos().map((b) => b.codigo)).toEqual(['C-2']);
    c.volver();
    expect(c.loteSel()).toBeNull();
  });

  it('un lote que ya no tiene paquetes abre con toda su historia', async () => {
    const f = await montar();
    f.componentInstance.abrirLote(detalle.lotes[1]);
    expect(f.componentInstance.estado()).toBe('todos');
  });

  it('el almacén de la tabla filtra los paquetes, y se suelta si ahí no hay del lote', async () => {
    const f = await montar(2);
    const c = f.componentInstance;
    c.abrirLote(detalle.lotes[0]);
    c.estado.set('todos');
    expect(c.bultosVistos().length).toBe(3);
    TestBed.resetTestingModule();

    const g = await montar(7);
    g.componentInstance.abrirLote(detalle.lotes[0]);
    expect(g.componentInstance.almacenFiltro()).toBe('');
  });
});
