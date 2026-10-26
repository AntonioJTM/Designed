import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { VentasAnterioresModal } from './ventas-anteriores-modal';
import { RotacionService } from '../../../core/services/rotacion.service';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';
import { PreviaAnteriores } from '../../../core/models/rotacion.models';

const BIEN: PreviaAnteriores = {
  renglones: [
    { fila: 2, hilo_excel: 'MARINO', hilo: 'MARINO 2/30', producto_id: 1, anio: 2025, mes: 9, kg: 851, almacen_id: null, tienda: 'Las dos', estado: 'ok', mensajes: [] },
    { fila: 3, hilo_excel: 'MARINO', hilo: 'MARINO 2/30', producto_id: 1, anio: 2025, mes: 10, kg: 700, almacen_id: null, tienda: 'Las dos', estado: 'ok', mensajes: [] },
  ],
  errores: 0, validos: 2, kg: 1551, hilos: 1, desde: '2025-09', hasta: '2025-10', se_puede: true,
};
const CON_ERROR: PreviaAnteriores = {
  ...BIEN,
  renglones: [...BIEN.renglones, { fila: 4, hilo_excel: 'MORADITO', almacen_id: null, tienda: 'Las dos', estado: 'error', mensajes: ['No hay ningún hilo MORADITO 2/30'] }],
  errores: 1, se_puede: false,
};

/**
 * Cargar ventas de años anteriores: primero la vista previa; con un renglón que no
 * se entiende no deja cargar y lo enseña primero; cargar avisa a la pantalla;
 * borrar pregunta antes.
 */
describe('VentasAnterioresModal', () => {
  let cargas: number;
  let borrados: number;
  let previa: PreviaAnteriores;
  let confirma: boolean;

  async function montar() {
    cargas = 0;
    borrados = 0;
    await TestBed.configureTestingModule({
      imports: [VentasAnterioresModal],
      providers: [
        {
          provide: RotacionService,
          useValue: {
            anteriores: () => of({ renglones: 24, kg: 9000, hilos: 2, desde: '2024-01', hasta: '2025-12' }),
            previaAnteriores: () => of(previa),
            cargarAnteriores: () => { cargas++; return of({ cargados: 2, kg: 1551, hilos: 1, desde: '2025-09', hasta: '2025-10' }); },
            borrarAnteriores: () => { borrados++; return of({ borrados: 24 }); },
          },
        },
        { provide: ConfirmacionService, useValue: { pedir: () => Promise.resolve(confirma) } },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(VentasAnterioresModal);
    f.detectChanges();
    return f;
  }

  const elegir = (c: VentasAnterioresModal) => {
    const input = { files: [new File(['x'], 'ventas 2025.xlsx')], value: 'C:\\ventas 2025.xlsx' };
    c.elegir({ target: input } as unknown as Event);
  };

  afterEach(() => TestBed.resetTestingModule());

  it('dice lo que ya hay cargado', async () => {
    const el = (await montar()).nativeElement as HTMLElement;
    expect(el.querySelector('.ya-cargado')?.textContent).toContain('24 renglones');
    expect(el.querySelector('.ya-cargado')?.textContent).toContain('enero de 2024');
  });

  it('con todo bien deja cargar y avisa a la pantalla', async () => {
    previa = BIEN;
    const f = await montar();
    const c = f.componentInstance;
    let avisos = 0;
    c.cargado.subscribe(() => avisos++);
    elegir(c);
    f.detectChanges();
    const boton = (f.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.modal-foot .btn-primary')!;
    expect(boton.disabled).toBe(false);
    expect(boton.textContent).toContain('Cargar 2 renglones');
    c.cargar();
    expect(cargas).toBe(1);
    expect(avisos).toBe(1);
    expect(c.listo()).toContain('se cargaron 2 renglones');
  });

  it('con un renglón que no se entiende no deja cargar y lo pone primero', async () => {
    previa = CON_ERROR;
    const f = await montar();
    const c = f.componentInstance;
    elegir(c);
    f.detectChanges();
    expect(c.muestra()[0].fila).toBe(4);
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.modal-foot .btn-primary')!.hasAttribute('disabled')).toBe(true);
    expect(el.querySelector('tr.fila-error')?.textContent).toContain('MORADITO');
    c.cargar();
    expect(cargas).toBe(0);
  });

  it('borrar pregunta antes', async () => {
    const c = (await montar()).componentInstance;
    confirma = false;
    await c.borrar();
    expect(borrados).toBe(0);
    confirma = true;
    await c.borrar();
    expect(borrados).toBe(1);
  });
});
