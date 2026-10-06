import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DatosCargaModal } from './datos-carga-modal';
import { InventarioService, Remesa } from '../../../core/services/inventario.service';
import { AuthService } from '../../../core/services/auth.service';

/**
 * Corregir los datos de una carga ya hecha (2026-10-06):
 *   · abre con lo que ya tiene la carga;
 *   · en una carga de lista propone aplicarlo a toda la lista;
 *   · el costo solo viaja si quien guarda lo ve (administración y contabilidad).
 */
describe('DatosCargaModal', () => {
  const carga = {
    id: 9, folio: 'REM-9', producto: 'CAMEL', calibre: '2/30', sku: 'CAMEL-2-30', almacen: 'Bodega',
    num_bultos: 20, kg_total: '380.000', creado_en: '2026-10-03 11:14:00',
    proveedor_id: 3, factura: 'F-1', pedimento: null, contenedor: 'MSCU1234567', fecha_ingreso: '2026-10-02',
    costo_kg: '90.00', lista: 'LST-1', cargas_en_lista: 3,
  } as unknown as Remesa;

  let enviado: Record<string, unknown> | null = null;
  let permisos: string[] | null = null;

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [DatosCargaModal],
      providers: [
        {
          provide: InventarioService,
          useValue: {
            proveedores: () => of([{ id: 3, nombre: 'Canan Tekstil' }]),
            editarDatosCarga: (_id: number, b: Record<string, unknown>) => {
              enviado = b;
              return of(carga);
            },
          },
        },
        { provide: AuthService, useValue: { puede: (p: string) => permisos === null || permisos.includes(p) } },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(DatosCargaModal);
    f.componentRef.setInput('carga', carga);
    f.detectChanges();
    return f.componentInstance;
  }

  beforeEach(() => {
    enviado = null;
    permisos = null;
  });
  afterEach(() => TestBed.resetTestingModule());

  it('abre con lo que ya tiene la carga y propone aplicarlo a toda su lista', async () => {
    const c = await montar();
    expect(c.datos().factura).toBe('F-1');
    expect(c.datos().costo_kg).toBe(90);
    expect(c.todaLaLista).toBe(true);
    c.datos.update((d) => ({ ...d, pedimento: '26 07 3456 6001234' }));
    c.guardar();
    expect(enviado).toEqual(jasmine.objectContaining({
      proveedor_id: 3, factura: 'F-1', pedimento: '26 07 3456 6001234', costo_kg: 90, toda_la_lista: true,
    }));
  });

  it('quien no ve costos no manda el costo', async () => {
    permisos = ['ver:remesa'];
    const c = await montar();
    c.guardar();
    expect(enviado && 'costo_kg' in enviado).toBe(false);
  });
});
