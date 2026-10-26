import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { NotasPendientesPantalla } from './notas-pendientes';
import { PagoNotaModal } from './pago-nota-modal';
import { VentasService } from '../../../core/services/ventas.service';
import { AuthService } from '../../../core/services/auth.service';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';
import { NotaPendiente } from '../../../core/models/ventas.models';
import { TransferenciasService } from '../../../core/services/transferencias.service';
import { transferenciasFalso } from '../../../core/services/transferencias.falso';

/**
 * NOTAS PENDIENTES DE PAGO (2026-10-13): lo que se llevaron sin pagar. Se paga
 * en partes (el efectivo entra al turno: al corte de ese día) o se pasa a
 * crédito, con el permiso de vender a crédito.
 */
const nota: NotaPendiente = {
  id: 7, numero_pedido: 'POS-1-AAAA', total: 2350, creado_en: '2026-10-10 10:00:00', almacen_id: 1, almacen: 'Tienda',
  cliente_id: 20, cliente: 'Graciela Ruiz', nombre_comercial: 'Doña Chela', telefono: '4450000001', limite_credito: '5000',
  vendedor: 'Lupita', dias: 3, pagado: 1000, falta: 1350,
  hilos: [{ hilo: 'ROJO 2/30', tipo_presentacion: 'paquete', kg: 18.5, piezas: null, paquetes: 1 }],
};

describe('NotasPendientesPantalla', () => {
  let permisos: Set<string>;
  let pasada: number | null;
  let cuerpoCredito: unknown = null;
  const ventas = {
    notasPendientes: () => of({ items: [nota], por_cobrar: 1350, num_notas: 1, num_clientes: 1, mas_antigua_dias: 3 }),
    pasarACredito: (id: number, body: unknown) => {
      pasada = id;
      cuerpoCredito = body;
      return of({ id, estado: 'pendiente', a_credito: 1350 });
    },
  };

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [NotasPendientesPantalla],
      providers: [{ provide: TransferenciasService, useValue: transferenciasFalso() }, 
        provideRouter([]),
        { provide: VentasService, useValue: ventas },
        { provide: AuthService, useValue: { puede: (k: string) => permisos.has(k), puedeOPide: (k: string) => permisos.has(k) } },
        { provide: ConfirmacionService, useValue: { pedir: () => Promise.resolve(true) } },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(NotasPendientesPantalla);
    f.detectChanges();
    return f;
  }

  beforeEach(() => {
    permisos = new Set(['ver:clientes', 'hacer:fiar']);
    pasada = null;
    cuerpoCredito = null;
  });
  afterEach(() => TestBed.resetTestingModule());

  it('enseña quién debe, qué se llevó y cuánto falta', async () => {
    const f = await montar();
    const texto = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Doña Chela');
    expect(texto).toContain('ROJO 2/30 · 18.5 kg · 1 paquete');
    expect(texto).toContain('$1,350.00');
    expect(texto).toContain('hace 3 días');
    expect(texto).toContain('Registrar pago');
    expect(texto).toContain('Pasar a crédito');
  });

  it('sin el permiso de vender a crédito no ofrece pasarla a crédito', async () => {
    permisos = new Set(['ver:clientes']);
    const f = await montar();
    expect((f.nativeElement as HTMLElement).textContent).not.toContain('Pasar a crédito');
  });

  it('pasar a crédito pide A CUÁNTOS DÍAS (2026-10-20) y dice cuánto se cargó', async () => {
    const f = await montar();
    f.componentInstance.pasarACredito(nota);
    expect(f.componentInstance.aCredito()).toBe(nota);
    expect(f.componentInstance.diasCredito).toBe(15);
    f.componentInstance.diasCredito = 30;
    f.componentInstance.confirmarACredito();
    expect(pasada).toBe(7);
    expect(cuerpoCredito).toEqual({ dias_credito: 30 });
    expect(f.componentInstance.mensaje()).toContain('$1,350.00 pasaron a la cuenta de crédito de Doña Chela');
  });

  it('si lo demás pasó a crédito, lo dice', async () => {
    const f = await montar();
    f.componentInstance.alPagar({ pedido_id: 7, pago_id: 9, numero_pedido: 'POS-1-AAAA', total: 2350, abonado: 1350, pendiente: 0, liquidado: false, a_credito: 1000 });
    expect(f.componentInstance.mensaje()).toBe('POS-1-AAAA: $1,000.00 pasaron a su cuenta de crédito y se registró lo que pagó hoy.');
  });

  it('al registrar el último pago dice que quedó pagada', async () => {
    const f = await montar();
    f.componentInstance.alPagar({ pedido_id: 7, numero_pedido: 'POS-1-AAAA', total: 2350, abonado: 2350, pendiente: 0, liquidado: true });
    expect(f.componentInstance.mensaje()).toBe('POS-1-AAAA quedó pagada.');
  });
});

