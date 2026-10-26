import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ModificarPedidoModal } from './modificar-modal';
import { VentasService } from '../../../core/services/ventas.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';
import { Encargo, Pedido } from '../../../core/models/ventas.models';

/**
 * MODIFICAR una nota en espera: una línea de CONOS lleva sus kilos Y cuántos
 * conos son, los dos obligatorios (2026-10-21, usuario: "que la cantidad de conos
 * y el peso, ambos, sean obligatorios").
 */
describe('ModificarPedidoModal · conos', () => {
  const pedido = {
    id: 9, numero_pedido: 'POS-1790000000009-ABCD', metodo_entrega: 'recoger', entrega_direccion: null,
    costo_envio: 0, entrega_para: null, notas: null, almacen_id: 2, almacen: 'Tienda principal',
  } as unknown as Encargo;

  function detalle(piezas: number | null): Pedido {
    return {
      id: 9,
      detalle: [{
        id: 31, variante_id: 7, descripcion: 'ROJO · Cono', producto: 'ROJO', calibre: '2/30', tipo_presentacion: 'cono',
        precio_unitario: '200.00', descuento: '0', impuesto: '0', subtotal: '1870.00', cantidad: '9.350', piezas, bultos: [],
      }],
    } as unknown as Pedido;
  }

  let enviado: unknown = null;

  async function montar(piezas: number | null) {
    await TestBed.configureTestingModule({
      imports: [ModificarPedidoModal],
      providers: [
        {
          provide: VentasService,
          useValue: {
            obtenerPedido: () => of(detalle(piezas)),
            modificarPedido: (_id: number, body: unknown) => { enviado = body; return of(detalle(piezas)); },
          },
        },
        { provide: InventarioService, useValue: {} },
        { provide: ConfirmacionService, useValue: { pedir: () => Promise.resolve(true) } },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(ModificarPedidoModal);
    f.componentRef.setInput('pedido', pedido);
    f.detectChanges();
    return f;
  }

  beforeEach(() => (enviado = null));
  afterEach(() => TestBed.resetTestingModule());

  it('una línea de conos sin cuántos son no se guarda', async () => {
    const f = await montar(null);
    const c = f.componentInstance;
    expect(c.motivo()).toBe('Escribe cuántos conos son de ROJO 2/30.');
    const el = f.nativeElement as HTMLElement;
    const guardar = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Guardar'))!;
    expect(guardar.disabled).toBe(true);
    c.guardar();
    expect(enviado).toBeNull();
    // El campo "Cuántos conos" (el segundo de la línea, tras los kilos) va en rojo.
    f.detectChanges();
    const conos = el.querySelectorAll<HTMLInputElement>('.pesar input')[1];
    expect(conos.getAttribute('aria-invalid')).toBe('true');
    expect(conos.required).toBe(true);
  });

  it('con sus kilos y cuántos conos son, se guarda con los dos', async () => {
    const f = await montar(null);
    const c = f.componentInstance;
    c.lineas.update((ls) => ls.map((l) => ({ ...l, conos: 2.5 })));
    expect(c.motivo()).toContain('cuántos conos');
    c.lineas.update((ls) => ls.map((l) => ({ ...l, conos: 6 })));
    expect(c.motivo()).toBeNull();
    c.guardar();
    expect((enviado as { lineas: unknown[] }).lineas).toEqual([
      jasmine.objectContaining({ detalle_id: 31, cantidad: 9.35, piezas: 6 }),
    ]);
  });
});
