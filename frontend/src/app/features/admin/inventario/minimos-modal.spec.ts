import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MinimosModal } from './minimos-modal';
import { InventarioService, MinimosResultado } from '../../../core/services/inventario.service';
import { Almacen } from '../../../core/models/inventario.models';

/**
 * MÍNIMO PARA VARIOS HILOS (2026-10-16): "avisarme en Sucursal Moroleón cuando
 * queden menos de 5 paquetes de cualquier color". Antes de guardar dice a quiénes
 * y con cuánto; por omisión respeta a los que ya tenían su propio mínimo.
 */
describe('Mínimo para varios hilos', () => {
  const almacenes = [{ id: 1, nombre: 'MATRIZ CUAUTEPEC', activo: 1 }, { id: 2, nombre: 'SUCURSAL MOROLEON', activo: 1 }] as unknown as Almacen[];
  let pedidos: Record<string, unknown>[];

  const resultado = (extra: Partial<MinimosResultado> = {}): MinimosResultado => ({
    almacen_id: 2, paquetes: 5, solo_sin_minimo: true, guardado: false, cambian: 2, se_quedan: 1, sin_peso: 0,
    renglones: [
      { variante_id: 6, producto: 'CAMEL', calibre: '2/30', sku: 'CAMEL-2-30', tenia_kg: 0, kg: 94.364, peso_paquete: 18.873, peso_estimado: false, sin_peso: false, cambia: true, se_queda: false },
      { variante_id: 2, producto: 'VINO CLARO', calibre: '2/30', sku: 'VINO-CLARO', tenia_kg: 0, kg: 97.313, peso_paquete: 19.463, peso_estimado: true, sin_peso: false, cambia: true, se_queda: false },
      { variante_id: 1, producto: 'VINO OSCURO', calibre: '2/30', sku: 'VINO-OSCURO', tenia_kg: 40, kg: 96.3, peso_paquete: 19.26, peso_estimado: false, sin_peso: false, cambia: false, se_queda: true },
    ],
    ...extra,
  });

  async function montar(almacenInicial: number | null = 2) {
    pedidos = [];
    await TestBed.configureTestingModule({
      imports: [MinimosModal],
      providers: [{
        provide: InventarioService,
        useValue: { minimos: (b: Record<string, unknown>) => { pedidos.push(b); return of(resultado({ guardado: !!b['guardar'] })); } },
      }],
    }).compileComponents();
    const fixture = TestBed.createComponent(MinimosModal);
    fixture.componentRef.setInput('almacenes', almacenes);
    fixture.componentRef.setInput('almacenInicial', almacenInicial);
    fixture.detectChanges();
    return fixture;
  }
  const texto = (el: HTMLElement) => el.textContent!.replace(/\s+/g, ' ');
  afterEach(() => TestBed.resetTestingModule());

  it('abre con el almacén de la pantalla y 5 paquetes, y enseña a quiénes y con cuánto', async () => {
    const fixture = await montar();
    const el = fixture.nativeElement as HTMLElement;
    expect(pedidos[0]).toEqual({ almacen_id: 2, paquetes: 5, solo_sin_minimo: true });
    expect(el.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    expect(texto(el)).toContain('Se le pone a 2 hilos: avisa cuando le queden 5 paquetes o menos');
    expect(texto(el)).toContain('1 ya tenía su propio mínimo y se queda igual.');
    expect(texto(el)).toContain('CAMEL 2/30');
    expect(texto(el)).toContain('94.364 kg');
    expect(texto(el)).toContain('peso del catálogo');
    expect(texto(el)).toContain('se queda');
    expect(texto(el)).toContain('Poner el mínimo a 2 hilos');
  });

  it('guardar manda lo mismo con guardar: true, avisa y sigue abierta', async () => {
    const fixture = await montar();
    let guardado = 0;
    fixture.componentInstance.guardado.subscribe(() => guardado++);
    fixture.componentInstance.guardar();
    fixture.detectChanges();
    expect(pedidos[1]).toEqual({ almacen_id: 2, paquetes: 5, solo_sin_minimo: true, guardar: true });
    expect(guardado).toBe(1);
    expect(texto(fixture.nativeElement)).toContain('Listo: 2 hilos quedaron con mínimo en SUCURSAL MOROLEON.');
  });

  it('"A todos" pide reemplazar el que tenían; sin almacén de la pantalla, el primero', async () => {
    const fixture = await montar(null);
    expect(pedidos[0]['almacen_id']).toBe(1);
    fixture.componentInstance.soloSinMinimo = false;
    fixture.componentInstance.pedirPrevia();
    expect(pedidos[1]).toEqual({ almacen_id: 1, paquetes: 5, solo_sin_minimo: false });
    // Un número que no sirve no pregunta nada.
    fixture.componentInstance.paquetes = 0;
    fixture.componentInstance.pedirPrevia();
    expect(pedidos.length).toBe(2);
  });
});
