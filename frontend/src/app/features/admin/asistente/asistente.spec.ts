import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { Asistente } from './asistente';
import { AsistenteService, Respuesta } from '../../../core/services/asistente.service';

/**
 * Pregúntame. Lo que importa:
 *   · a los 6 segundos sin respuesta se avisa "Consultando tus datos… suele
 *     tardar medio minuto" (la capa gratuita tarda ~30 s y tres puntitos solos
 *     se leen como que se trabó);
 *   · el aviso se apaga al contestar Y al fallar, y no salta después;
 *   · debajo de la respuesta dice qué consultó, o que no consultó nada.
 */
describe('Asistente', () => {
  let preguntar: () => Observable<Respuesta>;
  let f: ComponentFixture<Asistente>;
  let c: Asistente;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Asistente],
      providers: [
        {
          provide: AsistenteService,
          useValue: {
            capacidades: () => of({ configurado: true, modelo: 'x', herramientas: [], ejemplos: ['¿Cuánto vendí hoy?'] }),
            preguntar: () => preguntar(),
          },
        },
      ],
    }).compileComponents();
    f = TestBed.createComponent(Asistente);
    c = f.componentInstance;
    f.detectChanges();
  });

  it('avisa a los 6 s y apaga el aviso al contestar', fakeAsync(() => {
    const respuestas = new Subject<Respuesta>();
    preguntar = () => respuestas;

    c.pregunta = '¿Cuánto vendí hoy?';
    c.enviar();
    tick(5000);
    expect(c.tardando()).toBe(false);
    tick(1500);
    expect(c.tardando()).toBe(true);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).toContain('suele tardar medio minuto');

    respuestas.next({
      respuesta: 'Vendiste $1,200.',
      consultado: [{ herramienta: 'ventas_del_dia', argumentos: {} }],
      uso: { prompt_tokens: 1, completion_tokens: 1 },
      vueltas: 1,
    });
    expect(c.tardando()).toBe(false);
    expect(c.pensando()).toBe(false);
    tick(10000);
    expect(c.tardando()).toBe(false);

    const ultimo = c.mensajes()[c.mensajes().length - 1];
    expect(c.nota(ultimo)).toContain('Consulté: ventas del día');
  }));

  it('apaga el aviso también al fallar, y el error queda en el hilo', fakeAsync(() => {
    preguntar = () =>
      throwError(() => ({ error: { error: { code: 'IA_SIN_CUOTA', message: 'Espera unos minutos.' } } }));

    c.pregunta = 'hola';
    c.enviar();
    expect(c.pensando()).toBe(false);
    tick(10000);
    expect(c.tardando()).toBe(false);
    const ultimo = c.mensajes()[c.mensajes().length - 1];
    expect(ultimo.error).toBe(true);
    expect(ultimo.texto).toBe('Espera unos minutos.');
  }));

  it('cuando contesta sin consultar datos, lo dice', () => {
    expect(c.nota({ quien: 'asistente', texto: 'Hola', consultado: [], hora: '13:50' }))
      .toBe('Sin consultar datos · hoy 13:50');
  });

  it('nombra la consulta en palabras, con sus fechas', () => {
    expect(c.nombreConsulta({ herramienta: 'ventas_por_rango', argumentos: { desde: '2026-09-01', hasta: '2026-09-30' } }))
      .toBe('ventas entre dos fechas (01/09/2026 al 30/09/2026)');
    // Una herramienta nueva que no está en la lista sale con su nombre en palabras.
    expect(c.nombreConsulta({ herramienta: 'algo_nuevo', argumentos: {} })).toBe('algo nuevo');
  });
});
