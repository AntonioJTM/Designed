import { DevolucionHecha, Pedido } from '../../core/models/ventas.models';
import { TicketAbonoCuenta, TicketAnticipo, TicketPagoNota } from '../../core/models/tickets.models';
import { SIN_TICKET, armarTicket, armarTicketAbonoCuenta, armarTicketAnticipo, armarTicketDevolucion, armarTicketPagoNota, llevaTicket, papelDe, prepararHoja, telefonoLegible, tipoDeTicket, armarPrueba } from './ticket';

/**
 * El ticket impreso: dice qué fue (venta, apartado, pedido, a crédito), qué hilo
 * se llevó con su calibre y sus paquetes, y cuánto quedó pendiente. Lo de
 * imprimir (el marco y la espera del logo) se prueba en un marco de verdad.
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
      usuario: 'Juan Perez',
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

  // EL VENDEDOR (2026-10-23): "Atendió" es quien la vendió; si la registró otra persona,
  // también va, como «Elaboró» (en una nota pendiente de pago nadie cobró).
  it('dice quién la atendió (el vendedor) y, si la registró otra persona, quién la elaboró', () => {
    let html = armarTicket(venta({ usuario_id: 1, vendedor_id: 7, vendedor: 'Rosa Martínez' }), tienda, { cambio: 0 });
    expect(html).toContain('Atendió');
    expect(html).toContain('Rosa Martínez');
    expect(html).toContain('Elaboró');
    expect(html).toContain('Juan Perez');
    expect(html).not.toContain('Cobró');

    html = armarTicket(venta({ usuario_id: 1, vendedor_id: 1, vendedor: 'Juan Perez' }), tienda, { cambio: 0 });
    expect(html).toContain('Atendió');
    expect(html).not.toContain('Elaboró');

    // Dos personas con el MISMO nombre: se compara por persona, no por nombre.
    html = armarTicket(venta({ usuario_id: 1, vendedor_id: 9, vendedor: 'Juan Perez' }), tienda, { cambio: 0 });
    expect(html).toContain('Elaboró');

    // Las ventas de antes no traen vendedor: atendió quien la registró.
    html = armarTicket(venta(), tienda, { cambio: 0 });
    expect(html).toContain('Juan Perez');
    expect(html).not.toContain('Elaboró');
  });

  /*
   * Pagada con su SALDO A FAVOR (2026-10-15: "que diga que se pagó con saldo a
   * favor y cuánto le queda, si aún tiene"). El caso de la foto: $2,820.25.
   */
  it('pagada con su saldo a favor: lo dice así, y cuánto le queda si aún tiene', () => {
    const conSaldo = (quedo: number, hoy: number) => venta({
      total: '2820.25', subtotal: '2820.25',
      pagos: [{ id: 2, metodo_pago_id: 9, metodo: 'Saldo a favor', monto: '2820.25', estado: 'completado', creado_en: '2026-10-15 23:10:00' }],
      saldo_favor_usado: { usado: 2820.25, quedo, hoy },
    });

    // El recuadro de hoy va SIEMPRE (2026-10-16), aunque no haya cambiado.
    let html = armarTicket(conSaldo(500, 500), tienda);
    expect(html).toContain('Pagó con su saldo a favor');
    expect(html).toContain('Le queda a favor');
    expect(html).toContain('Su saldo a favor hoy<b>$500.00</b>');

    // Lo usó todo: no se dice "le queda", y el recuadro dice $0.00.
    html = armarTicket(conSaldo(0, 0), tienda);
    expect(html).toContain('Pagó con su saldo a favor');
    expect(html).not.toContain('Le queda a favor');
    expect(html).toContain('Su saldo a favor hoy<b>$0.00</b>');

    // Reimpreso días después, ya con otro saldo: lo que le quedó ese día y lo de hoy.
    html = armarTicket(conSaldo(500, 1200), tienda);
    expect(html).toContain('Le queda a favor');
    expect(html).toContain('Su saldo a favor hoy');
    expect(html).toContain('$1,200.00');

    // Pagada parte con saldo y parte en efectivo: los dos renglones.
    html = armarTicket(venta({
      total: '2820.25', subtotal: '2820.25',
      pagos: [
        { id: 2, metodo_pago_id: 9, metodo: 'Saldo a favor', monto: '800.00', estado: 'completado', creado_en: '2026-10-15 23:10:00' },
        { id: 3, metodo_pago_id: 1, metodo: 'Efectivo', monto: '2020.25', estado: 'completado', creado_en: '2026-10-15 23:10:00' },
      ],
      saldo_favor_usado: { usado: 800, quedo: 0, hoy: 0 },
    }), tienda);
    expect(html).toContain('Pagó con su saldo a favor');
    expect(html).toContain('$800.00');
    expect(html).toContain('Efectivo');
  });

  it('reimpreso, dice lo recibido y el cambio que se guardaron con el pago (2026-10-16)', () => {
    const html = armarTicket(venta({
      pagos: [{ id: 1, metodo_pago_id: 1, metodo: 'Efectivo', monto: '3980.00', recibido: '4000.00', estado: 'completado', creado_en: '2026-10-13 21:40:12' }],
    }), tienda);
    expect(html).toContain('Recibido');
    expect(html).toContain('$4,000.00');
    expect(html).toContain('Cambio');
    expect(html).toContain('$20.00');
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
    // Sin lote, juntos (2026-10-20: por lote).
    expect(html).toContain('Sin lote: 2 paquetes (00632967, 00632970)');
    expect(html).toContain('6 conos');
  });

  it('varios paquetes de distintos lotes: cuántos van de cada lote (2026-10-20)', () => {
    const p = venta();
    p.detalle![0].bultos = [
      { codigo: 'A1', peso_kg: '19.1', lote: '0094853' },
      { codigo: 'B1', peso_kg: '18.4', lote: '0094860' },
      { codigo: 'A2', peso_kg: '19.45', lote: '0094853' },
    ];
    const html = armarTicket(p, tienda);
    expect(html).toContain('Lote 0094853: 2 paquetes (A1, A2)');
    expect(html).toContain('Lote 0094860: 1 paquete (B1)');
  });

  it('escapa lo que se capturó a mano', () => {
    const html = armarTicket(venta({ cliente_nombre_comercial: '<b>Doña</b>', cliente: null }), { nombre: 'Hitex' });
    expect(html).toContain('&lt;b&gt;Doña&lt;/b&gt;');
    expect(html).not.toContain('<b>Doña</b>');
  });

  it('el encabezado lleva el logo y los datos fiscales, y la leyenda va al pie', () => {
    const html = armarTicket(venta(), {
      ...tienda,
      logo: 'http://localhost/hitex-ticket.png',
      razonSocial: 'EMPRESA DE PRUEBA, S.A. DE C.V.',
      rfc: 'XAXX010101000',
      regimen: '601 General de Ley Personas Morales',
      domicilio: 'Calle Dos 20, C.P. 10000',
      leyenda: 'Este ticket no es un comprobante fiscal.',
    });
    expect(html).toContain('<img class="logo" src="http://localhost/hitex-ticket.png"');
    expect(html).toContain('EMPRESA DE PRUEBA, S.A. DE C.V.');
    expect(html).toContain('RFC: <b>XAXX010101000</b>');
    expect(html).toContain('Régimen: 601 General de Ley Personas Morales');
    // El domicilio fiscal va en lugar de la dirección de la tienda, no junto a ella.
    expect(html).toContain('Calle Dos 20, C.P. 10000');
    expect(html).not.toContain('Calle Uno 10');
    expect(html).toContain('Tel. 445 000 0000');
    expect(html).toContain('<div class="leyenda">Este ticket no es un comprobante fiscal.</div>');
    // Si el logo no carga, queda el nombre en letras listo para ponerse.
    expect(html).toContain('<template id="sin-logo"><h1>HITEX</h1></template>');
  });

  it('si el régimen o el RFC se copiaron con su rótulo, no lo repite', () => {
    const html = armarTicket(venta(), {
      ...tienda,
      rfc: 'RFC: XAXX010101000',
      regimen: 'REGIMEN: 601 GENERAL DE LEY PERSONAS MORALES',
    });
    expect(html).toContain('RFC: <b>XAXX010101000</b>');
    expect(html).toContain('Régimen: 601 GENERAL DE LEY PERSONAS MORALES');
    expect(html).not.toMatch(/Régimen: R[EÉ]GIMEN/i);
    // Sin los dos puntos es parte del dato: no se toca.
    const resico = armarTicket(venta(), { ...tienda, rfc: 'RFCA800101AB1', regimen: 'Régimen Simplificado de Confianza' });
    expect(resico).toContain('RFC: <b>RFCA800101AB1</b>');
    expect(resico).toContain('Régimen: Régimen Simplificado de Confianza');
  });

  it('va pegado a la izquierda, no centrado: en una impresora que imprime menos de lo que dice su hoja no se corta', () => {
    const html = armarTicket(venta(), tienda);
    expect(html).toContain('.t { width: 46mm; margin: 0 0 0 1mm;');
    expect(html).not.toContain('margin: 0 auto; padding: 2mm');
  });

  it('la hoja de prueba trae la regla hasta 80 mm y el recuadro del ancho elegido', () => {
    const de58 = armarPrueba('58');
    expect(de58).toContain('Ancho elegido: <b>58 mm</b>');
    expect(de58).toContain('width: 46mm');
    expect(de58).toContain('<b style="left:77.5mm">80</b>');
    expect(armarPrueba('80')).toContain('width: 60mm');
  });

  it('sin datos fiscales capturados no deja renglones vacíos ni leyenda', () => {
    const html = armarTicket(venta(), { nombre: 'Hitex' });
    expect(html).toContain('<h1>HITEX</h1>');
    expect(html).not.toContain('RFC:');
    expect(html).not.toContain('class="leyenda"');
  });

  it('el teléfono de 10 dígitos se lee en tres partes; lo demás se deja como está', () => {
    expect(telefonoLegible('7786542453')).toBe('778 654 2453');
    expect(telefonoLegible('778 654 2453')).toBe('778 654 2453');
    expect(telefonoLegible('Ext. 12')).toBe('Ext. 12');
  });

  it('NO pide tamaño de hoja: en la impresora (rollo de 58 × 3276 mm) Chrome lo encogía a la mitad', () => {
    const html = armarTicket(venta(), tienda);
    expect(html).toContain('@page { margin: 0; }');
    expect(html).not.toMatch(/@page[^}]*size/);
  });

  it('se acomoda al papel: 58 mm por omisión (la POS-58 de la tienda) u 80 mm', () => {
    expect(papelDe(null).mm).toBe(58);
    expect(papelDe('58').mm).toBe(58);
    expect(papelDe('80').mm).toBe(80);
    const angosto = armarTicket(venta(), { ...tienda, logo: 'x.png' });
    expect(angosto).toContain('.t { width: 46mm;');
    expect(angosto).toContain('width: 36mm; height: auto;');
    expect(angosto).toContain('font-size: 10.1px'); // 12 × 0.84: la letra baja para que quepan los importes
    // El de 80 mide 53 mm: lo que cupo en la WL88S de la tienda (2026-10-14).
    const ancho = armarTicket(venta(), { ...tienda, logo: 'x.png', papelMm: '80' });
    expect(ancho).toContain('.t { width: 60mm;');
    expect(ancho).toContain('width: 44mm; height: auto;');
    expect(ancho).toContain('font-size: 10.1px'); // 12 × 0.84
  });

  describe('la hoja, antes de imprimir', () => {
    let marco: HTMLIFrameElement;

    async function preparar(html: string): Promise<Document> {
      marco = document.createElement('iframe');
      marco.style.cssText = 'position:fixed;left:-10000px;top:0;width:58mm;height:50mm;border:0';
      document.body.appendChild(marco);
      const doc = marco.contentDocument!;
      doc.open();
      doc.write(html);
      doc.close();
      await prepararHoja(doc);
      return doc;
    }

    afterEach(() => marco?.remove());

    it('si el logo no carga, pone el nombre en letras y no se queda esperando', async () => {
      const doc = await preparar(armarTicket(venta(), { nombre: 'Hitex', logo: 'data:image/png;base64,AAAA' }));
      expect(doc.querySelector('img.logo')).toBeNull();
      expect(doc.querySelector('.tienda h1')?.textContent).toBe('HITEX');
    });

    it('espera a que cargue el logo antes de imprimir', async () => {
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const doc = await preparar(armarTicket(venta(), { nombre: 'Hitex', logo: png }));
      const logo = doc.querySelector<HTMLImageElement>('img.logo');
      expect(logo?.complete).toBe(true);
      expect(logo?.naturalWidth).toBe(1);
      // 36 mm de ancho en papel de 58 (unos 136 pixeles), con la proporción del logo.
      expect(Math.round(logo!.getBoundingClientRect().width)).toBe(136);
    });
  });
});

