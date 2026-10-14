import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { NotasPendientesPantalla } from './notas-pendientes';
import { PagoNotaModal } from './pago-nota-modal';
import { VentasService } from '../../../core/services/ventas.service';
import { AuthService } from '../../../core/services/auth.service';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';
import { NotaPendiente } from '../../../core/models/ventas.models';

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
  const ventas = {
    notasPendientes: () => of({ items: [nota], por_cobrar: 1350, num_notas: 1, num_clientes: 1, mas_antigua_dias: 3 }),
    pasarACredito: (id: number) => {
      pasada = id;
      return of({ id, estado: 'pendiente', a_credito: 1350 });
    },
  };

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [NotasPendientesPantalla],
      providers: [
        provideRouter([]),
        { provide: VentasService, useValue: ventas },
        { provide: AuthService, useValue: { puede: (k: string) => permisos.has(k) } },
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

  it('pasar a crédito pregunta y dice cuánto se cargó', async () => {
    const f = await montar();
    await f.componentInstance.pasarACredito(nota);
    expect(pasada).toBe(7);
    expect(f.componentInstance.mensaje()).toContain('$1,350.00 pasaron a la cuenta de crédito de Doña Chela');
  });

  it('al registrar el último pago dice que quedó pagada', async () => {
    const f = await montar();
    f.componentInstance.alPagar({ pedido_id: 7, numero_pedido: 'POS-1-AAAA', total: 2350, abonado: 2350, pendiente: 0, liquidado: true });
    expect(f.componentInstance.mensaje()).toBe('POS-1-AAAA quedó pagada.');
  });
});

describe('PagoNotaModal', () => {
  let enviado: unknown = null;
  const ventas = {
    metodosPago: () => of([{ id: 1, nombre: 'Efectivo' }, { id: 3, nombre: 'Transferencia' }]),
    cajas: () => of([{ id: 5, nombre: 'Caja 1', activo: 1 }]),
    sesionAbierta: () => of({ id: 70, caja_id: 5, caja: 'Caja 1', estado: 'abierta' }),
    pagarNota: (_id: number, body: unknown) => {
      enviado = body;
      return of({ pedido_id: 7, numero_pedido: 'POS-1-AAAA', total: 2350, abonado: 1500, pendiente: 850, liquidado: false });
    },
  };

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [PagoNotaModal],
      providers: [{ provide: VentasService, useValue: ventas }],
    }).compileComponents();
    const f = TestBed.createComponent(PagoNotaModal);
    f.componentRef.setInput('nota', nota);
    f.detectChanges();
    await f.whenStable();
    return f.componentInstance;
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    enviado = null;
  });

  it('propone lo que falta, en efectivo, y el efectivo entra al único turno abierto', async () => {
    const c = await montar();
    expect(c.monto).toBe(1350);
    expect(c.esEfectivo()).toBe(true);
    c.monto = 500;
    expect(c.quedaria()).toBe(850);
    c.registrar();
    expect(enviado).toEqual({ monto: 500, metodo_pago_id: 1, sesion_caja_id: 70, referencia: undefined });
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
    c.metodoId = 3;
    c.registrar();
    expect(enviado).toEqual({ monto: 1350, metodo_pago_id: 3, sesion_caja_id: undefined, referencia: undefined });
  });
});
