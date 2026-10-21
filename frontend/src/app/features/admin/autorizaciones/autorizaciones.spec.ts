import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { Autorizaciones, partirResumen } from './autorizaciones';
import { AutorizacionesService } from '../../../core/services/autorizaciones.service';
import { TiempoRealService } from '../../../core/services/tiempo-real.service';
import { Autorizacion } from '../../../core/models/autorizaciones.models';

/**
 * AUTORIZACIONES, fase 2 (2026-10-19): un pedido a otra tienda se autoriza por
 * renglón ("de esos 20, que solo autorice 10").
 */
describe('Autorizaciones', () => {
  const PEDIDO: Autorizacion = {
    id: 9, operacion: 'surtir_sucursal', operacion_nombre: 'Pedir mercancía a otra tienda', estado: 'pendiente',
    resumen: 'Moroleón le pide a Matriz: NEGRO 2/30 · 20 paquetes; OPTIK 2/30 · 3 paquetes', almacenes: [1, 9],
    solicitante_id: 4, solicitante: 'Carlos', solicitado_en: '2026-10-19 10:00:00', autorizador_id: null, autorizador: null,
    en_el_momento: false, resuelto_en: null, motivo: null, ultimo_error: null, interrumpida: false, tiendas: ['Matriz', 'Moroleón'],
    ajustable: true, nota_aprobacion: null, aviso: null,
    detalle: {
      origen: 'Matriz',
      lineas: [
        { variante_id: 11, hilo: 'NEGRO 2/30', unidad: 'paquetes', pedido: 20, en_origen: 15 },
        { variante_id: 12, hilo: 'OPTIK 2/30', unidad: 'paquetes', pedido: 3, en_origen: 8 },
      ],
    },
  };
  let aprobados: { id: number; ajustes?: unknown }[];

  async function montar() {
    aprobados = [];
    await TestBed.configureTestingModule({
      imports: [Autorizaciones],
      providers: [
        {
          provide: AutorizacionesService,
          useValue: {
            listar: () => of({ vista: 'por_autorizar', por_autorizar: 1, filas: [PEDIDO] }),
            rechazar: () => throwError(() => ({ error: { error: { code: 'YA_RESUELTA', message: 'Esa solicitud ya se resolvió.' } } })),
            aprobar: (id: number, ajustes?: unknown) => {
              aprobados.push({ id, ajustes });
              return of({ ...PEDIDO, estado: 'aprobada', nota_aprobacion: 'Autorizó menos de lo pedido: NEGRO 2/30: 10 de 20 paquetes.' });
            },
          },
        },
        { provide: TiempoRealService, useValue: { cambios: () => new Subject<void>() } },
        provideRouter([]),
      ],
    }).compileComponents();
    const f = TestBed.createComponent(Autorizaciones);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return f;
  }

  it('"Aceptar…" de un pedido abre sus renglones con lo pedido y lo que hay en el origen', async () => {
    const f = await montar();
    const el = f.nativeElement as HTMLElement;
    const boton = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Aceptar…'))!;
    boton.click();
    f.detectChanges();
    expect(aprobados.length).toBe(0);
    expect(el.querySelector('#ajuste-titulo')?.textContent).toContain('Autorizar el pedido');
    expect(el.textContent).toContain('Hay en Matriz');
    expect(el.textContent).toContain('Se autoriza todo: 23 paquetes.');
  });

  it('autorizar 10 de 20: manda solo eso y dice qué se autorizó', async () => {
    const f = await montar();
    const c = f.componentInstance;
    c.aceptar(PEDIDO);
    c.cuanto[11] = 10;
    f.detectChanges();
    expect(c.resumenAjuste(PEDIDO)).toBe('Se autorizan 13 de 23 paquetes.');
    c.autorizarAjustado();
    expect(aprobados).toEqual([{ id: 9, ajustes: { items: [{ variante_id: 11, paquetes: 10 }, { variante_id: 12, paquetes: 3 }] } }]);
    expect(c.mensaje()).toContain('10 de 20 paquetes');
  });

  it('más de lo pedido, decimales o todo en cero no se autoriza', async () => {
    const f = await montar();
    const c = f.componentInstance;
    c.aceptar(PEDIDO);
    c.cuanto[11] = 21;
    expect(c.ajusteValido(PEDIDO)).toBeFalse();
    c.cuanto[11] = 2.5;
    expect(c.ajusteValido(PEDIDO)).toBeFalse();
    c.cuanto[11] = 0;
    c.cuanto[12] = 0;
    expect(c.ajusteValido(PEDIDO)).toBeFalse();
    c.autorizarAjustado();
    expect(aprobados.length).toBe(0);
  });

  it('un tipo de gasto nuevo se acepta con el límite que decide quien autoriza (2026-10-20)', async () => {
    const f = await montar();
    const c = f.componentInstance;
    const tipo = { ...PEDIDO, id: 12, operacion: 'tipo_gasto', operacion_nombre: 'Nuevo tipo de gasto',
      resumen: 'Nuevo tipo de gasto «Fletes» con límite de $500.00 por gasto', detalle: { tipo_gasto: { nombre: 'Fletes', limite: 500 } } };
    await c.aceptar(tipo);
    f.detectChanges();
    expect(c.ajustandoTipo()).toBe(tipo);
    expect(c.limiteTipo).toBe(500);
    expect((f.nativeElement as HTMLElement).textContent).toContain('Autorizar el tipo de gasto');
    c.limiteTipo = 750;
    c.autorizarTipo();
    expect(aprobados).toEqual([{ id: 12, ajustes: { limite: 750 } }]);
    // Vacío = sin límite; un número negativo no.
    c.limiteTipo = -5;
    expect(c.limiteTipoValido()).toBeFalse();
    c.limiteTipo = null;
    expect(c.limiteTipoValido()).toBeTrue();
  });

  it('cada solicitud dice de qué tipo es (2026-10-20, ronda 4)', async () => {
    const f = await montar();
    expect((f.nativeElement as HTMLElement).querySelector('.tipo-op')?.textContent?.trim()).toBe('Inventario');
    expect(f.componentInstance.tipoDe({ ...PEDIDO, operacion: 'mover_efectivo' })).toBe('Dinero');
    expect(f.componentInstance.tipoDe({ ...PEDIDO, operacion: 'pagar_nomina' })).toBe('Personal');
    expect(f.componentInstance.tipoDe({ ...PEDIDO, operacion: 'algo_nuevo' })).toBe('Otra');
  });

  it('el resumen separa el monto y el folio, sin perder ni una letra (2026-10-20, ronda 4)', () => {
    const texto = 'Cancelar POS-1790864580000-79FA ($1,234.50) · Juan · sale -$80.00 de efectivo de la caja · C-0007';
    const p = partirResumen(texto);
    expect(p.map((x) => x.t).join('')).toBe(texto);
    expect(p.filter((x) => x.k === 'dinero').map((x) => x.t)).toEqual(['$1,234.50', '-$80.00']);
    const folios = p.filter((x) => x.k === 'folio');
    expect(folios.map((x) => x.titulo)).toEqual(['POS-1790864580000-79FA', 'C-0007']);
    expect(folios[0].corto).toBe('POS-79FA');
    // Una palabra con guion que no es folio se queda como texto.
    expect(partirResumen('NEGRO 2/30 · 20 paquetes').every((x) => x.k === 'txt')).toBeTrue();
  });

  it('el error al rechazar sale DENTRO de su ventana y Escape la cierra (2026-10-20)', async () => {
    const f = await montar();
    const c = f.componentInstance;
    c.abrirRechazo(PEDIDO);
    c.motivo = 'Ya no hace falta';
    c.rechazar();
    f.detectChanges();
    const ventana = (f.nativeElement as HTMLElement).querySelector('[aria-labelledby="rechazo-titulo"]')!;
    expect(ventana.querySelector('.alert')?.textContent).toContain('ya se resolvió');
    expect(c.rechazando()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    f.detectChanges();
    expect(c.rechazando()).toBeNull();
  });
});
