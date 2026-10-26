import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { BotonPlantilla } from './boton-plantilla';
import { InventarioService } from '../core/services/inventario.service';

/**
 * «Descargar plantilla»: pide la del tipo que le toca (lista o un hilo), la baja
 * con su nombre y, si el servidor no la da, lo dice junto al botón.
 */
describe('BotonPlantilla', () => {
  let pedidas: string[];
  let falla: boolean;
  let bajados: string[];

  async function montar(tipo: 'lista' | 'hilo') {
    pedidas = [];
    bajados = [];
    spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (this: HTMLAnchorElement) { bajados.push(this.download); });
    await TestBed.configureTestingModule({
      imports: [BotonPlantilla],
      providers: [{
        provide: InventarioService,
        useValue: {
          plantillaCarga: (t: string) => {
            pedidas.push(t);
            return falla
              ? throwError(() => new HttpErrorResponse({ status: 403, error: new Blob([JSON.stringify({ error: { message: 'Tu puesto no tiene Surtir inventario' } })]) }))
              : of(new Blob(['x']));
          },
        },
      }],
    }).compileComponents();
    const f = TestBed.createComponent(BotonPlantilla);
    f.componentRef.setInput('tipo', tipo);
    f.detectChanges();
    return f;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('la de la lista con varios colores', async () => {
    falla = false;
    const f = await montar('lista');
    (f.nativeElement as HTMLElement).querySelector('button')!.click();
    expect(pedidas).toEqual(['lista']);
    expect(bajados).toEqual(['Plantilla - Lista con varios colores.xlsx']);
  });

  it('la de un solo hilo', async () => {
    falla = false;
    const f = await montar('hilo');
    f.componentInstance.bajar();
    expect(pedidas).toEqual(['hilo']);
    expect(bajados).toEqual(['Plantilla - Un solo hilo.xlsx']);
  });

  it('si el servidor no la da, lo dice', async () => {
    falla = true;
    const f = await montar('hilo');
    f.componentInstance.bajar();
    await new Promise((r) => setTimeout(r, 50));
    f.detectChanges();
    expect(f.componentInstance.error()).toBeTruthy();
    expect((f.nativeElement as HTMLElement).querySelector('[role=alert]')).not.toBeNull();
    expect(f.componentInstance.bajando()).toBe(false);
  });
});
