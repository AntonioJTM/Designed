/**
 * ROTACIÓN DE INVENTARIO (2026-10-22): lo que manda `GET /rotacion/*`. Solo
 * kilos: aquí no viaja dinero. Fechas como 'YYYY-MM-DD'.
 */

export type NivelHistoria = 'poca' | 'sin_temporada' | 'completa' | 'confiable';
export type SeMueve = 'rapido' | 'normal' | 'lento';
export type EstadoPedido = 'ya' | 'pronto' | 'calma' | 'sobra' | 'sin_ventas' | 'sin_datos';

export interface HistoriaRotacion {
  /** La venta más vieja: la del sistema o la de las ventas anteriores cargadas. */
  desde: string | null;
  dias: number;
  semanas: number;
  nivel: NivelHistoria;
  meses_completos: number;
  sistema_desde: string | null;
  hay_anteriores: boolean;
  /** Con poca historia: cuántas semanas faltan para calcular. */
  faltan_semanas: number;
}

export interface AjustesRotacion {
  semanas_proveedor: number;
  semanas_colchon: number;
  meses_cubre: number;
  kg_contenedor: number | null;
  /** false mientras no se guarden desde la pantalla ("Por confirmar"). */
  confirmados: boolean;
}

export interface AlmacenRotacion {
  id: number;
  nombre: string;
  /** Tiene mostrador. El que no, "surte a las tiendas". */
  vende: boolean;
  es_matriz: boolean;
}

export interface HiloOpcion {
  producto_id: number;
  hilo: string;
}

export interface RotacionDato {
  veces: number;
  cada_dias: number | null;
  se_mueve: SeMueve;
  existencia_promedio?: number;
  /** Con cuántos días se calculó (menos de 365: anualizada). */
  dias?: number;
  kardex_cuadra?: boolean;
  /** Los kilos que se vendieron en esos días (con los que se calculó). */
  kg_ventana?: number;
}

export interface HayHoy {
  kg: number;
  en_camino: number;
  paquetes: number;
  peso_paquete: number | null;
  almacenes: number;
}

export interface PedidoSugerido {
  kg: number;
  paquetes: number | null;
  llega: string;
}

/** Un hilo en el ranking o en «Qué pedir». */
export interface HiloRotacion {
  producto_id: number;
  hilo: string;
  color: string;
  calibre: string;
  material: string | null;
  vendido_12m: number;
  rotacion: RotacionDato | null;
  /** Este año ÷ el anterior (enero al último mes completo); null sin con qué comparar. */
  contra_anio_pasado: number | null;
  temporada: string | null;
  hay: HayHoy;
  se_vende_semana: number | null;
  alcanza_semanas: number | null;
  se_acaba: string | null;
  pedir: string | null;
  estado: EstadoPedido;
  pedido: PedidoSugerido | null;
  nota: string | null;
  pct_del_total?: number;
  /** En «Hay que pedir pronto». */
  texto?: string;
}

export interface MesDato {
  mes: number;
  kg: number | null;
  origen: 'real' | 'en_curso' | 'pronostico' | null;
}

export interface MesesDosAnios {
  anio_anterior: number;
  anio_actual: number;
  /** Día de hoy (hasta dónde va el mes en curso). */
  corte: number;
  mes_actual: number;
  anterior: MesDato[];
  actual: MesDato[];
}

export interface Tendencia {
  valor: number;
  comparable: boolean;
  actual: number;
  anterior: number;
  meses: number;
  hasta_mes: number;
  anio: number;
}

export interface Racha {
  meses: number[];
  texto: string;
  pct: number;
  kg_mes: number;
}

export interface SumaPedido {
  hilos: number;
  kg: number;
  paquetes: number;
}

export interface ResumenRotacion {
  hoy: string;
  historia: HistoriaRotacion;
  ajustes: AjustesRotacion;
  almacenes: AlmacenRotacion[];
  hilos: HiloOpcion[];
  alcance: { almacen_id: number | null; surte: boolean; producto_id: number | null };
  cifras: {
    vendido_12m: number;
    contra_anio_pasado: number | null;
    tendencia: Tendencia;
    hay_kg: number;
    hay_paquetes: number;
    almacenes_con: number;
    rotacion: RotacionDato | null;
    rotacion_dias: number | null;
    se_vende_semana: number | null;
    alcanza_semanas: number | null;
  };
  meses: MesesDosAnios;
  temporadas: { alta: Racha | null; baja: Racha | null; kg_mes_normal: number } | null;
  pedir_pronto: { lista: HiloRotacion[]; total: SumaPedido; cuantos: number };
  ranking: HiloRotacion[];
  /** Lo que hay en cada almacén (con poca historia es lo único que se ve). */
  por_almacen: { almacen_id: number; nombre: string; vende: boolean; kg: number; paquetes: number }[];
  sobran: { producto_id: number; hilo: string; hay_kg: number; se_vende_semana: number; alcanza: string }[];
}

