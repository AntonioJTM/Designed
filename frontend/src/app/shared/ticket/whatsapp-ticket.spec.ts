import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Observable, Subject, of } from 'rxjs';
import { WhatsappTicket } from './whatsapp-ticket';
import { PaqueteWhatsapp, WhatsappService, WhatsappTienda } from '../../core/services/whatsapp.service';

/**
 * La ventana de MANDAR POR WHATSAPP (2026-10-16): mientras se prepara el PDF lo
 * dice y trae el número del cliente (que se puede corregir). Con el WhatsApp de
 * la tienda ENLAZADO lo manda directo desde el servidor; sin enlazar, baja el PDF
 * y abre el chat en el mismo clic.
 */
describe('Ventana de WhatsApp', () => {
  const paquete = (extra: Partial<PaqueteWhatsapp> = {}): PaqueteWhatsapp => ({
    titulo: 'Ticket de venta POS-468D',
    pdf: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
    archivo: 'Ticket de venta POS-468D.pdf',
    mensaje: 'Hola Ines, le mandamos su ticket de venta POS-468D por $2,820.25. — Hitex',
    cliente: 'MARTHA LOPEZ RUIZ',
    telefono: '775 123 4567',
    clienteId: null,
    telefonoPrincipal: '775 123 4567',
    telefonoAlt: null,
    ...extra,
  });
  const tienda = (estado: WhatsappTienda['estado']): WhatsappTienda => ({
    estado, numero: estado === 'enlazado' ? '+52 771 000 0000' : null, nombre: null, desde: null, aviso: null,
  });

  let abiertos: string[];
  let bajados: string[];
  let http: HttpTestingController;

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [WhatsappTicket],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(WhatsappTicket);
    // Que se comporte como en la computadora aunque las pruebas corran en otra cosa.
    (fixture.componentInstance as unknown as { esTelefono: boolean }).esTelefono = false;
    fixture.detectChanges();
    return fixture;
  }

  /** Abre la ventana y contesta si el WhatsApp de la tienda está enlazado. */
  function abrir(fixture: Awaited<ReturnType<typeof montar>>, preparar: Observable<PaqueteWhatsapp>, estado: WhatsappTienda['estado']) {
    TestBed.inject(WhatsappService).abrir('Ticket', preparar);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/whatsapp/estado')).flush({ data: tienda(estado), error: null });
    fixture.detectChanges();
  }

  const texto = (el: HTMLElement) => el.textContent!.replace(/\s+/g, ' ');
  const boton = (el: HTMLElement, t: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === t) as HTMLButtonElement;

  beforeEach(() => {
    abiertos = [];
    bajados = [];
    spyOn(window, 'open').and.callFake((url?: string | URL) => { abiertos.push(String(url)); return null; });
    // La descarga: se apunta el nombre en vez de bajar el archivo.
    spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (this: HTMLAnchorElement) { bajados.push(this.download); });
  });
  afterEach(() => TestBed.resetTestingModule());

  it('mientras se prepara el PDF lo dice y no deja mandar; luego trae su número', async () => {
    const fixture = await montar();
    const preparar = new Subject<PaqueteWhatsapp>();
    abrir(fixture, preparar, 'sin_enlazar');
    const el = fixture.nativeElement as HTMLElement;
    expect(texto(el)).toContain('Preparando el PDF…');
    expect(boton(el, 'Bajar el PDF y abrir WhatsApp').disabled).toBeTrue();
    expect(el.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();

    preparar.next(paquete());
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(texto(el)).toContain('Ticket de venta POS-468D');
    expect(texto(el)).toContain('MARTHA LOPEZ RUIZ');
    expect((el.querySelector('input[name=telefono]') as HTMLInputElement).value).toBe('775 123 4567');
    expect(boton(el, 'Bajar el PDF y abrir WhatsApp').disabled).toBeFalse();
    // Sin enlazar, dice dónde se enlaza para mandarlo directo.
    expect(texto(el)).toContain('enlaza el de la tienda en Configuración');
  });

  it('sin enlazar, un clic: baja el PDF y abre su chat con el mensaje; luego dice que lo arrastre', async () => {
    const fixture = await montar();
    abrir(fixture, of(paquete()), 'sin_enlazar');
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    boton(el, 'Bajar el PDF y abrir WhatsApp').click();
    fixture.detectChanges();
    expect(bajados).toEqual(['Ticket de venta POS-468D.pdf']);
    expect(abiertos.length).toBe(1);
    expect(abiertos[0]).toContain('https://wa.me/527751234567?text=Hola%20Ines');
    expect(texto(el)).toContain('arrastra «Ticket de venta POS-468D.pdf»');
    boton(el, 'Listo').click();
    fixture.detectChanges();
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });

  it('un número incompleto se dice y no abre nada; sin número, se elige el contacto en WhatsApp', async () => {
    const fixture = await montar();
    abrir(fixture, of(paquete({ telefono: null })), 'sin_enlazar');
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const c = fixture.componentInstance;
    expect(texto(el)).toContain('Sin número: eliges el contacto en WhatsApp.');

    c.teclear('775 12');
    fixture.detectChanges();
    boton(el, 'Bajar el PDF y abrir WhatsApp').click();
    fixture.detectChanges();
    expect(abiertos).toEqual([]);
    expect(texto(el)).toContain('Le faltan números');
    expect(el.querySelector('input[name=telefono]')!.getAttribute('aria-invalid')).toBe('true');

    c.teclear('');
    fixture.detectChanges();
    boton(el, 'Bajar el PDF y abrir WhatsApp').click();
    expect(abiertos[0]).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });

  it('ENLAZADO: "Mandar por WhatsApp" lo manda directo desde el servidor, sin abrir nada', async () => {
    const fixture = await montar();
    abrir(fixture, of(paquete()), 'enlazado');
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(texto(el)).toContain('Le llega desde el WhatsApp de la tienda (+52 771 000 0000)');

    boton(el, 'Mandar por WhatsApp').click();
    fixture.detectChanges();
    const req = http.expectOne((r) => r.url.endsWith('/whatsapp/enviar'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body instanceof Blob).toBeTrue();
    expect(req.request.headers.get('X-Telefono')).toBe(encodeURIComponent('775 123 4567'));
    expect(decodeURIComponent(req.request.headers.get('X-Archivo')!)).toBe('Ticket de venta POS-468D.pdf');
    expect(texto(el)).toContain('Mandándolo…');
    req.flush({ data: { enviado: true, numero: '+52 775 123 4567' }, error: null });
    fixture.detectChanges();
    expect(texto(el)).toContain('Listo: se le mandó «Ticket de venta POS-468D.pdf» a +52 775 123 4567.');
    expect(abiertos).toEqual([]);
    expect(bajados).toEqual([]);
  });

  it('ENLAZADO y con su número: no enseña el campo, el cursor queda en "Mandar" (un Enter) y luego en "Listo"', async () => {
    const fixture = await montar();
    abrir(fixture, of(paquete()), 'enlazado');
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('input[name=telefono]')).toBeNull();
    expect(texto(el)).toContain('Le llega a 775 123 4567, el número de su expediente.');
    expect(texto(el)).toContain('Aprieta Enter para mandarlo.');
    expect(document.activeElement).toBe(boton(el, 'Mandar por WhatsApp'));

    // Enter sobre el botón = mandar el formulario.
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/whatsapp/enviar')).flush({ data: { enviado: true, numero: '+52 775 123 4567' }, error: null });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(boton(el, 'Listo'));
  });

  it('"Cambiar número" enseña el campo con su número y le pone el cursor', async () => {
    const fixture = await montar();
    abrir(fixture, of(paquete()), 'enlazado');
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    boton(el, 'Cambiar número').click();
    fixture.detectChanges();
    await fixture.whenStable();
    const campo = el.querySelector('input[name=telefono]') as HTMLInputElement;
    expect(campo).not.toBeNull();
    expect(campo.value).toBe('775 123 4567');
    expect(document.activeElement).toBe(campo);
  });

  it('ENLAZADO: sin número no se manda; si el servidor dice que no tiene WhatsApp, lo dice; y se puede mandar a mano', async () => {
    const fixture = await montar();
    abrir(fixture, of(paquete({ telefono: null })), 'enlazado');
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const c = fixture.componentInstance;
    boton(el, 'Mandar por WhatsApp').click();
    fixture.detectChanges();
    http.expectNone((r) => r.url.endsWith('/whatsapp/enviar'));
    expect(texto(el)).toContain('Escribe su número de WhatsApp');

    c.teclear('7751234567');
    fixture.detectChanges();
    boton(el, 'Mandar por WhatsApp').click();
    http.expectOne((r) => r.url.endsWith('/whatsapp/enviar')).flush(
      { data: null, error: { code: 'SIN_WHATSAPP', message: 'El número +52 775 123 4567 no tiene WhatsApp.' } },
      { status: 422, statusText: 'Unprocessable' }
    );
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('no tiene WhatsApp');

    // "Bajarlo y mandarlo yo": como sin enlazar.
    boton(el, 'Bajarlo y mandarlo yo').click();
    fixture.detectChanges();
    expect(bajados).toEqual(['Ticket de venta POS-468D.pdf']);
    expect(abiertos[0]).toContain('https://wa.me/527751234567');
  });

  /*
   * GUARDAR EL NÚMERO EN SU EXPEDIENTE (2026-10-16): "que la base de clientes se
   * llene sola desde la caja".
   */
  it('cliente sin teléfono: la casilla aparece marcada y al mandarlo se guarda en su expediente', async () => {
    const fixture = await montar();
    abrir(fixture, of(paquete({ clienteId: 3, telefono: null, telefonoPrincipal: null })), 'sin_enlazar');
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    // Sin número escrito, todavía no hay nada que guardar.
    expect(el.querySelector('input[name=guardar]')).toBeNull();

    fixture.componentInstance.teclear('775 999 8888');
    fixture.detectChanges();
    const casilla = el.querySelector('input[name=guardar]') as HTMLInputElement;
    await fixture.whenStable();
    expect(casilla.checked).toBeTrue();
    expect(texto(el)).toContain('Guardar este número en el expediente de MARTHA LOPEZ RUIZ');

    boton(el, 'Bajar el PDF y abrir WhatsApp').click();
    const req = http.expectOne((r) => r.url.endsWith('/clientes/3') && r.method === 'PUT');
    // Un celular de México se guarda con sus 10 números; no tenía otro, así que no hay segundo.
    expect(req.request.body).toEqual({ telefono: '7759998888' });
    req.flush({ data: { id: 3 }, error: null });
    fixture.detectChanges();
    expect(texto(el)).toContain('El número quedó en su expediente.');
  });

  it('si ya tenía otro número, el viejo pasa a segundo teléfono; desmarcada no guarda nada', async () => {
    let fixture = await montar();
    abrir(fixture, of(paquete({ clienteId: 3, telefonoPrincipal: '7751234567', telefonoAlt: null })), 'sin_enlazar');
    await fixture.whenStable();
    fixture.detectChanges();
    let el = fixture.nativeElement as HTMLElement;
    // Su mismo número: no se ofrece.
    expect(el.querySelector('input[name=guardar]')).toBeNull();

    fixture.componentInstance.teclear('771 000 0001');
    fixture.detectChanges();
    expect(texto(el)).toContain('el 775 123 4567 que tenía queda como segundo teléfono');
    boton(el, 'Bajar el PDF y abrir WhatsApp').click();
    const req = http.expectOne((r) => r.url.endsWith('/clientes/3') && r.method === 'PUT');
    expect(req.request.body).toEqual({ telefono: '7710000001', telefono_alt: '7751234567' });
    req.flush({ data: { id: 3 }, error: null });

    // Desmarcada: se manda, pero no se toca su expediente.
    TestBed.resetTestingModule();
    fixture = await montar();
    abrir(fixture, of(paquete({ clienteId: 3, telefonoPrincipal: '7751234567', telefonoAlt: '7750000000' })), 'sin_enlazar');
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    fixture.componentInstance.teclear('771 000 0001');
    fixture.detectChanges();
    expect(texto(el)).toContain('(reemplaza al 775 123 4567)');
    fixture.componentInstance.guardarNumero.set(false);
    boton(el, 'Bajar el PDF y abrir WhatsApp').click();
    http.expectNone((r) => r.url.includes('/clientes/'));
    expect(abiertos.length).toBeGreaterThan(0);
  });

  it('si no se pudo preparar, lo dice; y Escape la cierra', async () => {
    const fixture = await montar();
    const svc = TestBed.inject(WhatsappService);
    const preparar = new Subject<PaqueteWhatsapp>();
    abrir(fixture, preparar, 'sin_enlazar');
    preparar.error(new Error('Una nota en espera no lleva ticket.'));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('Una nota en espera no lleva ticket.');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(svc.actual()).toBeNull();
  });
});
