import { Pedido } from '../../core/models/ventas.models';
import { armarTicket } from './ticket';
import { armarPdf, dibujarTicket, ticketEnPdf } from './ticket-pdf';

/**
 * EL TICKET EN PDF para WhatsApp (2026-10-16): el mismo ticket que se imprime,
 * dibujado y metido en un PDF de una hoja. Se prueba en Chrome de verdad: que el
 * dibujo no salga en blanco y que el PDF esté bien armado (sus posiciones son las
 * que dice su índice, o un lector de PDF lo rechaza).
 */
describe('Ticket en PDF', () => {
  const tienda = { nombre: 'Hitex', telefono: '445 000 0000', papelMm: 80 };
  const venta = {
    id: 1, numero_pedido: 'POS-1791238416684-0F9E', canal: 'punto_venta', metodo_entrega: 'recoger', estado: 'pagado',
    inventario_descontado: 1, cliente: 'Salvador Ayala Cano', usuario: 'Juan Perez', caja: 'Caja Tienda Principal',
    subtotal: '3980.00', descuento: '0.00', impuestos: '0.00', costo_envio: '0.00', total: '3980.00',
    creado_en: '2026-10-13 21:40:12',
    detalle: [{
      id: 10, variante_id: 4, sku: 'PERLA-JASPE-2-30', descripcion: 'PERLA JASPE · Paquete', producto: 'PERLA JASPE',
      calibre: '2/30', presentacion: 'Paquete', tipo_presentacion: 'paquete', cantidad: '19.900', precio_unitario: '200.00',
      descuento: '0', impuesto: '0', subtotal: '3980.00', bultos: [{ codigo: '00632967', peso_kg: '19.900', lote: '0096940' }],
    }],
    pagos: [{ id: 1, metodo_pago_id: 1, metodo: 'Efectivo', monto: '3980.00', estado: 'completado', creado_en: '2026-10-13 21:40:12' }],
  } as unknown as Pedido;

  it('dibuja el ticket del ancho del papel (60 mm + 1 mm por lado) y con letras, no en blanco', async () => {
    const t = await dibujarTicket(armarTicket(venta, tienda));
    // 62 mm a 96 por pulgada son unos 234 px.
    expect(t.anchoPx).toBeGreaterThan(228);
    expect(t.anchoPx).toBeLessThan(240);
    expect(t.altoPx).toBeGreaterThan(300);
    // Cuatro veces más grande, para que se lea nítido al acercarlo.
    expect(t.lienzo.width).toBe(Math.round(t.anchoPx * 4));
    const datos = t.lienzo.getContext('2d')!.getImageData(0, 0, t.lienzo.width, t.lienzo.height).data;
    let negros = 0;
    for (let i = 0; i < datos.length; i += 4) if (datos[i] < 80) negros++;
    // La banda negra de "VENTA", el total y las letras: miles de puntos oscuros.
    expect(negros).toBeGreaterThan(5000);
  });

  it('arma un PDF de una hoja del tamaño del ticket, con su índice en su lugar', async () => {
    const pdf = await ticketEnPdf(armarTicket(venta, tienda), 'Ticket de venta POS-0F9E');
    expect(pdf.type).toBe('application/pdf');
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    // Como texto "latin1": un byte, un carácter (así las posiciones coinciden).
    const texto = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    expect(texto.startsWith('%PDF-1.4\n')).toBeTrue();
    expect(texto.trimEnd().endsWith('%%EOF')).toBeTrue();
    expect(texto).toContain('/Subtype /Image');
    expect(texto).toContain('/Filter /FlateDecode');
    expect(texto).toMatch(/\/MediaBox \[0 0 1\d\d\.\d\d \d+\.\d\d\]/);

    // El índice (xref) dice dónde empieza cada objeto, y ahí empieza de verdad.
    const xref = Number(/startxref\n(\d+)\n/.exec(texto)![1]);
    expect(texto.slice(xref, xref + 4)).toBe('xref');
    const posiciones = texto.slice(xref).split('\n').slice(3, 9).map((l) => Number(l.slice(0, 10)));
    posiciones.forEach((p, i) => expect(texto.slice(p, p + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    // El título con acentos va en UTF-16 ("Ticket…" empieza con FEFF 0054).
    expect(texto).toContain('/Title <FEFF0054');
  });

  it('la imagen del PDF es el dibujo completo, sin perder nada', async () => {
    const t = await dibujarTicket(armarTicket(venta, tienda));
    const pdf = await armarPdf(t, 'Prueba');
    const texto = Array.from(new Uint8Array(await pdf.arrayBuffer()), (b) => String.fromCharCode(b)).join('');
    expect(texto).toContain(`/Width ${t.lienzo.width} /Height ${t.lienzo.height}`);
    expect(texto).toContain('/ColorSpace /DeviceGray /BitsPerComponent 8');
  });
});
