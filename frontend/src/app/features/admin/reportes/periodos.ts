/**
 * Fechas de los números: periodos, semanas y cómo se nombran.
 *
 * Lo usan Reportes y "Cómo va el negocio". Todo va en la hora LOCAL del equipo,
 * que es la de la tienda: `toISOString()` da el día en UTC y en México, después
 * de las 18:00, ya devuelve el día siguiente (eso vaciaba el reporte del día).
 *
 * La SEMANA va de domingo a sábado, igual que la nómina: es como la tienda
 * cuenta su semana y la que paga en sábado.
 */

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
// Abreviaturas propias y no las de `toLocaleDateString`: según el navegador,
// septiembre sale "sep", "sept" o "sept." y las etiquetas cambiaban de ancho.
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** 'YYYY-MM-DD' de una fecha, en hora local. */
export function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Una fecha 'YYYY-MM-DD' (o 'YYYY-MM-DD hh:mm:ss') como día local, a medianoche. */
export function fecha(s: string): Date {
  const [a, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(a, m - 1, d);
}

export function sumarDias(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** El domingo con que arranca la semana de esa fecha. */
export function inicioSemana(d: Date): Date {
  return sumarDias(d, -d.getDay());
}

/** Días que hay de una fecha a otra, contando las dos. */
export function diasEntre(desde: string, hasta: string): number {
  const ms = fecha(hasta).getTime() - fecha(desde).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** "21 sep" */
export function etiquetaCorta(d: Date): string {
  return `${d.getDate()} ${MESES_CORTOS[d.getMonth()]}`;
}

/** "vie 19" */
export function etiquetaDia(d: Date): string {
  return `${DIAS_CORTOS[d.getDay()]} ${d.getDate()}`;
}

/** "vie 19 sep" */
export function etiquetaDiaMes(d: Date): string {
  return `${DIAS_CORTOS[d.getDay()]} ${d.getDate()} ${MESES_CORTOS[d.getMonth()]}`;
}

export function esSabado(d: Date): boolean {
  return d.getDay() === 6;
}

/**
 * "Del 19 de septiembre al 2 de octubre". El año solo se escribe cuando hace
 * falta: si el rango cruza de año o no es el año en curso.
 */
export function rangoLegible(desde: string, hasta: string, hoy = new Date()): string {
  const a = fecha(desde);
  const b = fecha(hasta);
  const conAnio = a.getFullYear() !== b.getFullYear() || b.getFullYear() !== hoy.getFullYear();
  const dia = (d: Date, anio: boolean) =>
    `${d.getDate()} de ${MESES[d.getMonth()]}${anio ? ' de ' + d.getFullYear() : ''}`;
  if (desde === hasta) return `El ${dia(a, conAnio)}`;
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `Del ${a.getDate()} al ${dia(b, conAnio)}`;
  }
  return `Del ${dia(a, conAnio)} al ${dia(b, conAnio)}`;
}

// --------------------------------------------------------------- Periodos

/** Un periodo del selector de "Cómo va el negocio", con el que se compara. */
export interface Periodo {
  clave: 'mes' | 'mes-1' | 'mes-2' | '90' | 'anio';
  /** Lo que dice el selector: "Septiembre", "Octubre (en curso)". */
  opcion: string;
  /** Cómo se nombra dentro de una frase: "septiembre", "los últimos 90 días". */
  nombre: string;
  /** El título de la cifra: "Vendido en septiembre", "Vendido este año". */
  vendidoEn: string;
  desde: string;
  hasta: string;
  /** El periodo anterior DEL MISMO TAMAÑO, y cómo se nombra en la comparación. */
  antes: { desde: string; hasta: string; nombre: string };
}

function ultimoDiaDelMes(anio: number, mes: number): number {
  return new Date(anio, mes + 1, 0).getDate();
}

function mesCompleto(anio: number, mes: number): { desde: string; hasta: string } {
  return { desde: iso(new Date(anio, mes, 1)), hasta: iso(new Date(anio, mes + 1, 0)) };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Los periodos que ofrece el selector. Cada uno se compara contra uno del MISMO
 * TAMAÑO: el mes en curso contra los mismos días del mes anterior, no contra el
 * mes completo — comparar 2 días de octubre contra 30 de septiembre diría
 * "93% menos" de algo que apenas empieza.
 */
export function periodos(hoy = new Date()): Periodo[] {
  const a = hoy.getFullYear();
  const m = hoy.getMonth();
  const d = hoy.getDate();
  const lista: Periodo[] = [];

  // El mes en curso, contra los mismos días del anterior.
  const mPrev = new Date(a, m - 1, 1);
  const diaPrev = Math.min(d, ultimoDiaDelMes(mPrev.getFullYear(), mPrev.getMonth()));
  lista.push({
    clave: 'mes',
    opcion: `${capital(MESES[m])} (en curso)`,
    nombre: MESES[m],
    vendidoEn: `Vendido en ${MESES[m]}`,
    desde: iso(new Date(a, m, 1)),
    hasta: iso(hoy),
    antes: {
      desde: iso(mPrev),
      hasta: iso(new Date(mPrev.getFullYear(), mPrev.getMonth(), diaPrev)),
      nombre: `los mismos días de ${MESES[mPrev.getMonth()]}`,
    },
  });

  // Los dos meses completos anteriores, cada uno contra el suyo de antes.
  for (const [clave, atras] of [['mes-1', 1], ['mes-2', 2]] as const) {
    const ini = new Date(a, m - atras, 1);
    const prev = new Date(a, m - atras - 1, 1);
    lista.push({
      clave,
      opcion: capital(MESES[ini.getMonth()]),
      nombre: MESES[ini.getMonth()],
      vendidoEn: `Vendido en ${MESES[ini.getMonth()]}`,
      ...mesCompleto(ini.getFullYear(), ini.getMonth()),
      antes: { ...mesCompleto(prev.getFullYear(), prev.getMonth()), nombre: MESES[prev.getMonth()] },
    });
  }

  // Los últimos 90 días, contra los 90 de antes.
  const ini90 = sumarDias(hoy, -89);
  lista.push({
    clave: '90',
    opcion: 'Últimos 90 días',
    nombre: 'los últimos 90 días',
    vendidoEn: 'Vendido en los últimos 90 días',
    desde: iso(ini90),
    hasta: iso(hoy),
    antes: { desde: iso(sumarDias(ini90, -90)), hasta: iso(sumarDias(ini90, -1)), nombre: 'los 90 días anteriores' },
  });

  // Este año, contra el mismo tramo del año pasado (el 29 de febrero cae en el 28).
  const mismoDiaAntes = Math.min(d, ultimoDiaDelMes(a - 1, m));
  lista.push({
    clave: 'anio',
    opcion: 'Este año',
    nombre: 'este año',
    vendidoEn: 'Vendido este año',
    desde: `${a}-01-01`,
    hasta: iso(hoy),
    antes: {
      desde: `${a - 1}-01-01`,
      hasta: iso(new Date(a - 1, m, mismoDiaAntes)),
      nombre: 'lo mismo del año pasado',
    },
  });

  return lista;
}

/**
 * El periodo con que abre la pantalla. En la primera semana del mes el mes en
 * curso apenas tiene ventas y no dice nada: se abre en el mes que acaba de
 * cerrar. Después, en el mes en curso.
 */
export function periodoInicial(hoy = new Date()): Periodo['clave'] {
  return hoy.getDate() >= 8 ? 'mes' : 'mes-1';
}

/** "8% más que agosto" · "3% menos que los 90 días anteriores" · "igual que agosto". */
export function comparar(actual: number, anterior: number, nombreAntes: string): string {
  if (!(anterior > 0)) {
    return actual > 0 ? `sin ventas en ${nombreAntes} para comparar` : 'sin ventas todavía';
  }
  const pct = Math.round(((actual - anterior) / anterior) * 100);
  if (pct === 0) return `igual que ${nombreAntes}`;
  return pct > 0 ? `${pct}% más que ${nombreAntes}` : `${-pct}% menos que ${nombreAntes}`;
}

// ------------------------------------------------------- Series de ventas

/** Lo que trae `porDia` del reporte de ventas (los DECIMAL llegan como texto). */
export interface DiaCrudo {
  dia: string;
  num_pedidos: number | string;
  total: number | string;
  kilos?: number | string;
  kilos_paquete?: number | string;
}

/** Un tramo (un día o una semana) ya con números. */
export interface TramoVentas {
  desde: string;
  hasta: string;
  ventas: number;
  total: number;
  kilos: number;
  kilosPaquete: number;
}

/**
 * Todos los días del rango, también los que no tuvieron ventas: el reporte solo
 * trae los días con ventas, y una gráfica con huecos brincados haría ver
 * seguido lo que no lo fue.
 */
export function serieDiaria(desde: string, hasta: string, porDia: DiaCrudo[]): TramoVentas[] {
  const mapa = new Map(porDia.map((d) => [String(d.dia).slice(0, 10), d]));
  const fin = fecha(hasta);
  const serie: TramoVentas[] = [];
  for (let d = fecha(desde); d <= fin; d = sumarDias(d, 1)) {
    const clave = iso(d);
    const x = mapa.get(clave);
    serie.push({
      desde: clave,
      hasta: clave,
      ventas: Number(x?.num_pedidos ?? 0),
      total: Number(x?.total ?? 0),
      kilos: Number(x?.kilos ?? 0),
      kilosPaquete: Number(x?.kilos_paquete ?? 0),
    });
  }
  return serie;
}

/** La serie diaria agrupada en semanas de domingo a sábado (recortadas al rango). */
export function porSemana(diaria: TramoVentas[]): TramoVentas[] {
  const semanas = new Map<string, TramoVentas>();
  for (const d of diaria) {
    const clave = iso(inicioSemana(fecha(d.desde)));
    const s = semanas.get(clave);
    if (!s) {
      semanas.set(clave, { ...d });
    } else {
      s.hasta = d.hasta;
      s.ventas += d.ventas;
      s.total += d.total;
      s.kilos += d.kilos;
      s.kilosPaquete += d.kilosPaquete;
    }
  }
  return [...semanas.values()];
}

/** "$104k" · "$8.6k" · "$1.2M" · "$850": para el número chico encima de una columna. */
export function pesosCorto(v: number): string {
  const n = Math.abs(v);
  const signo = v < 0 ? '-' : '';
  if (n >= 1_000_000) return `${signo}$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${signo}$${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${signo}$${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${signo}$${Math.round(n)}`;
}

/** Pesos sin centavos y con el signo antes del símbolo, para las cifras grandes. */
export function pesos(v: number | string | null | undefined): string {
  return Number(v ?? 0).toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
