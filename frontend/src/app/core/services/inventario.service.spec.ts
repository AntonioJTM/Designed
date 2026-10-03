import { TestBed } from '@angular/core/testing';
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EventoCarga, InventarioService } from './inventario.service';

/**
 * La carga de la lista completa llega POR PARTES (un JSON por renglón). Lo que
 * importa: que cada renglón salga en cuanto está completo —aunque llegue
 * partido en dos trozos—, que el último salga aunque no traiga salto de línea,
 * y que un error de validación (JSON normal) se lea como siempre.
 */
describe('InventarioService.cargarLista', () => {
  let svc: InventarioService;
  let http: HttpTestingController;
  const cuerpo = { almacen_id: 2, hilos: [{ nombre: 'ROJO', calibre: '2/30', bultos: [{ codigo: 'A', peso_kg: 19 }] }] };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(InventarioService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('va soltando cada aviso en cuanto llega completo', () => {
    const eventos: EventoCarga[] = [];
    let terminado = false;
    svc.cargarLista(cuerpo).subscribe({ next: (e) => eventos.push(e), complete: () => (terminado = true) });
    const req = http.expectOne((r) => r.url.endsWith('/remesas/lista') && r.params.get('progreso') === '1');
    expect(req.request.reportProgress).toBe(true);

    const r1 = '{"tipo":"paso","texto":"Revisando"}\n';
    const r2 = '{"tipo":"bultos","hilo":"ROJO 2/30","hechos":100,"total":250}\n';
    const r3 = '{"tipo":"fin","data":{"ids":[9]}}';
    // El segundo renglón llega partido: no sale hasta que se completa.
    req.event({ type: HttpEventType.DownloadProgress, loaded: 1, partialText: r1 + r2.slice(0, 20) });
    expect(eventos.map((e) => e.tipo)).toEqual(['paso']);
    req.event({ type: HttpEventType.DownloadProgress, loaded: 2, partialText: r1 + r2 });
    expect(eventos.map((e) => e.tipo)).toEqual(['paso', 'bultos']);
    // El último, sin salto de línea, sale al cerrar la respuesta.
    req.flush(r1 + r2 + r3);
    expect(eventos.map((e) => e.tipo)).toEqual(['paso', 'bultos', 'fin']);
    expect(terminado).toBe(true);
  });

  it('si el servidor contesta como antes (un solo JSON), lo toma como el final', () => {
    const eventos: EventoCarga[] = [];
    svc.cargarLista(cuerpo).subscribe((e) => eventos.push(e));
    http
      .expectOne((r) => r.url.endsWith('/remesas/lista'))
      .flush(JSON.stringify({ data: { ids: [4, 5] }, error: null }), { status: 201, statusText: 'Created' });
    expect(eventos.length).toBe(1);
    expect(eventos[0].tipo).toBe('fin');
  });

  it('un error de validación se lee como JSON, igual que en las demás rutas', () => {
    let mensaje = '';
    svc.cargarLista(cuerpo).subscribe({
      error: (e) => (mensaje = e?.error?.error?.message ?? ''),
    });
    http
      .expectOne((r) => r.url.endsWith('/remesas/lista'))
      .flush(JSON.stringify({ data: null, error: { code: 'VALIDACION', message: 'Datos de entrada inválidos' } }), {
        status: 422,
        statusText: 'Unprocessable',
      });
    expect(mensaje).toBe('Datos de entrada inválidos');
  });
});
