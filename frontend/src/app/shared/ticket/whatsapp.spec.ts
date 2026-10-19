import { enlaceWhatsapp, mensajeWhatsapp, nombrePropio, numeroWhatsapp } from './whatsapp';

/**
 * Mandar un ticket por WhatsApp (2026-10-16): el número del cliente, el enlace
 * de su chat y el mensaje que acompaña al PDF.
 */
describe('WhatsApp: número, enlace y mensaje', () => {
  it('un celular de México (10 números) lleva el 52 adelante, como lo pide WhatsApp', () => {
    expect(numeroWhatsapp('775 123 4567')).toEqual({ numero: '527751234567', problema: null });
    expect(numeroWhatsapp('(775) 123-4567')).toEqual({ numero: '527751234567', problema: null });
    // Ya con su clave, o con el "1" de antes, también sirve.
    expect(numeroWhatsapp('+52 775 123 4567').numero).toBe('527751234567');
    expect(numeroWhatsapp('521 775 123 4567').numero).toBe('527751234567');
  });

  it('vacío no es un error (se elige el contacto); uno incompleto sí lo dice', () => {
    expect(numeroWhatsapp('')).toEqual({ numero: null, problema: null });
    expect(numeroWhatsapp(null)).toEqual({ numero: null, problema: null });
    const corto = numeroWhatsapp('775 123');
    expect(corto.numero).toBeNull();
    expect(corto.problema).toContain('lleva 10 (van 6)');
    // Uno de otro país, solo con "+" y su clave.
    expect(numeroWhatsapp('+1 555 123 4567').numero).toBe('15551234567');
    expect(numeroWhatsapp('1 555 123 4567 8').problema).toContain('otro país');
  });

  it('el enlace abre su chat con el mensaje escrito; sin número, WhatsApp pide el contacto', () => {
    expect(enlaceWhatsapp('527751234567', 'Hola, su ticket')).toBe('https://wa.me/527751234567?text=Hola%2C%20su%20ticket');
    expect(enlaceWhatsapp(null, 'Hola')).toBe('https://wa.me/?text=Hola');
  });

  it('el saludo va con el nombre bien escrito, y el mensaje es corto', () => {
    expect(nombrePropio('MARTHA LOPEZ RUIZ')).toBe('Martha Lopez Ruiz');
    expect(nombrePropio('MARIA DE LA LUZ')).toBe('Maria de la Luz');
    expect(mensajeWhatsapp('MARTHA LOPEZ RUIZ', 'su ticket de venta POS-468D por $2,820.25', 'Hitex', true))
      .toBe('Hola Martha Lopez Ruiz, le mandamos su ticket de venta POS-468D por $2,820.25. ¡Gracias por su compra! — Hitex');
    expect(mensajeWhatsapp(null, 'el ticket de su venta cancelada POS-468D', 'Hitex'))
      .toBe('Hola, le mandamos el ticket de su venta cancelada POS-468D. — Hitex');
  });
});
