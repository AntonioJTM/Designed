import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TODO, TiempoRealService, leerEventos } from './tiempo-real.service';

describe('Tiempo real', () => {
  it('parte lo que llega en eventos, y guarda lo que todavía no termina', () => {
    const r = leerEventos('retry: 5000\n\n: latido\n\nevent: cambio\ndata: {"tipos":["caja"]}\n\nevent: cam');
    expect(r.eventos).toEqual([{ evento: 'cambio', datos: '{"tipos":["caja"]}' }]);
    expect(r.resto).toBe('event: cam');
    const r2 = leerEventos(r.resto + 'bio\ndata: {"tipos":["inventario"]}\n\n');
    expect(r2.eventos).toEqual([{ evento: 'cambio', datos: '{"tipos":["inventario"]}' }]);
  });

  it('avisa solo de los tipos que le importan, juntos en una recarga, y no lo de esta pestaña', fakeAsync(() => {
    const s = TestBed.inject(TiempoRealService);
    let veces = 0;
    const sub = s.cambios(['inventario']).subscribe(() => veces++);
    s.recibir(['caja']);
    tick(500);
    expect(veces).toBe(0);
    // Una venta avisa varias cosas seguidas: una sola recarga.
    s.recibir(['ventas', 'inventario']);
    s.recibir(['inventario', 'avisos']);
    tick(500);
    expect(veces).toBe(1);
    // Lo que hizo esta misma pestaña no se le avisa.
    s.recibir(['inventario'], s.pestana);
    tick(500);
    expect(veces).toBe(1);
    // Al volver la conexión, "cambió todo".
    s.recibir([TODO]);
    tick(500);
    expect(veces).toBe(2);
    sub.unsubscribe();
  }));

  it('con avisos sin parar igual recarga: no espera a que haya silencio', fakeAsync(() => {
    const s = TestBed.inject(TiempoRealService);
    let veces = 0;
    const sub = s.cambios(['ventas'], 1000).subscribe(() => veces++);
    // Tres segundos con una venta cada 300 ms (una tienda con fila).
    for (let i = 0; i < 10; i++) {
      s.recibir(['ventas']);
      tick(300);
    }
    expect(veces).toBeGreaterThanOrEqual(2);
    sub.unsubscribe();
  }));
});
