import { Pedido } from '../../core/models/ventas.models';
import { SIN_TICKET, armarTicket, llevaTicket, papelDe, prepararHoja, telefonoLegible, tipoDeTicket, armarPrueba } from './ticket';

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
