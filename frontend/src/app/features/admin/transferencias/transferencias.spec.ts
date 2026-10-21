import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { Transferencias } from './transferencias';
import { TransferenciaModal } from './transferencia-modal';
import { TransferenciasService } from '../../../core/services/transferencias.service';
import { transferenciasFalso } from '../../../core/services/transferencias.falso';
import { AuthService } from '../../../core/services/auth.service';
import { TiempoRealService } from '../../../core/services/tiempo-real.service';
import { ListaTransferencias, Transferencia } from '../../../core/models/transferencias.models';

/**
 * TRANSFERENCIAS (2026-10-20): la lista de lo que entró por transferencia, como
 * la hoja del usuario, con sus cifras, a qué cuenta llegó, y marcarlas
 * procesadas o facturadas (varias de una vez).
 */
describe('Transferencias', () => {
  const renglon = (x: Partial<Transferencia>): Transferencia => ({
    clave: 'pago-1', fuente: 'pago', fuente_id: 1, fecha: '2026-10-19 13:42:00', importe: 1225.25,
    referencia: '50118293TRANSBPI76116035', cliente_id: 4, cliente: 'GUSTAVO BARRAGAN CASTRO', cliente_codigo: 'C-0004',
    de: 'venta', cancelada: false, ventas: [{ id: 2437, folio: 'POS-1790000000000-2437', estado: 'pagado' }],
    materiales: 'ACRILAN', cuenta_bancaria_id: 7, cuenta: 'Banamex', cuenta_ultimos: '4521',
    estado: 'procesada', facturada: false, revisada_por: 'Antonio', revisada_en: '2026-10-19 15:00:00',
    facturada_por: null, facturada_en: null, ...x,
  });

  const lista: ListaTransferencias = {
    items: [
      renglon({}),
      renglon({
        clave: 'abono-9', fuente: 'abono', fuente_id: 9, importe: 14390, referencia: null, cliente: 'RAUL HERNANDEZ CASTILLO',
        de: 'abono', ventas: [{ id: 2164, folio: 'POS-1790000000001-2164', estado: 'pagado' }, { id: 2323, folio: 'POS-1790000000002-2323', estado: 'pagado' }],
        estado: 'por_revisar', cuenta_bancaria_id: null, cuenta: null, cuenta_ultimos: null,
      }),
      renglon({
        clave: 'anticipo-3', fuente: 'anticipo', fuente_id: 3, importe: 16920, de: 'anticipo', ventas: [], materiales: null,
        cliente: 'SIMON HERNANDEZ', estado: 'por_revisar', facturada: true,
      }),
    ],
    total: 3,
    cifras: {
      cuantas: 3, importe: 32535.25, por_revisar: 2, importe_por_revisar: 31310, importe_procesado: 1225.25,
      sin_facturar: 2, importe_sin_facturar: 15615.25, sin_cuenta: 1, importe_cancelado: 0,
    },
    por_cuenta: [
      { id: 7, banco: 'Banamex', ultimos: '4521', cuantas: 2, importe: 18145.25 },
      { id: null, banco: null, ultimos: null, cuantas: 1, importe: 14390 },
    ],
    limit: 100, offset: 0, hay_mas: false,
  };

  let marcadas: { claves: string[]; cambios: unknown } | null;
  let pedidos: unknown[];
  let puede: boolean;

  async function montar() {
    const falso = {
      ...transferenciasFalso([{ id: 7, banco: 'Banamex', titular: null, ultimos: '4521' }]),
      listar: (f: unknown) => { pedidos.push(f); return of(lista); },
      marcar: (claves: string[], cambios: unknown) => { marcadas = { claves, cambios }; return of({ marcadas: claves.length }); },
    };
    await TestBed.configureTestingModule({
      imports: [Transferencias],
      providers: [
        provideRouter([]),
        { provide: TransferenciasService, useValue: falso },
        { provide: AuthService, useValue: { puede: () => puede, sesion: signal(null) } },
        { provide: TiempoRealService, useValue: { cambios: () => of() } },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(Transferencias);
    f.detectChanges();
    return f;
  }

  beforeEach(() => {
    marcadas = null;
    pedidos = [];
    puede = true;
  });
  afterEach(() => TestBed.resetTestingModule());

  it('enseña cada transferencia como la hoja: fecha, folios, cliente, cuenta, operación, material, importe, estado y facturada', async () => {
    const f = await montar();
    const texto = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('$32,535.25');
    expect(texto).toContain('GUSTAVO BARRAGAN CASTRO');
    expect(texto).toContain('Banamex …4521');
    expect(texto).toContain('50118293TRANSBPI76116035');
    expect(texto).toContain('ACRILAN');
    expect(texto).toContain('Procesada');
    expect(texto).toContain('Por revisar');
    // El abono a dos notas va en UN renglón con sus dos folios; sin cuenta lo dice.
    expect(texto).toContain('POS-2164');
    expect(texto).toContain('POS-2323');
    expect(texto).toContain('Sin cuenta');
    expect(texto).toContain('S/N');
    expect(texto).toContain('Anticipo');
  });

  it('por omisión pide TODAS (sin periodo) y los filtros van al servidor', async () => {
    const f = await montar();
    const c = f.componentInstance;
    expect(c.periodo()).toBe('todo');
    c.estado = 'por_revisar';
    c.cuenta = 'sin';
    c.facturada = 'no';
    c.buscar();
    expect(pedidos[pedidos.length - 1]).toEqual(jasmine.objectContaining({ estado: 'por_revisar', cuenta: 'sin', facturada: false }));
  });

  it('se eligen varias y se marcan procesadas de una vez', async () => {
    const f = await montar();
    const c = f.componentInstance;
    c.alternar(lista.items[1], true);
    c.alternar(lista.items[2], true);
    expect(c.importeElegidas()).toBe(31310);
    c.marcar({ estado: 'procesada' });
    expect(marcadas).toEqual({ claves: ['abono-9', 'anticipo-3'], cambios: { estado: 'procesada' } });
    expect(c.mensaje()).toContain('2 transferencias quedaron procesadas');
    expect(c.elegidas().size).toBe(0);
  });

  it('sin «Revisar transferencias» no se ofrece elegir ni corregir', async () => {
    puede = false;
    const f = await montar();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('input[type=checkbox]')).toBeNull();
    expect(el.querySelector('button[title=Corregir]')).toBeNull();
  });
});

describe('TransferenciaModal', () => {
  it('guarda la cuenta, el número de operación, el estado y si se facturó', async () => {
    let enviado: unknown = null;
    const t: Transferencia = {
      clave: 'pago-1', fuente: 'pago', fuente_id: 1, fecha: '2026-10-19 13:42:00', importe: 1225.25, referencia: null,
      cliente_id: 4, cliente: 'GUSTAVO', cliente_codigo: 'C-0004', de: 'venta', cancelada: false, ventas: [],
      materiales: null, cuenta_bancaria_id: null, cuenta: null, cuenta_ultimos: null, estado: 'por_revisar',
      facturada: false, revisada_por: null, revisada_en: null, facturada_por: null, facturada_en: null,
    };
    const falso = {
      ...transferenciasFalso([{ id: 7, banco: 'Banamex', titular: null, ultimos: '4521' }]),
      actualizar: (clave: string, cambios: unknown) => { enviado = { clave, cambios }; return of({ ...t, estado: 'procesada' }); },
    };
    await TestBed.configureTestingModule({
      imports: [TransferenciaModal],
      providers: [{ provide: TransferenciasService, useValue: falso }],
    }).compileComponents();
    const f = TestBed.createComponent(TransferenciaModal);
    f.componentRef.setInput('transferencia', t);
    f.detectChanges();
    const c = f.componentInstance;
    let guardada: Transferencia | null = null;
    c.guardado.subscribe((x) => (guardada = x));
    c.cuentaId = 7;
    c.referencia = ' 670338 ';
    c.estado = 'procesada';
    c.facturada = true;
    c.guardar();
    expect(enviado).toEqual({
      clave: 'pago-1',
      cambios: { cuenta_bancaria_id: 7, referencia: '670338', estado: 'procesada', facturada: true },
    });
    expect(guardada!.estado).toBe('procesada');
    TestBed.resetTestingModule();
  });
});