/**
 * EL TICKET DE DEVOLUCIÓN (2026-10-15): dice "Devolución", de qué venta, qué
 * regresó y a cuánto, cuánto le quedó a favor y su saldo a favor de hoy. El de
 * la venta no cambia.
 */
describe('Ticket de devolución', () => {
  const tienda = { nombre: 'Hitex', leyenda: 'Este ticket no es un comprobante fiscal.' };
  const venta = {
    id: 760, numero_pedido: 'POS-1792036260049-468D', canal: 'punto_venta', estado: 'pagado',
    almacen: 'TIENDA MOROLEON', creado_en: '2026-10-14 21:51:03', total: '2726.00', detalle: [], pagos: [],
  } as unknown as Pedido;

  function devolucion(extra: Partial<DevolucionHecha> = {}): DevolucionHecha {
    return {
      id: 5, folio: 'DEV-1792120547056-B23B', total: 2726, aplicado_a_deuda: 0, notas: null,
      creado_en: '2026-10-15 00:35:47', cliente_id: 9, cliente: 'MARTHA LOPEZ RUIZ', usuario: 'Lupita Ramos',
      lineas: [{ detalle_id: 1, hilo: 'CAMEL 2/30', como: 'paquete', kg: 18.8, piezas: null, importe: 2726, codigos: ['00621999'] }],
      saldo_favor_hoy: 2726,
      ...extra,
    };
  }

  it('dice que es una devolución, de qué venta, qué regresó y cuánto le quedó a favor', () => {
    const html = armarTicketDevolucion(venta, devolucion(), tienda);
    expect(html).toContain('<div class="tipo">Devolución</div>');
    expect(html).toContain('DEV-1792120547056-B23B');
    expect(html).toContain('POS-1792036260049-468D');
    expect(html).toContain('15 de octubre de 2026, 00:35');
    expect(html).toContain('14 de octubre de 2026, 21:51');
    expect(html).toContain('TIENDA MOROLEON');
    expect(html).toContain('MARTHA LOPEZ RUIZ');
    expect(html).toContain('CAMEL 2/30');
    expect(html).toContain('18.8 kg × $145.00');
    expect(html).toContain('Paquete cerrado 00621999');
    expect(html).toContain('REGRESÓ');
    expect(html).toContain('Le quedó a favor');
    expect(html).toContain('Su saldo a favor hoy<b>$2,726.00</b>');
    expect(html).toContain('No se entregó dinero');
    expect(html).toContain('Este ticket no es un comprobante fiscal.');
    // No es el de la venta.
    expect(html).not.toContain('Gracias por su compra');
    expect(html).not.toContain('TOTAL<');
  });

  it('si se descontó de lo que debía, lo dice, y a favor queda solo lo que sobró', () => {
    const html = armarTicketDevolucion(venta, devolucion({ aplicado_a_deuda: 1000, saldo_favor_hoy: 1726 }), tienda);
    expect(html).toContain('Se descontó de lo que debía');
    expect(html).toContain('$1,000.00');
    expect(html).toMatch(/Le quedó a favor<\/span><span>\$1,726\.00/);
  });

  it('conos sueltos y lo pesado en la báscula se dicen en palabras de la tienda', () => {
    const html = armarTicketDevolucion(venta, devolucion({
      lineas: [
        { detalle_id: 1, hilo: 'ROJO 2/30', como: 'cono', kg: 2.5, piezas: 6, importe: 362.5, codigos: [] },
        { detalle_id: 2, hilo: 'HUESO 2/30', como: 'simple', kg: 1, piezas: null, importe: 145, codigos: [] },
      ],
    }), tienda);
    expect(html).toContain('6 conos sueltos');
    expect(html).toContain('Suelto, pesado en la báscula');
    expect(html).toContain('3.5 kg · 2 artículos');
  });

  it('sin el saldo de hoy no inventa uno', () => {
    expect(armarTicketDevolucion(venta, devolucion({ saldo_favor_hoy: null }), tienda)).not.toContain('saldo a favor hoy');
  });
});

