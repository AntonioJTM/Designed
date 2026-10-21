import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { GastoModal } from './gasto-modal';
import { VentasService } from '../../../core/services/ventas.service';
import { AuthService } from '../../../core/services/auth.service';
import { Gasto, SesionCaja } from '../../../core/models/ventas.models';

/**
 * REGISTRAR UN GASTO (2026-10-20): dice el tope de su tipo, cómo queda el
 * cajón y, si pasa el tope, que se pide autorización; no deja gastar más de lo
 * que hay; manda tipo, monto y qué se compró, y sube la foto DESPUÉS.
 */
describe('GastoModal', () => {
  const sesion = { id: 5, caja: 'Caja 1', usuario: 'Ana', esperado_actual: '1000.00', movimientos: [] } as unknown as SesionCaja;
  const tipos = [
    { id: 1, nombre: 'Papelería', limite: 300, activo: true },
    { id: 2, nombre: 'Limpieza', limite: null, activo: true },
  ];
  const gasto = { id: 40, tipo: 'Papelería', monto: 250 } as Gasto;
  let enviado: { sesion: number; body: unknown } | null;
  let fotos: number[];
  let respuesta: 'ok' | 'pedida';
  /** ¿Quien registra autoriza gastos? (`hacer:gasto_sobre_limite`) */
  let autoriza = false;
  /** ¿Administra los tipos? (`hacer:tipos_gasto`) */
  let administra = false;
  let tiposCreados: unknown[] = [];
  /** ¿Pide tipos de gasto? (el cajero, `pedir:tipos_gasto`) */
  let pide = false;

  async function montar() {
    enviado = null;
    fotos = [];
    await TestBed.configureTestingModule({
      imports: [GastoModal],
      providers: [{ provide: AuthService, useValue: { puede: (p: string) => p === 'hacer:tipos_gasto' ? administra : autoriza, puedeOPide: (p: string) => p === 'hacer:tipos_gasto' ? administra || pide : autoriza, veTodasLasTiendas: () => true } }, {
        provide: VentasService,
        useValue: {
          tiposGasto: () => of(tipos),
          crearTipoGasto: (b: { nombre: string; limite: number | null }) => {
            tiposCreados.push(b);
            return pide && !administra
              ? throwError(() => ({ error: { error: { code: 'AUTORIZACION_PEDIDA', message: 'Se pidió la autorización.' } } }))
              : of({ id: 9, nombre: b.nombre, limite: b.limite, activo: true });
          },
          registrarGasto: (s: number, body: unknown) => {
            enviado = { sesion: s, body };
            return respuesta === 'ok'
              ? of({ gasto, sesion: { ...sesion, esperado_actual: '750.00' } })
              : throwError(() => ({ error: { error: { code: 'AUTORIZACION_PEDIDA', message: 'Se pidió la autorización.' } } }));
          },
          subirFotoGasto: (id: number) => { fotos.push(id); return of({ ...gasto, con_comprobante: true }); },
        },
      }],
    }).compileComponents();
    const f = TestBed.createComponent(GastoModal);
    f.componentRef.setInput('sesion', sesion);
    f.detectChanges();
    return f;
  }
  beforeEach(() => { respuesta = 'ok'; autoriza = false; administra = false; pide = false; tiposCreados = []; });
  afterEach(() => TestBed.resetTestingModule());

  it('dice el tope del tipo y cómo queda el cajón', async () => {
    const f = await montar();
    const c = f.componentInstance;
    c.tipoId = 1;
    c.monto = 250;
    f.detectChanges();
    const t = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(t).toContain('Hasta $300.00 por gasto');
    expect(t).toContain('$750.00');
    expect(c.pasaTope()).toBeNull();
  });

  it('arriba del tope avisa que se pide autorización, y en un tipo SIN tope todo se autoriza', async () => {
    const f = await montar();
    const c = f.componentInstance;
    c.tipoId = 1;
    c.monto = 450;
    f.detectChanges();
    expect(c.pasaTope()?.nombre).toBe('Papelería');
    expect((f.nativeElement as HTMLElement).textContent).toContain('Se pide autorización');
    // Sin tope NO es "pasa todo" (revisor de tiendas, 2026-10-20).
    c.tipoId = 2;
    c.monto = 50;
    f.detectChanges();
    expect(c.pasaTope()?.nombre).toBe('Limpieza');
    expect((f.nativeElement as HTMLElement).textContent).toContain('todo gasto de este tipo se autoriza');
  });

  it('quien administra los tipos da de alta uno AHÍ MISMO y queda elegido (2026-10-20)', async () => {
    administra = true;
    const f = await montar();
    const c = f.componentInstance;
    const el = f.nativeElement as HTMLElement;
    const boton = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Nuevo tipo')!;
    expect(boton).toBeTruthy();
    boton.click();
    f.detectChanges();
    c.nombreTipo = 'Mantenimiento';
    c.limiteTipo = 800;
    c.agregarTipo();
    f.detectChanges();
    expect(tiposCreados).toEqual([{ nombre: 'Mantenimiento', limite: 800 }]);
    expect(c.tipoId).toBe(9);
    expect(c.nuevoTipo()).toBeFalse();
    expect(c.tipos().map((t) => t.nombre)).toContain('Mantenimiento');
    expect(el.textContent).toContain('Hasta $800.00 por gasto');
  });

  it('el CAJERO también da de alta un tipo: se PIDE y la ventana lo dice (2026-10-20)', async () => {
    pide = true;
    const f = await montar();
    const c = f.componentInstance;
    const el = f.nativeElement as HTMLElement;
    expect([...el.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Nuevo tipo')).toBeTrue();
    c.abrirNuevoTipo();
    c.nombreTipo = 'Fletes';
    c.limiteTipo = 500;
    c.agregarTipo();
    f.detectChanges();
    expect(tiposCreados).toEqual([{ nombre: 'Fletes', limite: 500 }]);
    expect(c.nuevoTipo()).toBeFalse();
    expect(c.tipoId).toBeNull();
    expect(el.textContent).toContain('Se pidió dar de alta «Fletes»');
  });

  it('sin «Tipos de gasto» no se ofrece "Nuevo tipo"', async () => {
    const f = await montar();
    const el = f.nativeElement as HTMLElement;
    expect([...el.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Nuevo tipo')).toBeFalse();
  });

  it('a quien autoriza le dice que se registra directo', async () => {
    autoriza = true;
    const f = await montar();
    const c = f.componentInstance;
    c.tipoId = 1;
    c.monto = 450;
    f.detectChanges();
    const t = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(t).toContain('como tú autorizas, se registra directo');
    expect(t).not.toContain('Se pide autorización');
  });

  it('no deja gastar más de lo que hay en el cajón ni sin decir qué se compró', async () => {
    const c = (await montar()).componentInstance;
    c.tipoId = 2;
    c.monto = 1200;
    c.descripcion = 'Escobas';
    c.guardar();
    expect(enviado).toBeNull();
    expect(c.error()).toContain('no alcanza');
    c.monto = 100;
    c.descripcion = 'x';
    c.guardar();
    expect(enviado).toBeNull();
  });

  it('registra con tipo, monto y qué se compró, y DESPUÉS sube la foto', async () => {
    const f = await montar();
    const c = f.componentInstance;
    let aviso = '';
    c.guardado.subscribe((r) => (aviso = r.aviso));
    c.tipoId = 1;
    c.monto = 250;
    c.descripcion = 'Hojas';
    c.archivo = new File(['x'], 'ticket.jpg');
    c.guardar();
    expect(enviado).toEqual({ sesion: 5, body: { tipo_gasto_id: 1, monto: 250, descripcion: 'Hojas' } });
    expect(fotos).toEqual([40]);
    expect(aviso).toContain('Con la foto del ticket');
  });

  it('si quedó pedida la autorización, se cierra y avisa que la foto se sube después', async () => {
    respuesta = 'pedida';
    const c = (await montar()).componentInstance;
    let pedido = '';
    let cerro = false;
    c.pedido.subscribe((t) => (pedido = t));
    c.cerrado.subscribe(() => (cerro = true));
    c.tipoId = 1;
    c.monto = 450;
    c.descripcion = 'Tóner';
    c.archivo = new File(['x'], 'ticket.jpg');
    c.guardar();
    expect(cerro).toBeTrue();
    expect(fotos).toEqual([]);
    expect(pedido).toContain('súbela en la lista de gastos');
  });
});