describe('PagoNotaModal', () => {
  let enviado: unknown = null;
  let permisosModal = new Set(['hacer:fiar']);
  const ventas = {
    metodosPago: () => of([{ id: 1, nombre: 'Efectivo' }, { id: 3, nombre: 'Transferencia' }]),
    cajas: () => of([{ id: 5, nombre: 'Caja 1', activo: 1 }]),
    sesionAbierta: () => of({ id: 70, caja_id: 5, caja: 'Caja 1', estado: 'abierta' }),
    pagarNota: (_id: number, body: unknown) => {
      enviado = body;
      return of({ pedido_id: 7, numero_pedido: 'POS-1-AAAA', total: 2350, abonado: 1500, pendiente: 850, liquidado: false });
    },
  };

  async function montarF(n: NotaPendiente = nota) {
    await TestBed.configureTestingModule({
      imports: [PagoNotaModal],
      providers: [
        { provide: TransferenciasService, useValue: transferenciasFalso() }, { provide: VentasService, useValue: ventas },
        { provide: AuthService, useValue: { puede: (k: string) => permisosModal.has(k), puedeOPide: (k: string) => permisosModal.has(k) } },
        { provide: ConfirmacionService, useValue: { pedir: () => Promise.resolve(true) } },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(PagoNotaModal);
    f.componentRef.setInput('nota', n);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return f;
  }
  const montar = async (n: NotaPendiente = nota) => (await montarF(n)).componentInstance;

  afterEach(() => {
    TestBed.resetTestingModule();
    enviado = null;
    permisosModal = new Set(['hacer:fiar']);
  });

  it('propone lo que falta, en efectivo, y el efectivo entra al único turno abierto', async () => {
    const c = await montar();
    expect(c.monto).toBe(1350);
    expect(c.esEfectivo()).toBe(true);
    c.monto = 500;
    expect(c.quedaria()).toBe(850);
    c.registrar();
    expect(enviado).toEqual({ partes: [{ metodo_pago_id: 1, monto: 500, referencia: undefined }], sesion_caja_id: 70 });
  });

  it('no deja cobrar más de lo que falta', async () => {
    const c = await montar();
    c.monto = 2000;
    c.registrar();
    expect(c.error()).toContain('Le faltan $1,350.00');
    expect(enviado).toBeNull();
  });

  it('por transferencia no toca la caja', async () => {
    const c = await montar();
    c.cambiarForma(3);
    c.registrar();
    expect(enviado).toEqual({ partes: [{ metodo_pago_id: 3, monto: 1350, referencia: undefined }], sesion_caja_id: undefined });
  });

  // HASTA DOS FORMAS (2026-10-26, usuario: "múltiples formas de pago: crédito, efectivo y
  // transferencia o aplicación de saldo a favor"). Le faltan $1,350.00.
  it('efectivo y crédito: lo de hoy al turno y el resto a su cuenta, con sus días', async () => {
    const c = await montar();
    c.cambiarForma('efectivo_credito');
    expect(c.pideMonto()).toBe(false);
    expect(c.motivo()).toBe('Pon cuánto paga hoy en efectivo.');
    c.parte = 350;
    expect(c.aCredito()).toBe(1000);
    expect(c.ayudaParte()).toBe('El resto, $1,000.00, va a crédito.');
    expect(c.reparto()).toBe('Paga $350.00 en efectivo y $1,000.00 a su cuenta de crédito.');
    expect(c.textoBoton()).toBe('Registrar $350.00 y lo demás a crédito');
    c.registrar();
    expect(enviado).toEqual({
      partes: [{ metodo_pago_id: 1, monto: 350, referencia: undefined }], sesion_caja_id: 70, a_credito: true, dias_credito: 15,
    });
  });

  it('todo a crédito: no se cobra nada hoy', async () => {
    const c = await montar();
    c.cambiarForma('credito');
    expect(c.aCredito()).toBe(1350);
    expect(c.textoBoton()).toBe('Pasarla a crédito');
    c.registrar();
    expect(enviado).toEqual({ partes: undefined, sesion_caja_id: undefined, a_credito: true, dias_credito: 15 });
  });

  it('efectivo y transferencia: lo que paga hoy, parte y parte', async () => {
    const c = await montar();
    c.cambiarForma('mixto');
    c.parte = 1350;
    expect(c.motivo()).toContain('elige solo «Transferencia»');
    c.parte = 350;
    c.registrar();
    expect(enviado).toEqual({
      partes: [{ metodo_pago_id: 3, monto: 350, referencia: undefined }, { metodo_pago_id: 1, monto: 1000, referencia: undefined }],
      sesion_caja_id: 70,
    });
  });

  it('con su saldo a favor: lo usa todo y el resto en efectivo o a crédito', async () => {
    let c = await montar({ ...nota, saldo_favor: 300 });
    c.cambiarForma('saldo_efectivo');
    expect(c.saldoUsado()).toBe(300);
    expect(c.enEfectivo()).toBe(1050);
    c.registrar();
    expect(enviado).toEqual({
      partes: [{ con_saldo_favor: true, monto: 300 }, { metodo_pago_id: 1, monto: 1050, referencia: undefined }], sesion_caja_id: 70,
    });
    TestBed.resetTestingModule();
    c = await montar({ ...nota, saldo_favor: 300 });
    c.cambiarForma('saldo_credito');
    expect(c.aCredito()).toBe(1050);
    c.registrar();
    expect(enviado).toEqual({ partes: [{ con_saldo_favor: true, monto: 300 }], sesion_caja_id: undefined, a_credito: true, dias_credito: 15 });
  });

  it('la lista ofrece una forma o dos, y el crédito solo con «Vender a crédito»', async () => {
    const opciones = (f: { nativeElement: HTMLElement }) =>
      [...f.nativeElement.querySelectorAll('select[name="forma"] option')].map((o) => o.textContent?.trim()).filter((t) => t !== 'Elige…');
    let f = await montarF({ ...nota, saldo_favor: 300 });
    expect(opciones(f)).toEqual([
      'Efectivo', 'Transferencia', 'A crédito', 'Su saldo a favor (tiene $300.00)',
      'Efectivo y transferencia', 'Efectivo y crédito', 'Transferencia y crédito',
      'Saldo a favor y efectivo', 'Saldo a favor y transferencia', 'Saldo a favor y crédito',
    ]);
    TestBed.resetTestingModule();
    permisosModal = new Set();
    f = await montarF();
    expect(opciones(f)).toEqual(['Efectivo', 'Transferencia', 'Efectivo y transferencia']);
  });
});
