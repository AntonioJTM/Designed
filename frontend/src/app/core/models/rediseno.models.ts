// Modelos de las pantallas nuevas del rediseño (2026-10): las cinco pestañas de
// Clientes, Hoy, Permisos y el resumen de Pedidos. Reflejan el backend.

export type VistaClientes = 'frecuencia' | 'dejaron' | 'deuda' | 'que-compra' | 'cuando' | 'gasto';
/** Periodo de las pestañas de Clientes, en días. 3650 = desde siempre. */
export type PeriodoClientes = 30 | 90 | 365 | 3650;

/** Cómo va cada cliente contra su propio ritmo. */
export type EstadoRitmo = 'bien' | 'toca' | 'frio' | 'perdido' | 'una';

export interface ClienteRitmo {
  cliente_id: number;
  nombre: string;
  nombre_comercial?: string | null;
  telefono?: string | null;
  num_compras: number;
  dias_con_compra: number;
  primera: string;
  ultima: string;
  dias_sin_venir: number;
  /** Cada cuántos días compra (null con una sola compra). */
  ritmo: number | null;
  /** Cuántas veces su ritmo lleva sin venir. */
  veces: number | null;
  estado: EstadoRitmo;
  compras_periodo: number;
  /** Lo que se ha llevado desde siempre: kilos de hilo y dinero (total de sus ventas). */
  kg_total: number;
  dinero_total: number;
  /** Lo que se lleva cada vez que viene (por día con compra). */
  kg_por_visita: number;
  dinero_por_visita: number;
  /** Lo del periodo elegido. */
  kg_periodo: number;
  dinero_periodo: number;
}

export interface Frecuencia {
  dias: number;
  total_clientes: number;
  mediana_ritmo: number | null;
  /** La visita típica: cuánto se lleva un cliente cada vez que viene. */
  mediana_kg_visita: number | null;
  mediana_dinero_visita: number | null;
  al_corriente: number;
  les_toca: number;
  enfriandose: number;
  perdidos: number;
  tramos: { semana: number; mes: number; mas: number; una: number; frio: number; perdido: number };
  clientes: ClienteRitmo[];
}

export interface DeudorCartera {
  cliente_id: number;
  codigo?: string | null;
  nombre: string;
  nombre_comercial?: string | null;
  telefono?: string | null;
  limite_credito: string | number;
  saldo: string | number;
  dias_sin_abonar: number;
  ultimo_movimiento?: string | null;
  ultimo_abono?: string | null;
  ultima_compra?: string | null;
  tramo: 'al_dia' | 'un_mes' | 'dos_meses' | 'vencido';
}

export interface Deuda {
  total_por_cobrar: number;
  num_clientes: number;
  vencido: number;
  num_vencidos: number;
  dias_aviso: number;
  por_antiguedad: { clave: string; etiqueta: string; monto: number; clientes: number }[];
  clientes: DeudorCartera[];
  credito_usado: number;
  credito_autorizado: number;
  cobrado_mes: { monto: number; abonos: number };
}

export interface HiloComprado {
  producto_id: number;
  color: string;
  calibre?: string | null;
  material?: string | null;
  linea?: string | null;
  kg: number;
  clientes: number;
}

export interface QueCompra {
  dias: number;
  total_kg: number;
  hilos_distintos: number;
  top: HiloComprado[];
  por_material: { material: string; calibre: string | null; kg: number; pct: number }[];
  pct_cono: number;
  clientes: {
    cliente_id: number;
    nombre: string;
    nombre_comercial?: string | null;
    kg: number;
    pct_paquete: number;
    favorito: { producto_id: number; hilo: string; kg: number } | null;
    otros: string[];
  }[];
}

export interface Cuando {
  dias: number;
  total_compras: number;
  horas: number[];
  mapa: { dow: number; dia: string; celdas: number[] }[];
  dia_fuerte: { dia: string; pct: number };
  hora_pico: { desde: number; hasta: number; pct: number };
  semanas: { lunes: string; n: number }[];
  esta_semana: number;
  semana_pasada: number;
  les_toca_7_dias: number;
  clientes: {
    cliente_id: number;
    nombre: string;
    nombre_comercial?: string | null;
    telefono?: string | null;
    dia: string;
    hora: number;
    ultima: string;
    ritmo: number | null;
    proxima: string | null;
    /** Negativo = ya se pasó. */
    en_dias: number | null;
  }[];
}

export interface Gasto {
  dias: number;
  total_clientes: number;
  total_ventas: number;
  pct_de_ventas: number | null;
  compras: number;
  ticket: number | null;
  gasto_mes: number | null;
  pct_top10: number | null;
  compran_mas: number;
  compran_menos: number;
  nuevos: number;
  por_lista: { lista: string; total: number; pct: number }[];
  clientes: {
    pos: number;
    cliente_id: number;
    nombre: string;
    nombre_comercial?: string | null;
    telefono?: string | null;
    lista?: string | null;
    total: number;
    compras: number;
    ticket: number | null;
    antes: number;
    cambio_pct: number | null;
    acumulado_pct: number | null;
  }[];
}

/** La costumbre de un cliente (vista Resumen del expediente). */
export interface HabitosCliente {
  ritmo: number | null;
  primera: string | null;
  ultima: string | null;
  dias_sin_venir: number | null;
  veces_su_ritmo: number | null;
  dia_de_costumbre: string | null;
  hora_de_costumbre: number | null;
  visitas_90: { dia: string; hace: number }[];
  por_dia_semana: { dia: string; n: number }[];
  por_mes: { mes: string; compras: number; total: number }[];
  /** Cuántas compras a cada hora (solo las horas con alguna). */
  por_hora?: { hora: number; n: number }[];
  /** Lo de los últimos 90 días, con la misma ventana que la pestaña Cuánto gasta. */
  ultimos_90?: { compras: number; total: number; kg: number; kg_cono: number; hilos: number };
  /** Los 90 días de antes, para decir si compra más o menos que antes. */
  anteriores_90?: { compras: number; total: number };
  /** Compra promedio de TODOS los clientes identificados en 90 días. */
  ticket_tienda_90?: number | null;
}

export interface Hoy {
  vendido_hoy: { ventas: number; total: number };
  por_hora: { hora: number; n: number }[];
  cajas: {
    id: number;
    caja: string;
    almacen: string;
    usuario: string;
    fecha_apertura: string;
    monto_inicial: string;
    ventas: number;
    esperado: number;
  }[];
  en_cajas: number;
}

export interface ResumenPedidos {
  hoy: { ventas: number; total: number };
  semana: { ventas: number; total: number };
  /** `ventas` = número de clientes que deben. */
  por_cobrar: { ventas: number; total: number };
  canceladas_mes: { ventas: number; total: number };
}

export interface PermisoCatalogo {
  grupo: string;
  tipo: 'pantalla' | 'accion';
  clave: string;
  nombre: string;
  ayuda: string;
}

export interface RolPermisos {
  id: number;
  nombre: string;
  descripcion?: string | null;
  personas: number;
  es_admin: boolean;
  claves: string[];
}

export interface MatrizPermisos {
  catalogo: PermisoCatalogo[];
  roles: RolPermisos[];
  falta_migracion: boolean;
}