export interface MesTemporada {
  mes: number;
  kg: number | null;
  en_curso: boolean;
  indice: number | null;
  /** 1–5: los cinco tramos del mapa de calor. */
  tramo: number | null;
}

export interface FilaTemporada {
  producto_id: number;
  hilo: string;
  meses: MesTemporada[];
  total: number;
  mejor_mes: number | null;
  temporada: string | null;
}

export interface AnioTemporada {
  anio: number;
  completo: boolean;
  meses: number;
  en_curso: boolean;
  hasta_mes: number | null;
}

export interface CalendarioCompra {
  hilos: string[];
  nombre: string;
  mes_pedir: number;
  mes_llega: number;
  /** Meses de su temporada (0 = enero). */
  temporada: number[];
  texto: string;
  texto_temporada: string;
}

export interface TemporadasRotacion {
  hoy: string;
  historia: HistoriaRotacion;
  ajustes: AjustesRotacion;
  almacenes: AlmacenRotacion[];
  alcance: { almacen_id: number | null };
  anios: AnioTemporada[];
  hay_promedio: boolean;
  elegido: number | 'promedio';
  con_temporadas: boolean;
  hilos: FilaTemporada[];
  total: { meses: (number | null)[]; total: number; temporada: string | null };
  calendario: CalendarioCompra[];
  sin_temporada: { hilo: string; estado: EstadoPedido; hoy: string; derecha: string }[];
  tarjetas: { nombre: string; meses: string; num_meses: number; hilos: { hilo: string; kg: number }[]; pct: number | null; mejor_mes: number | null }[];
  parejos: { hilo: string; kg_mes: number; se_aleja: number }[];
}

export interface SemanaProyeccion {
  inicio: string;
  sin_pedido: number;
  con_pedido: number;
  /** Le quedan menos de 3 semanas de venta. */
  poco_sin: boolean;
  poco_con: boolean;
}

export interface AlmacenHilo {
  almacen_id: number;
  nombre: string;
  vende: boolean;
  es_matriz: boolean;
  hay_kg: number;
  paquetes: number;
  vende_semana: number | null;
  alcanza_semanas: number | null;
  se_acaba: string | null;
  surtirle: boolean;
}

export interface HiloDetalle {
  hoy: string;
  historia: HistoriaRotacion;
  ajustes: AjustesRotacion;
  hilos: HiloOpcion[];
  /** Los números de «¿Cómo se calcula?», de este hilo. */
  explica: {
    modelo: 'temporada' | 'promedio' | null;
    anual: number | null;
    mes_normal: number | null;
    mejor: { mes: number; anio: number; kg: number } | null;
    siguiente: { mes: number; anio: number; base_anio: number; base_kg: number; kg: number } | null;
    promedio_semana: number | null;
  };
  hilo: HiloRotacion & { presentaciones: string[]; pct_del_total: number; lugar: number; tendencia: Tendencia };
  pedido_hoy: (PedidoSugerido & { quedan_al_llegar: number; se_vendera: number }) | null;
  meses: MesesDosAnios;
  temporada: {
    texto: string;
    num_meses: number;
    pct_del_anio: number | null;
    mejor: { mes: number; indice: number; kg: { anio: number; kg: number }[] };
    peor: { mes: number; indice: number; kg: { anio: number; kg: number }[] };
    veces_mejor_peor: number | null;
  } | null;
  proyeccion: { semanas: SemanaProyeccion[]; llega_semana: number | null; siguiente: { pedir: string; texto: string } | null };
  almacenes: AlmacenHilo[];
  hay_sin_mostrador: boolean;
  avisos: { almacen_id: number; texto: string }[];
  como_se_vende: { paquete: number; cono: number; otro: number };
  cargas: { fecha: string; kg: number; almacen: string }[];
  cada_cuanto: string | null;
}

export interface QuePedirRotacion {
  hoy: string;
  historia: HistoriaRotacion;
  ajustes: AjustesRotacion;
  hilos: HiloRotacion[];
  totales: {
    ya: SumaPedido;
    proximos: SumaPedido;
    calma: { hilos: number; desde: string | null; hasta: string | null };
    sobra: { hilos: number; kg: number; uno: { hilo: string; alcanza: string } | null };
  };
}

/** Un renglón de la vista previa de las ventas de años anteriores. */
export interface RenglonAnterior {
  fila: number;
  hilo_excel: string;
  hilo?: string;
  producto_id?: number;
  anio?: number;
  mes?: number;
  kg?: number;
  almacen_id: number | null;
  tienda: string;
  estado: 'ok' | 'aviso' | 'error';
  mensajes: string[];
}

export interface PreviaAnteriores {
  renglones: RenglonAnterior[];
  errores: number;
  validos: number;
  kg: number;
  hilos: number;
  desde: string | null;
  hasta: string | null;
  se_puede: boolean;
}

export interface ResumenAnteriores {
  renglones: number;
  kg: number;
  hilos: number;
  desde: string | null;
  hasta: string | null;
}
