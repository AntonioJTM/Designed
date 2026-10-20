import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { autorizacionInterceptor } from './autorizacion.interceptor';
import { AutorizacionDialogoService } from '../services/autorizacion-dialogo.service';

/**
 * AUTORIZACIONES (2026-10-19): ante un 428 NECESITA_AUTORIZACION, pregunta y
 * vuelve a mandar LA MISMA petición, sin que la pantalla sepa nada.
 */
describe('autorizacionInterceptor', () => {
  let http: HttpClient;
  let ctl: HttpTestingController;
  let dialogo: AutorizacionDialogoService;

  const NECESITA = {
    data: null,
    error: {
      code: 'NECESITA_AUTORIZACION',
      message: '«Sacar o meter efectivo» necesita autorización.',
      detalles: {
        operacion: 'mover_efectivo', nombre: 'Sacar o meter efectivo', resumen: 'Sacar $500.00 de Caja 1',
        solo_en_el_momento: false, autorizadores: [{ id: 2, nombre: 'Jairo Domínguez', con_clave: true }],
      },
    },
  };
  const espera = () => new Promise((r) => setTimeout(r));

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([autorizacionInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    ctl = TestBed.inject(HttpTestingController);
    dialogo = TestBed.inject(AutorizacionDialogoService);
  });
  afterEach(() => ctl.verify());

  function pedir() {
    const r: { ok?: unknown; error?: HttpErrorResponse } = {};
    http.post('/api/v1/caja/sesiones/4/movimientos', { tipo: 'retiro', monto: 500 }).subscribe({
      next: (v) => (r.ok = v),
      error: (e) => (r.error = e),
    });
    ctl.expectOne('/api/v1/caja/sesiones/4/movimientos').flush(NECESITA, { status: 428, statusText: 'x' });
    return r;
  }

  it('pedirla: se manda con X-Pedir-Autorizacion y a la pantalla le llega "se pidió", no un éxito', async () => {
    const r = pedir();
    expect(dialogo.actual()?.info.resumen).toBe('Sacar $500.00 de Caja 1');
    dialogo.elegir({ tipo: 'pedir' });
    await espera();
    const otra = ctl.expectOne('/api/v1/caja/sesiones/4/movimientos');
    expect(otra.request.headers.get('X-Pedir-Autorizacion')).toBe('1');
    expect(otra.request.body).toEqual({ tipo: 'retiro', monto: 500 });
    otra.flush({ data: { autorizacion: { id: 9 } }, error: null }, { status: 202, statusText: 'Accepted' });
    await espera();
    expect(dialogo.actual()?.pedida).toBeTrue();
    dialogo.enterado();
    await espera();
    expect(r.ok).toBeUndefined();
    expect(r.error?.error?.error?.code).toBe('AUTORIZACION_PEDIDA');
  });

  it('pedida a medias (la ficha se guardó, el crédito quedó pedido): avisa y la pantalla recibe su respuesta normal', async () => {
    const r = pedir();
    dialogo.elegir({ tipo: 'pedir' });
    await espera();
    const otra = ctl.expectOne('/api/v1/caja/sesiones/4/movimientos');
    otra.flush({ data: { id: 12 }, error: null }, { status: 200, statusText: 'OK', headers: { 'X-Autorizacion-Pedida': '31' } });
    await espera();
    expect(dialogo.actual()?.pedida).toBeTrue();
    dialogo.enterado();
    await espera();
    expect(r.error).toBeUndefined();
    expect(r.ok).toEqual({ data: { id: 12 }, error: null });
  });

  it('al pedirla contesta 2xx SIN cabecera (ya lo podía hacer directo): se hizo, no dice "se pidió"', async () => {
    const r = pedir();
    dialogo.elegir({ tipo: 'pedir' });
    await espera();
    ctl.expectOne('/api/v1/caja/sesiones/4/movimientos').flush({ data: { id: 13 }, error: null }, { status: 201, statusText: 'Created' });
    await espera();
    expect(dialogo.actual()).toBeNull();
    expect(r.error).toBeUndefined();
    expect(r.ok).toEqual({ data: { id: 13 }, error: null });
  });

  it('autorizar aquí: la misma petición con la clave, y la pantalla recibe su respuesta normal', async () => {
    const r = pedir();
    dialogo.elegir({ tipo: 'aqui', usuario_id: 2, clave: 'contraseña' });
    await espera();
    const otra = ctl.expectOne('/api/v1/caja/sesiones/4/movimientos');
    const cab = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(otra.request.headers.get('X-Autoriza')!), (c) => c.charCodeAt(0))));
    expect(cab).toEqual({ usuario_id: 2, clave: 'contraseña' });
    otra.flush({ data: { id: 77 }, error: null });
    await espera();
    expect(r.ok).toEqual({ data: { id: 77 }, error: null });
    expect(dialogo.actual()).toBeNull();
  });

  it('con la clave equivocada vuelve a preguntar y dice por qué', async () => {
    pedir();
    dialogo.elegir({ tipo: 'aqui', usuario_id: 2, clave: 'mala' });
    await espera();
    ctl.expectOne('/api/v1/caja/sesiones/4/movimientos').flush(
      { data: null, error: { code: 'AUTORIZACION_INVALIDA', message: 'La clave no es correcta.' } },
      { status: 403, statusText: 'x' }
    );
    await espera();
    expect(dialogo.actual()?.error).toBe('La clave no es correcta.');
    expect(dialogo.actual()?.ocupado).toBeFalse();
    dialogo.elegir({ tipo: 'no' });
  });

  it('"No hacerlo": no se manda nada más y la pantalla recibe "no se hizo"', async () => {
    const r = pedir();
    dialogo.elegir({ tipo: 'no' });
    await espera();
    expect(r.error?.error?.error?.code).toBe('AUTORIZACION_CANCELADA');
  });

  it('una petición como TEXTO (la lista del proveedor, por partes) también pregunta', async () => {
    const r: { error?: HttpErrorResponse } = {};
    http.post('/api/v1/remesas/lista', { almacen_id: 1 }, { responseType: 'text' }).subscribe({ error: (e) => (r.error = e) });
    ctl.expectOne('/api/v1/remesas/lista').flush(JSON.stringify(NECESITA), { status: 428, statusText: 'x' });
    await espera();
    expect(dialogo.actual()?.info.operacion).toBe('mover_efectivo');
    dialogo.elegir({ tipo: 'pedir' });
    await espera();
    ctl.expectOne('/api/v1/remesas/lista').flush(JSON.stringify({ data: { autorizacion: { id: 3 } }, error: null }), { status: 202, statusText: 'Accepted' });
    await espera();
    dialogo.enterado();
    await espera();
    expect(r.error?.error?.error?.code).toBe('AUTORIZACION_PEDIDA');
  });

  it('cualquier otro error pasa tal cual', () => {
    let error: HttpErrorResponse | undefined;
    http.get('/api/v1/algo').subscribe({ error: (e) => (error = e) });
    ctl.expectOne('/api/v1/algo').flush({ data: null, error: { code: 'X', message: 'y' } }, { status: 409, statusText: 'x' });
    expect(error?.status).toBe(409);
    expect(dialogo.actual()).toBeNull();
  });
});
