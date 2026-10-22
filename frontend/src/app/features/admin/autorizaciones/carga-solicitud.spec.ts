import { TestBed } from '@angular/core/testing';
import { CargaSolicitud } from './carga-solicitud';
import { DetalleCarga, HiloCarga } from '../../../core/models/autorizaciones.models';

/**
 * QUÉ SE VA A CARGAR, en la solicitud (2026-10-21, usuario: "qué color de hilo,
 * peso de paquetes"): cada hilo con su material y lo que hay hoy, y al tocarlo
 * sus lotes y cada paquete.
 */
describe('CargaSolicitud', () => {
  const NEGRO: HiloCarga = {
    clave: 'NEGRO|1/30', nombre: 'NEGRO', calibre: '1/30', estado: 'existe', iguales: 0,
    material: 'ACRILAN', linea: 'Turco', sin_precio: false, desactivado: false, crea_presentacion: false,
    hoy_kg: 153.85, paquetes: 3, kg: 57.4, conos: 24, sin_conos: 1, peso_min: 18.55, peso_max: 19.85, registrados: 1,
    lotes: [
      {
        lote: '0094878', paquetes: 2, kg: 38.4, conos: 24, sin_conos: 0,
        bultos: [
          { fila: 3, codigo: '00539468', peso_kg: 18.55, conos: 12, registrado: false },
          { fila: 4, codigo: '00539469', peso_kg: 19.85, conos: 12, registrado: true },
        ],
      },
      { lote: null, paquetes: 1, kg: 19, conos: 0, sin_conos: 1, bultos: [{ fila: 9, codigo: '00539470', peso_kg: 19, conos: null, registrado: false }] },
    ],
  };
  const ROSA: HiloCarga = {
    ...NEGRO, clave: 'ROSA|2/30', nombre: 'Rosa palo', calibre: '2/30', estado: 'nuevo', sin_precio: true, hoy_kg: null,
    paquetes: 1, kg: 19.05, conos: 12, sin_conos: 0, peso_min: 19.05, peso_max: 19.05, registrados: 0,
    lotes: [{ lote: '0097001', paquetes: 1, kg: 19.05, conos: 12, sin_conos: 0, bultos: [{ fila: 7, codigo: '00540001', peso_kg: 19.05, conos: 12, registrado: false }] }],
  };
  const CARGA: DetalleCarga = {
    almacen: 'MATRIZ CUAUTEPEC', archivo: 'lista.xlsx',
    papeles: { proveedor: 'Canan Tekstil', factura: 'F-0921', pedimento: null, contenedor: null, fecha_ingreso: '2026-10-21', documento: null, notas: null },
    ve_costos: false, ve_existencias: true, hilos: [NEGRO, ROSA], paquetes: 4, kg: 76.45, conos: 36, lotes: 3, registrados: 1, nuevos: 1,
  };

  function montar(carga: DetalleCarga) {
    TestBed.configureTestingModule({ imports: [CargaSolicitud] });
    const f = TestBed.createComponent(CargaSolicitud);
    f.componentRef.setInput('carga', carga);
    f.componentRef.setInput('solicitud', 5);
    f.detectChanges();
    return f;
  }

  it('dice cada hilo con su material, lo que pesan sus paquetes y lo que habrá en el almacén', () => {
    const el = montar(CARGA).nativeElement as HTMLElement;
    const texto = el.textContent ?? '';
    expect(texto).toContain('NEGRO 1/30');
    expect(texto).toContain('Ya existe');
    expect(texto).toContain('ACRILAN Turco');
    expect(texto).toContain('18.55 a 19.85 kg');
    expect(texto).toContain('153.85');
    expect(texto).toContain('211.25 kg');
    expect(texto).toContain('Rosa palo 2/30');
    expect(texto).toContain('Se crea sin precio');
    expect(texto).toContain('Canan Tekstil');
    expect(texto).toContain('21/10/2026');
    expect(texto).toContain('1 paquete ya está registrado');
    // Los paquetes se ven hasta tocar el color.
    expect(el.querySelector('.paquetes-lista')).toBeNull();
  });

  it('tocar el color abre sus lotes y cada paquete, con el ya registrado en rojo', () => {
    const f = montar(CARGA);
    const el = f.nativeElement as HTMLElement;
    const boton = el.querySelector<HTMLButtonElement>('.hilo-abrir')!;
    boton.click();
    f.detectChanges();
    expect(boton.getAttribute('aria-expanded')).toBe('true');
    const lotes = el.querySelectorAll('.lote-paquetes');
    expect(lotes.length).toBe(2);
    expect(lotes[0].textContent).toContain('0094878');
    expect(lotes[0].textContent).toContain('2 paquetes');
    expect(lotes[1].textContent).toContain('Sin lote');
    const paquetes = el.querySelectorAll('.paquetes-lista li');
    expect(paquetes.length).toBe(3);
    expect(paquetes[1].classList).toContain('con-error');
    expect(paquetes[1].textContent).toContain('00539469');
    expect(paquetes[1].textContent).toContain('19.85 kg');
    expect(paquetes[2].textContent).toContain('sin conos');
  });

  it('el costo por kilo solo sale si el servidor lo manda (quien tiene «Ver costos»)', () => {
    const sin = montar(CARGA).nativeElement as HTMLElement;
    expect(sin.textContent).not.toContain('Costo por kg');
    TestBed.resetTestingModule();
    const con = montar({ ...CARGA, ve_costos: true, hilos: [{ ...NEGRO, costo_kg: 85.5 }, { ...ROSA, costo_kg: null }] })
      .nativeElement as HTMLElement;
    expect(con.textContent).toContain('Costo por kg');
    expect(con.textContent).toContain('$85.50');
    expect(con.textContent).toContain('Sin costo');
  });

  it('sin ver las existencias de ese almacén no sale "En el almacén"', () => {
    const el = montar({ ...CARGA, ve_existencias: false, hilos: [{ ...NEGRO, hoy_kg: null }] }).nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('En el almacén');
    expect(el.textContent).not.toContain('→');
    expect(el.querySelectorAll('thead th').length).toBe(6);
  });

  it('con muchos hilos enseña los primeros y "Ver los N hilos"', () => {
    const hilos = Array.from({ length: 8 }, (_, i) => ({ ...NEGRO, clave: `H${i}`, nombre: `COLOR ${i}` }));
    const f = montar({ ...CARGA, hilos });
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll('tbody .hilo-abrir').length).toBe(6);
    const ver = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Ver los 8 hilos'))!;
    ver.click();
    f.detectChanges();
    expect(el.querySelectorAll('tbody .hilo-abrir').length).toBe(8);
  });
});
