import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { PedidoDetalle } from './pedido-detalle';
import { VentasService } from '../../../core/services/ventas.service';
import { AuthService } from '../../../core/services/auth.service';
import { Pedido } from '../../../core/models/ventas.models';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';

/**
 * Lo que importa del detalle del pedido:
 *   · el artículo dice QUÉ hilo es (calibre, material, línea), no solo el color;
 *   · subir la captura deja el pedido pagado y lo avisa;
 *   · quitarla NO descobra el pedido;
 *   · el object URL de la captura se libera, o el archivo se queda en memoria;
 *   · cancelar y devolver solo se ofrecen con el permiso del puesto.
 */
describe('PedidoDetalle', () => {
  /** Lo que contesta la ventana de confirmación en la prueba. */
  let respuesta = true;
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
  let permisos: Set<string>;

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
        provideRouter([]),
        { provide: VentasService, useValue: ventasFalso },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '5' } } } },
        { provide: AuthService, useValue: { puede: (k: string) => permisos.has(k) } },
        // La ventana de confirmación del sistema: contesta lo que diga `respuesta`.
        { provide: ConfirmacionService, useValue: { pedir: () => Promise.resolve(respuesta) } },
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
    permisos = new Set(['hacer:cancelar_venta', 'ver:clientes', 'ver:apartados']);
    spyOn(URL, 'createObjectURL').and.returnValue('blob:falsa');
    spyOn(URL, 'revokeObjectURL').and.callFake((u: string) => void revocadas.push(u));
  });
  afterEach(() => TestBed.resetTestingModule());

  it('el artículo dice qué hilo es, no solo el color', async () => {
    const c = (await montar()).componentInstance;
    const linea = c.pedido()!.detalle![0];

    // El calibre va en el nombre; material y línea, debajo.
    expect(c.nombreDelHilo(linea)).toBe('BLANCO 2/30 · Paquete');
    expect(c.fichaDelHilo(linea)).toBe('ACRILAN · Turco');
  });

  it('la ficha no deja guiones sueltos cuando falta un dato', async () => {
    const c = (await montar()).componentInstance;

    expect(c.fichaDelHilo({ material: 'ACRILAN' } as never)).toBe('ACRILAN');
    expect(c.fichaDelHilo({ linea: 'Turco' } as never)).toBe('Turco');
    expect(c.fichaDelHilo({} as never)).toBe('');
    // Sin producto en el catálogo queda lo que se congeló en la venta.
    expect(c.nombreDelHilo({ descripcion: 'ROJO · Paquete' } as never)).toBe('ROJO · Paquete');
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

    respuesta = true;
    await c.quitarComprobante();

    expect(c.pagoConComprobante()).toBeNull();
    // El dinero entró: que se borre la captura no significa que no se cobró.
    expect(c.pedido()!.estado).toBe('pagado');
  });

  it('no quita nada si se cancela la confirmación', async () => {
    const c = (await montar()).componentInstance;
    c.elegirArchivo({ target: { files: [new File(['x'], 'a.png')], value: '' } } as never);

    respuesta = false;
    await c.quitarComprobante();

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

  // ---- Permisos y la franja de arriba ----

  it('sin el permiso no ofrece cancelar ni devolver, ni en el selector', async () => {
    permisos = new Set();
    actual = { ...pedidoBase(), canal: 'punto_venta', estado: 'pagado', inventario_descontado: 1 };
    const c = (await montar()).componentInstance;
    const p = c.pedido()!;

    expect(c.puedeCancelarEste(p)).toBe(false);
    expect(c.puedeDevolverEste(p)).toBe(false);
    expect(c.opcionesEstado()).not.toContain('cancelado');
    expect(c.opcionesEstado()).not.toContain('devuelto');
  });

  it('a un apartado vigente se le puede cancelar pero no devolver: nunca salió', async () => {
    actual = { ...pedidoBase(), canal: 'punto_venta', estado: 'apartado', inventario_descontado: 0 };
    const c = (await montar()).componentInstance;
    const p = c.pedido()!;

    expect(c.puedeCancelarEste(p)).toBe(true);
    expect(c.puedeDevolverEste(p)).toBe(false);
  });

  it('el botón de cancelar abre la confirmación, no cancela de un golpe', async () => {
    actual = { ...pedidoBase(), canal: 'punto_venta', estado: 'pagado', inventario_descontado: 1 };
    const llamada = spyOn(ventasFalso, 'cambiarEstado').and.callThrough();
    const c = (await montar()).componentInstance;

    c.abrirCancelar();
    expect(c.confirmando()).toBe(true);
    expect(c.nuevoEstado).toBe('cancelado');
    expect(llamada).not.toHaveBeenCalled();
  });

  it('una venta fiada dice cuánto pagó y cuánto se fió a su cuenta', async () => {
    actual = {
      ...pedidoBase(), canal: 'punto_venta', estado: 'pendiente', inventario_descontado: 1,
      cliente_id: 7, cliente: 'Tejidos JC',
      pagos: [{ id: 9, metodo_pago_id: 1, metodo: 'Efectivo', monto: '48.00',
                estado: 'completado', creado_en: '2026-09-05 10:00:00' }],
      credito: [{ tipo: 'cargo', monto: '300.00', notas: 'Venta a crédito WEB-1', creado_en: '2026-09-05 10:00:00' }],
    } as Pedido;
    const c = (await montar()).componentInstance;

    expect(c.cifras().map((x) => x.etiqueta)).toEqual(['Total', 'Pagó al comprar', 'Se fió a su cuenta']);
    expect(c.cifras()[2].valor).toBe(300);
    // Sin saber de abonos, se debe todo.
    expect(c.cifras()[2].pie).toBe('debe $300.00');
    // Lo fiado aparece como un pago más, por pagar.
    expect(c.filasPago().some((f) => f.estado === 'Por pagar' && f.monto === 300)).toBe(true);
    expect(c.historia().some((h) => h.que.includes('a la cuenta de Tejidos JC'))).toBe(true);
  });

  it('una venta fiada que ya se pagó con abonos lo dice (2026-10-06)', async () => {
    const fiada = {
      ...pedidoBase(), canal: 'punto_venta', inventario_descontado: 1, cliente_id: 7, cliente: 'Tejidos JC',
      credito: [{ tipo: 'cargo', monto: '300.00', notas: 'Venta a crédito POS-1', creado_en: '2026-09-05 10:00:00' }],
    };
    actual = { ...fiada, estado: 'pagado', credito_pagado: 300, credito_por_pagar: 0 } as Pedido;
    let c = (await montar()).componentInstance;
    expect(c.cifras()[2].pie).toBe('ya está pagado');
    expect(c.cifras()[2].alerta).toBe(false);
    expect(c.filasPago().some((f) => f.estado === 'Pagado con abonos' && f.tono === 'verde')).toBe(true);
    // Ya pagada con abonos: no se ofrece regresarla a pendiente.
    expect(c.opcionesEstado()).not.toContain('pendiente');
    TestBed.resetTestingModule();

    // A medias: debe lo que falta de ESTA venta.
    actual = { ...fiada, estado: 'pendiente', credito_pagado: 100, credito_por_pagar: 200 } as Pedido;
    c = (await montar()).componentInstance;
    expect(c.cifras()[2].pie).toBe('debe $200.00');
    expect(c.filasPago().some((f) => f.estado === 'Debe $200.00')).toBe(true);
    // Mientras se deba, no se ofrece marcarla pagada ni entregada a mano.
    expect(c.opcionesEstado()).not.toContain('pagado');
    expect(c.opcionesEstado()).not.toContain('entregado');
  });
});
