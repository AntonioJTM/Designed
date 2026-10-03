import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { PermisosPantalla } from './permisos';
import { RedisenoService } from '../../../core/services/rediseno.service';
import { MatrizPermisos } from '../../../core/models/rediseno.models';

/**
 * Lo que importa de Permisos:
 *   · la columna del administrador está marcada y NO se puede apagar;
 *   · lo que se marca se acumula y solo se mandan los puestos que cambiaron;
 *   · regresar una casilla a como estaba no deja el puesto "con cambios".
 */
describe('PermisosPantalla', () => {
  function matriz(): MatrizPermisos {
    return {
      falta_migracion: false,
      catalogo: [
        { grupo: 'Inicio y Vender', tipo: 'pantalla', clave: 'ver:pos', nombre: 'Punto de venta', ayuda: '' },
        { grupo: 'Inicio y Vender', tipo: 'pantalla', clave: 'ver:hoy', nombre: 'Hoy', ayuda: '' },
        { grupo: 'Dinero', tipo: 'accion', clave: 'hacer:fiar', nombre: 'Fiar', ayuda: '' },
      ],
      roles: [
        { id: 3, nombre: 'cajero', personas: 2, es_admin: false, claves: ['ver:pos', 'hacer:fiar'] },
        { id: 1, nombre: 'administrador', personas: 1, es_admin: true, claves: ['ver:pos', 'ver:hoy', 'hacer:fiar'] },
        { id: 2, nombre: 'gerente', personas: 1, es_admin: false, claves: ['ver:pos', 'ver:hoy'] },
      ],
    };
  }

  let guardados: { rolId: number; claves: string[] }[] = [];
  const apiFalsa = {
    permisos: () => of(matriz()),
    guardarPermisos: (rolId: number, claves: string[]) => {
      guardados.push({ rolId, claves: [...claves].sort() });
      return of(matriz());
    },
    crearPuesto: () => of(matriz()),
  };

  async function montar() {
    await TestBed.configureTestingModule({
      imports: [PermisosPantalla],
      providers: [provideRouter([]), { provide: RedisenoService, useValue: apiFalsa }],
    }).compileComponents();
    const fixture = TestBed.createComponent(PermisosPantalla);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => (guardados = []));
  afterEach(() => TestBed.resetTestingModule());

  it('el administrador va primero, con todo marcado y sin poder apagarlo', async () => {
    const fixture = await montar();
    const c = fixture.componentInstance;
    const admin = c.roles()[0];
    expect(admin.es_admin).toBeTrue();
    c.alternar(admin, 'ver:pos', false);
    expect(c.marcado(admin, 'ver:pos')).toBeTrue();
    expect(c.pendientes().length).toBe(0);

    const casillas = fixture.nativeElement.querySelectorAll('td.marca input') as NodeListOf<HTMLInputElement>;
    // 3 permisos × 3 puestos; la primera columna de cada fila es la del administrador.
    expect(casillas.length).toBe(9);
    expect(casillas[0].disabled).toBeTrue();
    expect(casillas[0].checked).toBeTrue();
    expect(casillas[1].disabled).toBeFalse();
  });

  it('solo manda los puestos que cambiaron', async () => {
    const c = (await montar()).componentInstance;
    const cajero = c.roles().find((r) => r.nombre === 'cajero')!;
    c.alternar(cajero, 'ver:hoy', true);
    expect(c.pendientes().map((r) => r.id)).toEqual([3]);
    c.guardar();
    expect(guardados).toEqual([{ rolId: 3, claves: ['hacer:fiar', 'ver:hoy', 'ver:pos'] }]);
    expect(c.pendientes().length).toBe(0);
  });

  it('regresar una casilla a como estaba no cuenta como cambio', async () => {
    const c = (await montar()).componentInstance;
    const gerente = c.roles().find((r) => r.nombre === 'gerente')!;
    c.alternar(gerente, 'hacer:fiar', true);
    expect(c.pendientes().length).toBe(1);
    c.alternar(gerente, 'hacer:fiar', false);
    expect(c.pendientes().length).toBe(0);
  });
});
