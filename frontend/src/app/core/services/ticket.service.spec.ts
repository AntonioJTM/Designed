import { TestBed } from '@angular/core/testing';
import { Observable, firstValueFrom, of } from 'rxjs';
import { TicketService } from './ticket.service';
import { PaqueteWhatsapp, WhatsappService } from './whatsapp.service';
import { TiendaService } from './tienda.service';
import { ClientesService } from './clientes.service';
import { VentasService } from './ventas.service';
import { Pedido } from '../models/ventas.models';
import { TicketAnticipo } from '../models/tickets.models';

/**
 * Lo que se le manda por WhatsApp de cada ticket (2026-10-16): el PDF de ESE
 * ticket, su nombre de archivo, el mensaje corto y el teléfono del cliente.
 */
describe('TicketService · por WhatsApp', () => {
  let preparado: Observable<PaqueteWhatsapp> | null;
  let titulo: string | null;

  const venta = (extra: Partial<Pedido> = {}) => ({
    id: 7, numero_pedido: 'POS-1792036260049-468D', canal: 'punto_venta', metodo_entrega: 'recoger', estado: 'pagado',
    inventario_descontado: 1, cliente: 'MARTHA LOPEZ RUIZ', cliente_telefono: null, cliente_telefono_alt: '7751234567',
    subtotal: '2820.25', descuento: '0', impuestos: '0', costo_envio: '0', total: '2820.25', creado_en: '2026-10-15 23:10:00',
    detalle: [], pagos: [{ id: 1, metodo_pago_id: 1, metodo: 'Efectivo', monto: '2820.25', estado: 'completado', creado_en: '2026-10-15 23:10:00' }],
    ...extra,
  } as unknown as Pedido);

  const anticipo: TicketAnticipo = {
    id: 9, cliente: { id: 3, nombre: 'JUAN PEREZ', codigo: 'C-0003', telefono: '445 111 2222' }, fecha: '2026-10-16 10:00:00',
    total: 800, partes: [{ metodo: 'Efectivo', monto: 800 }], tenia_a_favor: 0, quedo_a_favor: 800, a_favor_hoy: 800,
  };

  beforeEach(() => {
    preparado = null;
    titulo = null;
    TestBed.configureTestingModule({
      providers: [
        { provide: WhatsappService, useValue: { abrir: (t: string, p: Observable<PaqueteWhatsapp>) => { titulo = t; preparado = p; } } },
        { provide: TiendaService, useValue: { configuracion: () => of({ ticket_papel_mm: '80' }) } },
        { provide: ClientesService, useValue: { ticketAnticipo: () => of(anticipo) } },
        { provide: VentasService, useValue: { obtenerPedido: () => of(venta()) } },
      ],
    });
  });

  it('la venta: su PDF, "Ticket de venta POS-468D.pdf", el mensaje con el total y su teléfono', async () => {
    TestBed.inject(TicketService).whatsappPedido(venta());
    expect(titulo).toBe('Ticket POS-468D');
    const p = await firstValueFrom(preparado!);
    expect(p.titulo).toBe('Ticket de venta POS-468D');
    expect(p.archivo).toBe('Ticket de venta POS-468D.pdf');
    expect(p.mensaje).toBe('Hola Martha Lopez Ruiz, le mandamos su ticket de venta POS-468D por $2,820.25. ¡Gracias por su compra! — Hitex');
    // Sin el primero, el segundo teléfono.
    expect(p.telefono).toBe('7751234567');
    expect(p.pdf.type).toBe('application/pdf');
    expect(p.pdf.size).toBeGreaterThan(1000);
  });

  it('la venta cancelada se dice así, sin el "gracias por su compra"', async () => {
    TestBed.inject(TicketService).whatsappPedido(venta({ estado: 'cancelado' }));
    const p = await firstValueFrom(preparado!);
    expect(p.archivo).toBe('Ticket de venta cancelada POS-468D.pdf');
    expect(p.mensaje).toBe('Hola Martha Lopez Ruiz, le mandamos el ticket de su venta cancelada POS-468D. — Hitex');
  });

  it('el anticipo: AN-9, por cuánto, y el teléfono que trae el ticket', async () => {
    TestBed.inject(TicketService).whatsappAnticipo(3, 9);
    expect(titulo).toBe('Ticket del anticipo');
    const p = await firstValueFrom(preparado!);
    expect(p.archivo).toBe('Anticipo AN-9.pdf');
    expect(p.mensaje).toContain('el ticket de su anticipo AN-9 por $800.00');
    expect(p.telefono).toBe('445 111 2222');
    // De quién es y qué teléfonos tiene: para guardarle el que se escriba.
    expect(p.clienteId).toBe(3);
    expect(p.telefonoPrincipal).toBe('445 111 2222');
    expect(p.telefonoAlt).toBeNull();
  });

  it('una nota en espera no lleva ticket: la ventana lo dice', async () => {
    TestBed.inject(TicketService).whatsappPedido(venta({ encargo: 1, inventario_descontado: 0, estado: 'en_preparacion' } as Partial<Pedido>));
    await expectAsync(firstValueFrom(preparado!)).toBeRejectedWithError(/nota en espera no lleva ticket/);
  });
});