/**
 * LOS TICKETS DE ABONO Y DE ANTICIPO (2026-10-15): el abono a su cuenta, el
 * abono a una nota y el anticipo, cada uno con su banda y lo que queda.
 */
describe('Tickets de abono y de anticipo', () => {
  const tienda = { nombre: 'Hitex' };
  const cliente = { nombre: 'Graciela Ruiz', nombre_comercial: 'Doña Chela', codigo: 'C-0007' };

  function abono(extra: Partial<TicketAbonoCuenta> = {}): TicketAbonoCuenta {
    return {
      id: 41, cliente, fecha: '2026-10-15 10:20:00', monto: 1000, metodo: 'Efectivo', referencia: null, notas: null,
      usuario: 'Lupita Ramos', caja: 'Caja Moroleón', debia: 3000, quedo_debiendo: 2000, debe_hoy: 2000, liquidadas: [],
      ...extra,
    };
  }

  it('abono a su cuenta: cuánto debía, cuánto abonó y con qué, y cuánto quedó debiendo', () => {
    const html = armarTicketAbonoCuenta(abono(), tienda);
    expect(html).toContain('<div class="tipo">Abono</div>');
    expect(html).toContain('AB-41');
    expect(html).toContain('Doña Chela (Graciela Ruiz)');
    expect(html).toContain('C-0007');
    expect(html).toContain('Caja Moroleón');
    expect(html).toContain('A su cuenta');
    expect(html).toContain('Debía');
    expect(html).toContain('$3,000.00');
    expect(html).toContain('ABONÓ');
    expect(html).toContain('Efectivo');
    expect(html).toContain('Quedó debiendo<b>$2,000.00</b>');
    expect(html).not.toContain('Hoy debe');
  });

  it('si con él quedó al corriente y pagó notas, lo dice; al reimprimirlo, cuánto debe hoy', () => {
    const html = armarTicketAbonoCuenta(abono({ quedo_debiendo: 0, debe_hoy: 500, liquidadas: ['POS-1-AAAA', 'POS-2-BBBB'] }), tienda);
    expect(html).toContain('Quedó al corriente');
    expect(html).toContain('quedaron pagadas las notas');
    expect(html).toContain('POS-1-AAAA<br>POS-2-BBBB');
    expect(html).toContain('Hoy debe');
    expect(html).toContain('$500.00');
  });

  it('anticipo: lo que dejó en efectivo y por transferencia, y con cuánto quedó a favor', () => {
    const d: TicketAnticipo = {
      id: 9, cliente, fecha: '2026-10-15 11:00:00', total: 800, notas: 'Para el pedido del sábado',
      partes: [{ metodo: 'Efectivo', monto: 500 }, { metodo: 'Transferencia', monto: 300, referencia: '123456' }],
      usuario: 'Lupita Ramos', caja: 'Caja Moroleón', tenia_a_favor: 200, quedo_a_favor: 1000, a_favor_hoy: 1000,
    };
    const html = armarTicketAnticipo(d, tienda);
    expect(html).toContain('<div class="tipo">Anticipo</div>');
    expect(html).toContain('AN-9');
    expect(html).toContain('Transferencia');
    expect(html).toContain('Referencia: 123456');
    expect(html).toContain('A CUENTA');
    expect(html).toContain('$800.00');
    expect(html).toContain('Ya tenía a favor');
    expect(html).toMatch(/Le quedó a favor<\/span><span>\$1,000\.00/);
    expect(html).toContain('No aparta mercancía');
    expect(html).toContain('Para el pedido del sábado');
    // El saldo de hoy va SIEMPRE en su recuadro (2026-10-16), cambie o no.
    expect(html).toContain('Su saldo a favor hoy<b>$1,000.00</b>');
    expect(armarTicketAnticipo({ ...d, a_favor_hoy: 250 }, tienda)).toContain('Su saldo a favor hoy<b>$250.00</b>');
  });

  it('abono a una nota: a qué nota, cuánto llevaba, cuánto abonó y cuánto le falta (o que quedó pagada)', () => {
    const d: TicketPagoNota = {
      id: 77, cliente, fecha: '2026-10-15 12:00:00', monto: 1500, metodo: 'Transferencia', referencia: 'F-99',
      pedido: { id: 5, numero_pedido: 'POS-1792036260049-468D', creado_en: '2026-10-14 21:51:03', total: 4000, de: 'Nota pendiente de pago' },
      llevaba_pagado: 1000, pagado: 2500, falta: 1500, falta_hoy: 1500,
    };
    const html = armarTicketPagoNota(d, tienda);
    expect(html).toContain('<div class="tipo">Abono</div>');
    expect(html).toContain('PG-77');
    expect(html).toContain('POS-1792036260049-468D');
    expect(html).toContain('Nota pendiente de pago');
    expect(html).toContain('Total de la nota');
    expect(html).toContain('Llevaba pagado');
    expect(html).toContain('Le falta por pagar<b>$1,500.00</b>');
    const pagada = armarTicketPagoNota({ ...d, pagado: 4000, falta: 0, falta_hoy: 0 }, tienda);
    expect(pagada).toContain('Nota pagada completa');
    expect(pagada).not.toContain('Le falta por pagar');
  });

  // DOS FORMAS (2026-10-26): cada una en su renglón, y lo que pasó a su crédito.
  it('abono a una nota con dos formas y lo demás a crédito', () => {
    const d: TicketPagoNota = {
      id: 78, cliente, fecha: '2026-10-26 12:00:00', monto: 1000, metodo: 'Efectivo', referencia: null,
      pedido: { id: 5, numero_pedido: 'POS-1792036260049-468D', creado_en: '2026-10-14 21:51:03', total: 4000, de: 'Nota pendiente de pago' },
      partes: [{ metodo: 'Saldo a favor', monto: 300, referencia: 'Saldo a favor' }, { metodo: 'Efectivo', monto: 700, referencia: null }],
      credito: { monto: 3000, dias: 20, vence_el: '2026-11-15' },
      llevaba_pagado: 0, pagado: 1000, falta: 0, falta_hoy: 0,
    };
    const html = armarTicketPagoNota(d, tienda);
    expect(html).toContain('$1,000.00');
    expect(html).toContain('Saldo a favor');
    expect(html).toContain('$300.00');
    expect(html).toContain('$700.00');
    expect(html).toContain('A su cuenta de crédito');
    expect(html).toContain('$3,000.00');
    expect(html).toContain('A 20 días');
    expect(html).toContain('Lo demás quedó en su cuenta de crédito');
    expect(html).not.toContain('Nota pagada completa');
    // La referencia que solo repite el método no se escribe dos veces.
    expect(html).not.toContain('Referencia: Saldo a favor');
  });
});
