import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { VistaDejaron } from './vista-dejaron';
import { AuthService } from '../../../../core/services/auth.service';
import { ClientesEnfriados } from '../../../../core/models/analisis.models';

/**
 * Dejaron de venir: lo que importa es que diga QUIÉNES (los mismos del aviso de
 * la campana), con su teléfono para llamarles, ordenados por lo que compraban,
 * y que el corte de días se pueda mover.
 */
describe('VistaDejaron', () => {
  const datos: ClientesEnfriados = {
    dias: 60, min_compras: 2, num_clientes: 2, venta_en_riesgo: 15000,
    clientes: [
      { cliente_id: 1, nombre: 'José Luis Ortega', nombre_comercial: 'Don Pepe', telefono: '771 123 4567',
        num_compras: 4, total_comprado: '5000.00', primera_compra: '2026-05-01', ultima_compra: '2026-07-23 10:00:00',
        dias_sin_venir: 72, cada_cuantos_dias: 8, veces_su_ritmo: 9, saldo: '0' },
      { cliente_id: 2, nombre: 'Salvador Ayala', nombre_comercial: 'Chava', telefono: '771 999 0000',
        num_compras: 6, total_comprado: '10000.00', primera_compra: '2026-04-01', ultima_compra: '2026-07-30 10:00:00',
        dias_sin_venir: 65, cada_cuantos_dias: 6, veces_su_ritmo: 10.8, saldo: '1200.00' },
    ],
  };

  async function montar(permisos: string[]) {
    await TestBed.configureTestingModule({
      imports: [VistaDejaron],
      providers: [provideRouter([]), { provide: AuthService, useValue: { puede: (p: string) => permisos.includes(p) } }],
    }).compileComponents();
    const f = TestBed.createComponent(VistaDejaron);
    f.componentRef.setInput('datos', datos);
    f.componentRef.setInput('sinVenir', 60);
    f.detectChanges();
    return f;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('dice quiénes son, con su teléfono, y primero el que más compraba', async () => {
    const f = await montar(['ver:clientes', 'ver:pos']);
    const el = f.nativeElement as HTMLElement;
    const filas = [...el.querySelectorAll('table.dejaron tbody tr')];
    expect(filas.length).toBe(2);
    expect(filas[0].textContent).toContain('Salvador Ayala');
    expect(filas[0].textContent).toContain('le dicen Chava');
    expect(filas[0].textContent).toContain('771 999 0000');
    expect(filas[0].textContent).toContain('10.8× su ritmo');
    expect(filas[0].textContent).toContain('$1,200.00');
    expect(el.textContent).toContain('Son los mismos del aviso de la campana');
    expect(f.componentInstance.kpis()[0].valor).toBe('2');
    // "Venderle" abre el punto de venta con el cliente ya elegido.
    expect(el.querySelector('a[href="/admin/pos?cliente=2"]')).not.toBeNull();
  });

  it('"Venderle" solo sale a quien puede abrir el punto de venta', async () => {
    const f = await montar(['ver:clientes']);
    expect((f.nativeElement as HTMLElement).querySelector('a[href^="/admin/pos"]')).toBeNull();
  });

  it('el corte de días se puede mover', async () => {
    const f = await montar(['ver:clientes']);
    const elegidos: number[] = [];
    f.componentInstance.cambiarCorte.subscribe((d) => elegidos.push(d));
    const select = (f.nativeElement as HTMLElement).querySelector('select[name="sin_venir"]') as HTMLSelectElement;
    select.value = '90';
    select.dispatchEvent(new Event('change'));
    expect(elegidos).toEqual([90]);
  });
});
