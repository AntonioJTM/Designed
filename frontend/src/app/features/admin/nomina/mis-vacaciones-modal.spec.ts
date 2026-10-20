import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MisVacacionesModal } from './mis-vacaciones-modal';
import { NominaService } from '../../../core/services/nomina.service';
import { AutorizacionesService } from '../../../core/services/autorizaciones.service';
import { MisVacaciones } from '../../../core/models/nomina.models';

/** "Mis vacaciones" (2026-10-19): ve lo suyo, cuenta los días de trabajo y las pide. */
describe('MisVacacionesModal', () => {
  // Trabaja de lunes a sábado; el domingo descansa.
  const horario = [1, 2, 3, 4, 5, 6].map((d) => ({ dia_semana: d, hora_entrada: '09:00', hora_salida: '18:00' }));
  const DATOS: MisVacaciones = {
    en_nomina: true, nombre: 'Teresa', fecha_ingreso: '2024-01-10', horario,
    saldo: { anios: 2, desde: '2026-01-10', hasta: '2027-01-10', corresponden: 14, tomados: 2, restan: 12, proximo_aniversario: '2027-01-10', dias_proximo_anio: 16 },
    registros: [], hoy: '2026-10-19',
    pedidas: [{ id: 5, estado: 'rechazada', fecha_inicio: '2026-09-01', fecha_fin: '2026-09-02', notas: null, motivo: 'Es inventario',
      aviso: 'Se le avisó por WhatsApp al 775 123 4567.', solicitado_en: '2026-08-20 10:00:00', resuelto_en: '2026-08-21 10:00:00', autorizador: 'Antonio' }],
  };
  let pedidas: unknown[];

  async function montar(datos: MisVacaciones = DATOS) {
    pedidas = [];
    await TestBed.configureTestingModule({
      imports: [MisVacacionesModal],
      providers: [
        {
          provide: NominaService,
          useValue: {
            misVacaciones: () => of(datos),
            pedirVacaciones: (b: unknown) => { pedidas.push(b); return of({ pedidas: true }); },
          },
        },
        { provide: AutorizacionesService, useValue: { cancelar: () => of({}) } },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(MisVacacionesModal);
    f.detectChanges();
    return f;
  }

  it('dice cuántos le tocan, tomó y le quedan, y lo que no se aprobó con su porqué', async () => {
    const f = await montar();
    const t = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(t).toContain('Te tocan');
    expect(t).toContain('12');
    expect(t).toContain('No se aprobaron');
    expect(t).toContain('Es inventario');
  });

  it('cuenta solo los días de trabajo (el domingo no) y las pide', async () => {
    const f = await montar();
    const c = f.componentInstance;
    (c as unknown as { hoy: string }).hoy = '2026-10-19';
    c.desde = '2026-11-02'; // lunes
    c.hasta = '2026-11-08'; // domingo
    expect(c.diasPedidos()).toBe(6);
    expect(c.puedePedir()).toBeTrue();
    c.notas = ' boda ';
    c.pedir();
    expect(pedidas).toEqual([{ fecha_inicio: '2026-11-02', fecha_fin: '2026-11-08', notas: 'boda' }]);
    expect(c.mensaje()).toContain('te llega un WhatsApp');
  });

  it('sin fecha de ingreso o sin horario no ofrece pedirlas (y dice qué falta)', async () => {
    const f = await montar({ ...DATOS, saldo: null, horario: [] });
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Falta tu fecha de ingreso');
    expect(el.textContent).toContain('Falta tu horario');
    expect(el.querySelector('input[name=desde]')).toBeNull();
    expect([...el.querySelectorAll('button')].some((b) => b.textContent?.includes('Pedir vacaciones'))).toBeFalse();
  });

  it('sin estar en la nómina no se piden', async () => {
    const f = await montar({ en_nomina: false, nombre: 'Teresa', pedidas: [] });
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Todavía no estás en la nómina');
    expect([...el.querySelectorAll('button')].some((b) => b.textContent?.includes('Pedir vacaciones'))).toBeFalse();
  });

  it('más días de los que le quedan: lo dice y no deja pedirlas; si caben, dice cuántos le quedarán (2026-10-20)', async () => {
    const f = await montar();
    const c = f.componentInstance;
    (c as unknown as { hoy: string }).hoy = '2026-10-19';
    c.desde = '2026-11-02';
    c.hasta = '2026-11-08';
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).toContain('Te quedan 12 días → te quedarán 6 días');
    c.hasta = '2026-11-21'; // 3 semanas: 18 días de trabajo
    expect(c.diasPedidos()).toBeGreaterThan(12);
    expect(c.puedePedir()).toBeFalse();
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).toContain('son más de los que tienes');
  });
});
