import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CajaPantalla } from './caja';
import { VentasService } from '../../../core/services/ventas.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { AuthService } from '../../../core/services/auth.service';
import { Caja, SesionCaja } from '../../../core/models/ventas.models';

/**
 * Lo que importa de Caja:
 *   · abre la MISMA caja que el punto de venta (la clave `caja_sel`);
 *   · las cifras del turno salen de sus movimientos: un abono no es una venta,
 *     y la devolución y el retiro son lo que "salió del cajón";
 *   · sacar o meter efectivo se esconde sin su permiso.
 */
describe('CajaPantalla', () => {
  const cajas: Caja[] = [
    { id: 6, almacen_id: 1, almacen: 'Tienda principal', nombre: 'Caja A', activo: 1, turno_id: null },
    { id: 7, almacen_id: 9, almacen: 'Sucursal', nombre: 'Caja B', activo: 1, turno_id: 246, turno_usuario: 'Lupita' },
  ];
  const sesion: SesionCaja = {
    id: 246, caja_id: 7, caja: 'Caja B', usuario: 'Lupita', usuario_id: 3, estado: 'abierta',
    monto_inicial: '500.00', fecha_apertura: '2026-10-02 09:02:00', esperado_actual: 1640,
    movimientos: [
      { id: 1, tipo: 'venta', monto: '1000.00', referencia_id: 10, motivo: 'Venta POS-1', creado_en: '2026-10-02 10:00:00', numero_pedido: 'POS-1', cliente: 'Doña Mari' },
      { id: 2, tipo: 'ingreso', monto: '300.00', referencia_id: 55, motivo: 'Abono de Doña Mari', creado_en: '2026-10-02 11:00:00' },
      { id: 3, tipo: 'retiro', monto: '100.00', motivo: 'Depósito al banco', creado_en: '2026-10-02 12:00:00' },
      { id: 4, tipo: 'devolucion', monto: '60.00', referencia_id: 10, motivo: 'Cancelación de POS-1', creado_en: '2026-10-02 13:00:00' },
    ],
  };
  const pedidas: number[] = [];
  const ventasFalso = {
    cajas: () => of(cajas),
    sesionAbierta: (id: number) => {
      pedidas.push(id);
      return of(id === 7 ? sesion : null);
    },
  };

  async function montar(permisos: string[]) {
    await TestBed.configureTestingModule({
      imports: [CajaPantalla],
      providers: [
        provideRouter([]),
        { provide: VentasService, useValue: ventasFalso },
        { provide: InventarioService, useValue: { almacenes: () => of([]) } },
        { provide: AuthService, useValue: { sesion: () => ({}), puede: (p: string) => permisos.includes(p) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CajaPantalla);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    pedidas.length = 0;
    try { localStorage.setItem('caja_sel', '7'); } catch { /* sin almacenamiento */ }
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    try { localStorage.removeItem('caja_sel'); } catch { /* sin almacenamiento */ }
  });

  it('abre la caja que dejó elegida el punto de venta', async () => {
    const c = (await montar([])).componentInstance;
    expect(c.cajaSel()).toBe(7);
    expect(pedidas).toEqual([7]);
    expect(c.abierta()).toBeTrue();
  });

  it('las cifras salen de los movimientos: el abono no se cuenta como venta', async () => {
    const c = (await montar([])).componentInstance;
    const [haber, ventas, abonos, salio] = c.kpis();
    expect(haber.valor).toContain('1,640');
    expect(ventas.valor).toContain('1,000');
    expect(ventas.pie).toBe('1 venta');
    expect(abonos.valor).toContain('300');
    expect(salio.valor).toContain('160');
    // Lo más reciente primero, y la venta dice su folio y su cliente.
    expect(c.movimientos()[0].tipo).toBe('Devolución');
    expect(c.movimientos().at(-1)!.detalle).toBe('POS-1 · Doña Mari');
  });

  it('sin permiso no ofrece sacar o meter efectivo', async () => {
    const sin = await montar([]);
    expect(sin.nativeElement.textContent).not.toContain('Sacar o meter efectivo');
    TestBed.resetTestingModule();
    const con = await montar(['hacer:mover_efectivo']);
    expect(con.nativeElement.textContent).toContain('Sacar o meter efectivo');
  });
});
