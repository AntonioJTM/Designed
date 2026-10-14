import { Pedido } from '../../core/models/ventas.models';
import { SIN_TICKET, armarTicket, llevaTicket, pxAMm, tipoDeTicket } from './ticket';

/**
 * El ticket impreso: dice qué fue (venta, apartado, pedido, a crédito), qué hilo
 * se llevó con su calibre y sus paquetes, y cuánto quedó pendiente. Lo de
 * imprimir (el marco y el largo de la hoja) se prueba en el navegador.
 */
describe('Ticket impreso', () => {
  const tienda = { nombre: 'Hitex', direccion: 'Calle Uno 10, Centro', telefono: '445 000 0000' };

  function venta(extra: Partial<Pedido> = {}): Pedido {
    return {
      id: 1,
      numero_pedido: 'POS-1791238416684-0F9E',
      canal: 'punto_venta',
      metodo_entrega: 'recoger',
      estado: 'pagado',
      inventario_descontado: 1,
      cliente: 'Salvador Ayala Cano',
      cliente_nombre_comercial: 'Chava',
      usuario: 'Antonio Tristan',
      caja: 'Caja Tienda Principal',
      subtotal: '3980.00',
      descuento: '0.00',
      impuestos: '0.00',
      costo_envio: '0.00',
      total: '3980.00',
      creado_en: '2026-10-13 21:40:12',
      detalle: [{
        id: 10, variante_id: 4, sku: 'PERLA-JASPE-2-30', descripcion: 'PERLA JASPE · Paquete',
        producto: 'PERLA JASPE', calibre: '2/30', presentacion: 'Paquete', tipo_presentacion: 'paquete',
        cantidad: '19.900', precio_unitario: '200.00', descuento: '0', impuesto: '0', subtotal: '3980.00',
        bultos: [{ codigo: '00632967', peso_kg: '19.900', lote: '0096940' }],
      }],
      pagos: [{ id: 1, metodo_pago_id: 1, metodo: 'Efectivo', monto: '3980.00', estado: 'completado', creado_en: '2026-10-13 21:40:12' }],
      ...extra,
    } as Pedido;
  }

  it('una venta de contado: el hilo con calibre, su paquete, el total y el cambio', () => {
    const html = armarTicket(venta(), tienda, { cambio: 20 });
    expect(html).toContain('HITEX');
    expect(html).toContain('Calle Uno 10, Centro');
    expect(html).toContain('Tel. 445 000 0000');
    expect(html).toContain('>Venta<');
    expect(html).toContain('POS-1791238416684-0F9E');
    expect(html).toContain('13 de octubre de 2026, 21:40');
    expect(html).toContain('Chava (Salvador Ayala Cano)');
    expect(html).toContain('PERLA JASPE 2/30 · Paquete');
    expect(html).toContain('19.9 kg × $200.00');
    expect(html).toContain('Paquete 00632967 · lote 0096940');
    expect(html).toContain('$3,980.00');
    expect(html).toContain('Recibido');
    expect(html).toContain('$4,000.00');
    expect(html).toContain('Cambio');
    // Sin IVA, descuento ni envío no se pintan renglones en cero.
    expect(html).not.toContain('IVA');
    expect(html).not.toContain('Subtotal');
  });

  it('dice qué fue: apartado, a crédito, nota pendiente, cancelada', () => {
    expect(tipoDeTicket(venta({ estado: 'apartado', inventario_descontado: 0 }), 0)).toBe('Apartado');
    expect(tipoDeTicket(venta({ estado: 'pendiente' }), 500)).toBe('A crédito');
    expect(tipoDeTicket(venta({ estado: 'pendiente', nota_pendiente: 1 } as Partial<Pedido>), 0)).toBe('Nota pendiente de pago');
    // Un pedido ya entregado es una venta.
    expect(tipoDeTicket(venta({ encargo: 1, estado: 'entregado', inventario_descontado: 1 }), 0)).toBe('Venta');
    expect(tipoDeTicket(venta({ estado: 'cancelado' }), 0)).toBe('Venta cancelada');
    expect(tipoDeTicket(venta(), 0)).toBe('Venta');
  });

  it('un apartado dice cuánto falta por pagar', () => {
    const html = armarTicket(venta({
      estado: 'apartado', inventario_descontado: 0,
      pagos: [{ id: 1, metodo_pago_id: 1, metodo: 'Efectivo', monto: '1000.00', estado: 'completado', creado_en: '' }],
    }), tienda);
    expect(html).toContain('>Apartado<');
    expect(html).toContain('Falta por pagar');
    expect(html).toContain('$2,980.00');
  });

  it('a crédito dice cuánto quedó a deber', () => {
    const html = armarTicket(venta({
      estado: 'pendiente', pagos: [],
      credito: [{ tipo: 'cargo', monto: '3980.00', creado_en: '' }],
    }), tienda);
    expect(html).toContain('A crédito');
    expect(html).toContain('Quedó a deber');
  });

  it('al reimprimir una venta fiada dice cómo va la deuda hoy', () => {
    const fiada = (debe: number) => venta({
      estado: 'pendiente', pagos: [], credito: [{ tipo: 'cargo', monto: '3980.00', creado_en: '' }], credito_por_pagar: debe,
    });
    expect(armarTicket(fiada(0), tienda)).toContain('Ya se pagó con abonos');
    const html = armarTicket(fiada(1000), tienda);
    expect(html).toContain('Hoy debe de esta venta');
    expect(html).toContain('$1,000.00');
    // Recién cobrada (debe todo): solo "Quedó a deber".
    expect(armarTicket(fiada(3980), tienda)).not.toContain('Hoy debe');
  });

  it('una nota pendiente de pago: sin "pagado" ni "cambio", dice cuánto queda pendiente', () => {
    const html = armarTicket(venta({ estado: 'pendiente', nota_pendiente: 1, pagos: [] } as Partial<Pedido>), tienda, { cambio: 50 });
    expect(html).toContain('Nota pendiente de pago');
    expect(html).toContain('Pendiente de pago');
    expect(html).toContain('$3,980.00');
    expect(html).not.toContain('Cambio');
    expect(html).not.toContain('Recibido');
  });

  it('una nota en espera (pedido sin entregar) NO lleva ticket: todavía se puede modificar', () => {
    const nota = venta({ encargo: 1, estado: 'en_preparacion', inventario_descontado: 0, pagos: [] });
    expect(llevaTicket(nota)).toBe(false);
    expect(() => armarTicket(nota, tienda)).toThrowError(SIN_TICKET);
    expect(llevaTicket(venta())).toBe(true);
  });

  it('varios paquetes en una línea se listan, y los conos se cuentan', () => {
    const p = venta();
    p.detalle![0].bultos = [
      { codigo: '00632967', peso_kg: '19.9', lote: null },
      { codigo: '00632970', peso_kg: '20', lote: null },
    ];
    p.detalle![0].piezas = 6;
    const html = armarTicket(p, tienda);
    expect(html).toContain('2 paquetes: 00632967, 00632970');
    expect(html).toContain('6 conos');
  });

  it('escapa lo que se capturó a mano', () => {
    const html = armarTicket(venta({ cliente_nombre_comercial: '<b>Doña</b>', cliente: null }), { nombre: 'Hitex' });
    expect(html).toContain('&lt;b&gt;Doña&lt;/b&gt;');
    expect(html).not.toContain('<b>Doña</b>');
  });

  it('convierte el largo medido a milímetros (96 pixeles = 1 pulgada = 25.4 mm)', () => {
    expect(pxAMm(96)).toBeCloseTo(25.4, 5);
  });
});
