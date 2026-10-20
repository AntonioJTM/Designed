import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { VacacionesModal } from './vacaciones-modal';
import { NominaService } from '../../../core/services/nomina.service';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';
import { EmpleadoNomina, VacacionesEmpleado } from '../../../core/models/nomina.models';

/**
 * Las vacaciones en Nómina (2026-10-20, ronda 4 de la auditoría): con las fechas
 * elegidas dice "le quedan 12 → le quedarán 9", y con más días de los que tiene
 * lo dice y apaga "Registrar". Solo opina dentro de su año de vacaciones de
 * ahora (cuentan contra el año donde EMPIEZAN).
 */
describe('VacacionesModal', () => {
  // Trabaja de lunes a sábado.
  const horario = [1, 2, 3, 4, 5, 6].map((d) => ({ dia_semana: d, hora_entrada: '09:00', hora_salida: '18:00' }));
  const DATOS: VacacionesEmpleado = {
    usuario_id: 5, nombre: 'Germán', fecha_ingreso: '2024-03-01', horario,
    saldo: { anios: 2, desde: '2026-03-01', hasta: '2027-03-01', corresponden: 14, tomados: 2, restan: 12,
      proximo_aniversario: '2027-03-01', dias_proximo_anio: 16 },
    registros: [],
  };

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [VacacionesModal],
      providers: [
        { provide: NominaService, useValue: { vacaciones: () => of(DATOS) } },
        { provide: ConfirmacionService, useValue: { pedir: () => Promise.resolve(true) } },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(VacacionesModal);
    f.componentRef.setInput('empleado', { usuario_id: 5, nombre: 'Germán' } as EmpleadoNomina);
    f.detectChanges();
    return f;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('dice cómo queda: le quedan 12 días → le quedarán 9', async () => {
    const f = await montar();
    const c = f.componentInstance;
    // Lunes 19 a miércoles 21 de octubre de 2026: 3 días de trabajo.
    c.desde = '2026-10-19';
    c.hasta = '2026-10-21';
    f.detectChanges();
    expect(c.despues()).toEqual({ restan: 12, quedaran: 9, pasa: false });
    expect((f.nativeElement as HTMLElement).textContent).toContain('le quedarán 9 días');
  });

  it('con más días de los que tiene lo dice y no deja registrar', async () => {
    const f = await montar();
    const c = f.componentInstance;
    c.desde = '2026-10-05';
    c.hasta = '2026-10-31';
    f.detectChanges();
    expect(c.despues()?.pasa).toBeTrue();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('son más de los que tiene');
    const registrar = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Registrar')!;
    expect(registrar.disabled).toBeTrue();
  });

  it('fuera de su año de vacaciones de ahora no opina (cuentan contra el año donde empiezan)', async () => {
    const f = await montar();
    const c = f.componentInstance;
    c.desde = '2027-03-08';
    c.hasta = '2027-03-10';
    expect(c.despues()).toBeNull();
  });
});
