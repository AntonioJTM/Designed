import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CuentaDeposito } from './cuenta-deposito';
import { TransferenciasService } from '../core/services/transferencias.service';
import { transferenciasFalso } from '../core/services/transferencias.falso';

@Component({
  imports: [CuentaDeposito],
  template: `<app-cuenta-deposito [(cuenta)]="cuenta" />`,
})
class Anfitrion {
  cuenta: number | null = null;
}

/** "¿A qué cuenta llegó?" (Transferencias, 2026-10-20). */
describe('CuentaDeposito', () => {
  async function montar(cuentas: { id: number; banco: string; titular: null; ultimos: string | null }[]) {
    await TestBed.configureTestingModule({
      imports: [Anfitrion],
      providers: [{ provide: TransferenciasService, useValue: transferenciasFalso(cuentas) }],
    }).compileComponents();
    const f = TestBed.createComponent(Anfitrion);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return f;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('con UNA cuenta se elige sola', async () => {
    const f = await montar([{ id: 7, banco: 'Banamex', titular: null, ultimos: '4521' }]);
    expect(f.componentInstance.cuenta).toBe(7);
    expect(f.nativeElement.textContent).toContain('Banamex …4521');
  });

  it('con varias hay que escogerla: arranca sin elegir', async () => {
    const f = await montar([
      { id: 7, banco: 'Banamex', titular: null, ultimos: '4521' },
      { id: 8, banco: 'Ban Bajío', titular: null, ultimos: null },
    ]);
    expect(f.componentInstance.cuenta).toBeNull();
    const opciones = [...f.nativeElement.querySelectorAll('option')].map((o: HTMLOptionElement) => o.textContent?.trim());
    expect(opciones).toEqual(['Elige la cuenta', 'Banamex …4521', 'Ban Bajío']);
  });

  it('la que se eligió sola se suelta si después hay varias (se dio de alta otra)', async () => {
    const f = await montar([{ id: 7, banco: 'Banamex', titular: null, ultimos: '4521' }]);
    expect(f.componentInstance.cuenta).toBe(7);
    const svc = TestBed.inject(TransferenciasService) as unknown as { cuentas: { set: (v: unknown) => void } };
    svc.cuentas.set([
      { id: 7, banco: 'Banamex', titular: null, ultimos: '4521' },
      { id: 9, banco: 'BBVA', titular: null, ultimos: '7788' },
    ]);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(f.componentInstance.cuenta).toBeNull();
  });

  it('sin cuentas dadas de alta no se dibuja', async () => {
    const f = await montar([]);
    expect(f.nativeElement.querySelector('select')).toBeNull();
  });
});
