import {
  comparar,
  diasEntre,
  inicioSemana,
  iso,
  periodoInicial,
  periodos,
  pesos,
  pesosCorto,
  porSemana,
  rangoLegible,
  serieDiaria,
} from './periodos';

/**
 * Las fechas de los números. Lo que importa:
 *   · cada periodo se compara contra uno del MISMO tamaño (el mes en curso
 *     contra los mismos días del anterior, no contra el mes completo);
 *   · la semana va de domingo a sábado, como la nómina;
 *   · los días sin ventas también aparecen, en cero;
 *   · el signo va antes del símbolo de moneda.
 */
describe('periodos', () => {
  // Viernes 2 de octubre de 2026.
  const hoy = new Date(2026, 9, 2);

  it('el mes en curso se compara contra los mismos días del mes anterior', () => {
    const mes = periodos(hoy).find((p) => p.clave === 'mes')!;
    expect(mes.desde).toBe('2026-10-01');
    expect(mes.hasta).toBe('2026-10-02');
    expect(mes.antes.desde).toBe('2026-09-01');
    expect(mes.antes.hasta).toBe('2026-09-02');
    expect(mes.antes.nombre).toBe('los mismos días de septiembre');
  });

  it('un mes cerrado se compara contra el mes completo anterior', () => {
    const sep = periodos(hoy).find((p) => p.clave === 'mes-1')!;
    expect(sep.opcion).toBe('Septiembre');
    expect([sep.desde, sep.hasta]).toEqual(['2026-09-01', '2026-09-30']);
    expect([sep.antes.desde, sep.antes.hasta]).toEqual(['2026-08-01', '2026-08-31']);
    expect(sep.antes.nombre).toBe('agosto');
  });

  it('los 90 días se comparan contra los 90 de antes, sin encimarse', () => {
    const p = periodos(hoy).find((x) => x.clave === '90')!;
    expect(diasEntre(p.desde, p.hasta)).toBe(90);
    expect(diasEntre(p.antes.desde, p.antes.hasta)).toBe(90);
    expect(p.antes.hasta < p.desde).toBe(true);
  });

  it('el mes en curso de 31 días contra uno de 30 no se sale del mes anterior', () => {
    const mes = periodos(new Date(2026, 9, 31)).find((p) => p.clave === 'mes')!;
    expect(mes.antes.hasta).toBe('2026-09-30');
  });

  it('en la primera semana del mes abre en el mes que acaba de cerrar', () => {
    expect(periodoInicial(new Date(2026, 9, 2))).toBe('mes-1');
    expect(periodoInicial(new Date(2026, 9, 15))).toBe('mes');
  });

  it('dice si se vendió más o menos, y no inventa una comparación sin base', () => {
    expect(comparar(108, 100, 'agosto')).toBe('8% más que agosto');
    expect(comparar(90, 100, 'agosto')).toBe('10% menos que agosto');
    expect(comparar(100, 100, 'agosto')).toBe('igual que agosto');
    expect(comparar(100, 0, 'agosto')).toBe('sin ventas en agosto para comparar');
  });

  it('la semana arranca en domingo', () => {
    // El 2 de octubre de 2026 es viernes: su semana arrancó el domingo 27 de septiembre.
    expect(iso(inicioSemana(hoy))).toBe('2026-09-27');
  });

  it('los días sin ventas aparecen en cero y se agrupan por semana de domingo a sábado', () => {
    const diaria = serieDiaria('2026-09-25', '2026-10-02', [
      { dia: '2026-09-26', num_pedidos: 2, total: '300.00', kilos: '10.000', kilos_paquete: '8.000' },
      { dia: '2026-10-01', num_pedidos: '1', total: '100.50' },
    ]);
    expect(diaria.length).toBe(8);
    expect(diaria[0]).toEqual(jasmine.objectContaining({ desde: '2026-09-25', ventas: 0, total: 0 }));
    expect(diaria[1].total).toBe(300);

    const semanas = porSemana(diaria);
    // vie 25 – sáb 26 es una semana (recortada al rango) y dom 27 – vie 2 la otra.
    expect(semanas.length).toBe(2);
    expect([semanas[0].desde, semanas[0].hasta]).toEqual(['2026-09-25', '2026-09-26']);
    expect(semanas[0].kilos).toBe(10);
    expect([semanas[1].desde, semanas[1].hasta]).toEqual(['2026-09-27', '2026-10-02']);
    expect(semanas[1].total).toBe(100.5);
  });

  it('el signo va antes del símbolo y el número corto se lee de un golpe', () => {
    expect(pesos(-3200)).toBe('-$3,200');
    expect(pesosCorto(104200)).toBe('$104k');
    expect(pesosCorto(8600)).toBe('$8.6k');
    expect(pesosCorto(850)).toBe('$850');
    expect(pesosCorto(1_250_000)).toBe('$1.3M');
  });

  it('nombra el rango como lo diría una persona', () => {
    expect(rangoLegible('2026-09-19', '2026-10-02', hoy)).toBe('Del 19 de septiembre al 2 de octubre');
    expect(rangoLegible('2026-10-01', '2026-10-02', hoy)).toBe('Del 1 al 2 de octubre');
    expect(rangoLegible('2026-10-02', '2026-10-02', hoy)).toBe('El 2 de octubre');
  });
});
