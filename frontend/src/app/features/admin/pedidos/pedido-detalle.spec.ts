import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import { PedidoDetalle } from './pedido-detalle';
import { VentasService } from '../../../core/services/ventas.service';
import { Pedido } from '../../../core/models/ventas.models';

/**
 * Lo que importa del detalle del pedido:
 *   · el artículo dice QUÉ hilo es (calibre, material, línea), no solo el color;
 *   · subir la captura deja el pedido pagado y lo avisa;
 *   · quitarla NO descobra el pedido;
 *   · el object URL de la captura se libera, o el archivo se queda en memoria.
 */
describe('PedidoDetalle', () => {
  function pedidoBase(): Pedido {
    return {
      id: 5, numero_pedido: 'WEB-1', canal: 'tienda_linea', metodo_entrega: 'recoger',
      estado: 'pendiente', subtotal: '300.00', descuento: '0.00', impuestos: '48.00',
      costo_envio: '0.00', total: '348.00', creado_en: '2026-09-05 10:00:00',
      detalle: [
        {
          id: 11, variante_id: 5, sku: 'BLANCO', descripcion: 'BLANCO · Paquete',
          producto: 'BLANCO', calibre: '2/30', material: 'ACRILAN', linea: 'Turco',
          presentacion: 'Paquete', tipo_presentacion: 'paquete', peso_kg: '19.094',
          cantidad: '37.360', precio_unitario: '150.00', descuento: '0.00',
          impuesto: '48.00', subtotal: '300.00',
          bultos: [
            { codigo: 'B-1', peso_kg: '19.340', lote: 'L-778' },
            { codigo: 'B-2', peso_kg: '18.020', lote: 'L-902' },
          ],
        },
      ],
      pagos: [
        { id: 3, metodo_pago_id: 3, metodo: 'Transferencia', monto: '348.00',
          estado: 'pendiente', creado_en: '2026-09-05 10:00:00' },
      ],
    } as unknown as Pedido;
  }

  let actual: Pedido;
  let subido: { id: number; archivo: File } | null = null;
  let revocadas: string[] = [];
  let fallaLaBajada = false;

  const ventasFalso = {
    obtenerPedido: () => of(actual),
    subirComprobante: (id: number, archivo: File) => {
      subido = { id, archivo };
      actual = {
        ...actual,
        estado: 'pagado',
        pagos: [{ ...actual.pagos![0], estado: 'completado', tiene_comprobante: 1,
                  comprobante_nombre: archivo.name, comprobante_tipo: 'image/png',
                  comprobante_subido_por: 'Antonio' }],
      } as Pedido;
      return of(actual);
    },
    comprobante: () =>
      fallaLaBajada
        ? throwError(() => ({ error: { error: { message: 'Ya no está' } } }))
        : of(new Blob(['x'], { type: 'image/png' })),
    eliminarComprobante: () => {
      // El backend deja el pedido pagado: quitar la captura no descobra.
      actual = { ...actual, pagos: [{ ...actual.pagos![0], tiene_comprobante: 0 }] } as Pedido;
      return of(actual);
    },
    cambiarEstado: () => of(actual),
  };

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [PedidoDetalle],
      providers: [
        { provide: VentasService, useValue: ventasFalso },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '5' } } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(PedidoDetalle);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    actual = pedidoBase();
    subido = null;
    revocadas = [];
    fallaLaBajada = false;
    spyOn(URL, 'createObjectURL').and.returnValue('blob:falsa');
    spyOn(URL, 'revokeObjectURL').and.callFake((u: string) => void revocadas.push(u));
  });
  afterEach(() => TestBed.resetTestingModule());

  it('el artículo dice qué hilo es, no solo el color', async () => {
    const c = (await montar()).componentInstance;
    const linea = c.pedido()!.detalle![0];

    expect(c.fichaDelHilo(linea)).toBe('2/30 · ACRILAN · Turco');
  });

  it('la ficha no deja guiones sueltos cuando falta un dato', async () => {
    const c = (await montar()).componentInstance;

    expect(c.fichaDelHilo({ calibre: '1/30' } as never)).toBe('1/30');
    expect(c.fichaDelHilo({ calibre: '1/30', linea: 'Turco' } as never)).toBe('1/30 · Turco');
    expect(c.fichaDelHilo({} as never)).toBe('');
  });

  it('explica por qué una venta en línea no trae bultos', async () => {
    const c = (await montar()).componentInstance;
    expect(c.porQueSinBultos()).toContain('Venta en línea');
  });

  it('sin captura no hay pago con comprobante', async () => {
    const c = (await montar()).componentInstance;
    expect(c.pagoConComprobante()).toBeNull();
  });

  it('subir la captura deja el pedido pagado y lo dice', async () => {
    const c = (await montar()).componentInstance;
    const archivo = new File(['x'], 'captura.png', { type: 'image/png' });

    c.elegirArchivo({ target: { files: [archivo], value: 'c:/captura.png' } } as never);

    expect(subido!.id).toBe(5);
    expect(subido!.archivo.name).toBe('captura.png');
    expect(c.pedido()!.estado).toBe('pagado');
    expect(c.mensaje()).toContain('PAGADO');
    expect(c.pagoConComprobante()!.comprobante_nombre).toBe('captura.png');
  });

  it('limpia el input para que se pueda volver a elegir el mismo archivo', async () => {
    const c = (await montar()).componentInstance;
    const input = { files: [new File(['x'], 'a.png')], value: 'c:/a.png' };

    c.elegirArchivo({ target: input } as never);

    // Sin esto, elegir el mismo archivo otra vez no dispara `change` y parece
    // que el botón dejó de funcionar.
    expect(input.value).toBe('');
  });

  it('elegir y cancelar el diálogo no sube nada', async () => {
    const c = (await montar()).componentInstance;
    c.elegirArchivo({ target: { files: [], value: '' } } as never);
    expect(subido).toBeNull();
  });

  it('ver la captura la baja una sola vez', async () => {
    const c = (await montar()).componentInstance;
    c.elegirArchivo({ target: { files: [new File(['x'], 'a.png')], value: '' } } as never);

    c.verComprobante();
    expect(c.comprobanteUrl()).toBe('blob:falsa');

    // Ya está en pantalla: pedirla de nuevo no vuelve a viajar al servidor.
    (URL.createObjectURL as jasmine.Spy).calls.reset();
    c.verComprobante();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('si el archivo ya no está en el servidor, avisa', async () => {
    fallaLaBajada = true;
    const c = (await montar()).componentInstance;
    c.verComprobante();

    expect(c.errorComprobante()).toBe('Ya no está');
    expect(c.comprobanteUrl()).toBeNull();
  });

  it('quitar la captura NO descobra el pedido', async () => {
    const c = (await montar()).componentInstance;
    c.elegirArchivo({ target: { files: [new File(['x'], 'a.png')], value: '' } } as never);
    expect(c.pedido()!.estado).toBe('pagado');

    spyOn(window, 'confirm').and.returnValue(true);
    c.quitarComprobante();

    expect(c.pagoConComprobante()).toBeNull();
    // El dinero entró: que se borre la captura no significa que no se cobró.
    expect(c.pedido()!.estado).toBe('pagado');
  });

  it('no quita nada si se cancela la confirmación', async () => {
    const c = (await montar()).componentInstance;
    c.elegirArchivo({ target: { files: [new File(['x'], 'a.png')], value: '' } } as never);

    spyOn(window, 'confirm').and.returnValue(false);
    c.quitarComprobante();

    expect(c.pagoConComprobante()).not.toBeNull();
  });

  // Un apartado sin entregar no puede tomar atajos: se entrega desde
  // Apartados, y cancelado se reactiva como apartado.
  it('a un apartado vigente solo le ofrece cancelarlo', async () => {
    actual = { ...pedidoBase(), canal: 'punto_venta', estado: 'apartado', inventario_descontado: 0 };
    const c = (await montar()).componentInstance;

    expect(c.estados()).toEqual(['apartado', 'cancelado']);
  });

  it('un apartado cancelado se reactiva como apartado, no como venta', async () => {
    actual = { ...pedidoBase(), canal: 'punto_venta', estado: 'cancelado', inventario_descontado: 0 };
    const c = (await montar()).componentInstance;

    expect(c.estados()).toEqual(['cancelado', 'apartado']);
  });

  it('una venta normal no ofrece volverse apartado', async () => {
    actual = { ...pedidoBase(), inventario_descontado: 1 };
    const c = (await montar()).componentInstance;

    expect(c.estados()).not.toContain('apartado');
    expect(c.estados()).toContain('entregado');
  });

  it('cancelar un apartado no manda devoluciones: nunca salió de la bodega', async () => {
    actual = { ...pedidoBase(), canal: 'punto_venta', estado: 'apartado', inventario_descontado: 0 };
    const llamada = spyOn(ventasFalso, 'cambiarEstado').and.callThrough();
    const c = (await montar()).componentInstance;

    c.nuevoEstado = 'cancelado';
    c.cambiarEstado();
    c.confirmarDevolucion();

    expect(llamada.calls.mostRecent().args as unknown[]).toEqual([5, 'cancelado', undefined]);
    expect(c.mensaje()).toContain('Se liberó lo apartado');
  });

  // Subir la captura donde no hay pago al cual pegarla creaba otro por el total.
  it('ofrece subir la captura a un pedido que espera el depósito', async () => {
    const c = (await montar()).componentInstance;
    expect(c.aceptaComprobante()).toBe(true);
  });

  it('no ofrece la captura en un apartado: se le abona', async () => {
    actual = { ...pedidoBase(), canal: 'punto_venta', estado: 'apartado', inventario_descontado: 0 };
    const c = (await montar()).componentInstance;
    expect(c.aceptaComprobante()).toBe(false);
  });

  it('no ofrece la captura en una venta ya cobrada en efectivo', async () => {
    actual = {
      ...pedidoBase(), canal: 'punto_venta', estado: 'pagado',
      pagos: [{ id: 9, metodo_pago_id: 1, metodo: 'Efectivo', monto: '348.00',
                estado: 'completado', creado_en: '2026-09-05 10:00:00' }],
    } as Pedido;
    const c = (await montar()).componentInstance;
    expect(c.aceptaComprobante()).toBe(false);
  });

  it('libera el object URL al salir de la pantalla', async () => {
    const fixture = await montar();
    const c = fixture.componentInstance;
    c.elegirArchivo({ target: { files: [new File(['x'], 'a.png')], value: '' } } as never);
    c.verComprobante();

    fixture.destroy();

    // Sin revocarlo, el archivo se queda en memoria del navegador.
    expect(revocadas).toContain('blob:falsa');
  });
});
