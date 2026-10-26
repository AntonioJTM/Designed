import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DevolucionSolicitud } from './devolucion-solicitud';
import { DetalleDevolucion } from '../../../core/models/autorizaciones.models';
import { AuthService } from '../../../core/services/auth.service';

/**
 * QUÉ REGRESA, en la solicitud de una devolución (2026-10-22, usuario: "qué
 * cliente es, cuántos paquetes regresa, color y lote, pesos e importe").
 */
describe('DevolucionSolicitud', () => {
  const DEV: DetalleDevolucion = {
    venta: { id: 66, folio: 'POS-1792666461856-8066', fecha: '2026-10-21 12:14:00', total: 17794, almacen: 'MATRIZ CUAUTEPEC' },
    cliente: { id: 7, nombre: 'Beto', codigo: 'C-0007', telefono: '7751234567', elegido: false },
    venta_inactiva: false,
    sin_cliente: false,
    destino: 'favor',
    notas: null,
    lineas: [
      {
        detalle_id: 1, hilo: 'BLANCO 1/30', tipo_presentacion: 'paquete', vendido_kg: 77.25, ya_regreso_kg: 0, precio_kg: 155,
        paquetes: 1, kg_paquetes: 19.25, kg_sueltos: 16, conos: 10, sueltos_como: 'conos', kg: 35.25, importe: 5463.75, no_se_puede: 0,
        lotes: [{ lote: '0094217', paquetes: 1, kg: 19.25, bultos: [{ codigo: '00496515', peso_kg: 19.25, lote: '0094217', no_se_puede: false }] }],
      },
    ],
    paquetes: 1, lotes: 1, kg: 35.25, importe: 5463.75, no_se_puede: 0,
    reparto: { debe_esta: 0, debe_esta_tipo: null, de_esta: 0, debe_otras: 0, de_otras: 0, a_favor: 5463.75, favor_hoy: 200, favor_despues: 5663.75 },
  };

  function montar(dev: DetalleDevolucion, permisos: string[] = ['ver:pedidos']) {
    TestBed.configureTestingModule({
      imports: [DevolucionSolicitud],
      providers: [provideRouter([]), { provide: AuthService, useValue: { puede: (k: string) => permisos.includes(k) } }],
    });
    const f = TestBed.createComponent(DevolucionSolicitud);
    f.componentRef.setInput('dev', dev);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('dice el cliente, la venta, el color, el lote, cada paquete con su peso y el importe', () => {
    const el = montar(DEV);
    const t = (el.textContent ?? '').replace(/\s+/g, ' ');
    expect(t).toContain('Beto');
    expect(t).toContain('C-0007');
    expect(t).toContain('POS-1792666461856-8066');
    expect(t).toContain('BLANCO 1/30');
    expect(t).toContain('1 paquete');
    expect(t).toContain('Lote 0094217 · 1 paquete · 19.25 kg');
    expect(t).toContain('00496515');
    expect(t).toContain('16 kg sueltos · 10 conos · entran como conos');
    expect(t).toContain('35.25 kg');
    expect(t).toContain('$155.00');
    expect(t).toContain('$5,463.75');
    expect(t).toContain('Le queda a favor');
    expect(t).toContain('$200.00 → $5,663.75');
    expect(t).toContain('No sale dinero de la caja');
    // La venta se abre en Ventas.
    expect(el.querySelector('a.mono')?.getAttribute('href')).toBe('/admin/ventas/66');
  });

  it('sin poder ver Ventas, el folio no es enlace', () => {
    const el = montar(DEV, []);
    expect(el.querySelector('a.mono')).toBeNull();
    expect(el.textContent).toContain('POS-1792666461856-8066');
  });

  it('si esta nota todavía se debe, primero se descuenta de ella', () => {
    const el = montar({
      ...DEV, destino: 'deuda',
      reparto: { debe_esta: 3000, debe_esta_tipo: 'credito', de_esta: 3000, debe_otras: 1000, de_otras: 1000, a_favor: 1463.75, favor_hoy: 0, favor_despues: 1463.75 },
    });
    const t = (el.textContent ?? '').replace(/\s+/g, ' ');
    expect(t).toContain('Se descuenta de esta nota a crédito (debe $3,000.00)');
    expect(t).toContain('Se descuenta de lo demás que debe (debe $1,000.00)');
    expect(t).toContain('$1,463.75');
  });

  it('avisa si la venta ya se canceló o si no hay a quién ponerle el saldo', () => {
    const el = montar({ ...DEV, venta_inactiva: true, sin_cliente: true, cliente: null });
    const t = el.textContent ?? '';
    expect(t).toContain('La venta ya está cancelada o devuelta');
    expect(t).toContain('No hay a quién ponerle lo que regresa');
    expect(t).toContain('Sin cliente');
  });

  it('el paquete que ya no se puede regresar cerrado va en rojo y se avisa', () => {
    const l = DEV.lineas[0];
    const el = montar({
      ...DEV, no_se_puede: 1,
      lineas: [{ ...l, no_se_puede: 1, lotes: [{ ...l.lotes[0], bultos: [{ ...l.lotes[0].bultos[0], no_se_puede: true }] }] }],
    });
    expect(el.textContent).toContain('1 paquete ya no se puede regresar cerrado');
    expect(el.querySelector('.ficha-paquete.no-se-puede')).not.toBeNull();
  });
});
