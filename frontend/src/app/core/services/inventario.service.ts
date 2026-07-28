import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/auth.models';
import { EstadoBulto, Paginado, Variante } from '../models/catalogo.models';
import {
  Almacen,
  AlmacenInput,
  Movimiento,
  ResultadoMovimiento,
  StockItem,
  TraspasoDetalle,
  TipoMovimiento,
} from '../models/inventario.models';

function data<T>(r: ApiResponse<T>): T {
  if (r.error || r.data === null) throw r.error ?? { code: 'DESCONOCIDO', message: 'Respuesta vacía' };
  return r.data;
}

export interface FiltroStock {
  almacen_id?: number;
  variante_id?: number;
  q?: string;
  bajo_stock?: boolean;
  page?: number;
  limit?: number;
}

export interface MovimientoInput {
  variante_id: number;
  almacen_id: number;
  tipo: TipoMovimiento;
  cantidad: number;
  costo_unitario?: number | null;
  motivo?: string;
}

/**
 * Lo que trae un bulto escaneado, para bajarlo a mostrador. `cono` viene en null
 * cuando el producto todavía no tiene presentación de cono: se crea al confirmar,
 * con los conos que dice el bulto.
 */
export interface PreviaDesarme {
  bulto: { codigo: string; peso_kg: string; lote?: string | null; conos?: number | null; remesa_folio?: string | null };
  paquete: { variante_id: number; sku: string; producto: string; presentacion?: string | null; peso_kg: string; precio: string };
  cono: { variante_id: number; sku: string; piezas_por_origen: number; precio: string } | null;
  conos_a_generar: number | null;
  existencias: { almacen_id: number; almacen: string; cantidad: string }[];
}

/** Desarme de paquetes en conos. El peso y los conos por paquete ya están en la variante. */
export interface DesarmeInput {
  /** Con `codigo_bulto` no hace falta: se resuelve del bulto. */
  cono_variante_id?: number;
  almacen_origen_id: number;
  almacen_destino_id: number;
  paquetes?: number;
  /** Kilos reales. Sin esto se usa paquetes × peso nominal del paquete. */
  kg?: number;
  /** Conos que rinde de verdad. Sin esto se usan los nominales del cono. */
  conos?: number;
  /** Lo que gana de peso el hilo al enconarse (el tubo de cada cono). */
  destare_kg?: number;
  /** Bulto que se desarmó, para dejar el rastro en el kardex. */
  codigo_bulto?: string;
  motivo?: string;
}

export interface ResultadoDesarme {
  conversion_id: number;
  /** El destare capturado, y el peso ya con él sumado. */
  destare_kg?: number | null;
  kg_enconados?: number;
  producto: string;
  paquetes: number;
  kg_consumidos: number;
  /** Lo que habrían pesado los paquetes según su peso nominal. */
  kg_nominales?: number;
  piezas_generadas: number;
  paquete: { variante_id: number; sku: string; almacen_id: number; saldo_nuevo: number };
  cono: { variante_id: number; sku: string; almacen_id: number; saldo_nuevo: number };
}

/** Totales de un almacén en el panorama. */
export interface ResumenAlmacen {
  almacen_id: number;
  nombre: string;
  es_punto_venta: boolean | number;
  es_matriz: boolean | number;
  es_tienda_linea: boolean | number;
  skus: number | string;
  kilos: string;
  piezas: string;
  /** Desglose: cuánto sigue en paquete y cuánto ya se enconó. */
  kilos_paquete?: string;
  kilos_cono?: string;
  alertas: number | string;
}

/** Renglón de la matriz: un producto y lo que hay de él en cada almacén. */
export interface ResumenFila {
  variante_id: number;
  sku: string;
  /** Se agrupa por este id y NO por el nombre: el mismo color en otro calibre es otro producto. */
  producto_id?: number;
  producto: string;
  /** Cómo se clasifica el hilo. */
  calibre?: string | null;
  material?: string | null;
  linea?: string | null;
  presentacion?: string | null;
  tipo_presentacion?: string;
  peso_kg?: string | null;
  unidad: string;
  existencias: Record<string, { cantidad: string; bajo_minimo: boolean }>;
  total: number;
}

export interface ResumenAlmacenes {
  almacenes: ResumenAlmacen[];
  filas: ResumenFila[];
  truncado: boolean;
  total_variantes: number;
}

/** Un bulto de la lista de empaque: código, peso real, lote y conos. */
export interface BultoRemesa {
  fila?: number;
  codigo: string;
  peso_kg: number;
  lote?: string | null;
  conos?: number | null;
}

export interface PreviaRemesa {
  archivo: string | null;
  hoja: string;
  bultos: BultoRemesa[];
  avisos: { fila: number; aviso: string; bloqueante?: boolean }[];
  duplicados: string[];
  se_puede_cargar: boolean;
  resumen: {
    num_bultos: number;
    kg_total: number;
    peso_min: number;
    peso_max: number;
    conos_totales: number;
    lotes: { lote: string; bultos: number; kg: number }[];
  };
}

export interface ResultadoRemesa {
  id: number;
  folio: string;
  num_bultos: number;
  kg_total: number;
  lotes: string[];
  saldo_anterior: number;
  saldo_nuevo: number;
}

/**
 * Lo que devuelve el lector al escanear. `bulto` viene en null cuando el código
 * es el principal de la presentación: no es un bulto y no tiene peso propio.
 */
export interface CodigoResuelto {
  variante: Variante;
  bulto: {
    id: number;
    variante_id: number;
    codigo: string;
    peso_kg?: string | null;
    lote?: string | null;
    conos?: number | null;
    estado?: EstadoBulto;
    consumido_folio?: string | null;
    consumido_tipo?: 'pedido' | 'conversion' | null;
    remesa_folio?: string | null;
  } | null;
}

export interface Remesa {
  id: number;
  folio: string;
  producto: string;
  /** Para cotejarlo con el nombre del archivo. */
  calibre?: string | null;
  sku: string;
  almacen: string;
  usuario?: string | null;
  num_bultos: number;
  kg_total: string;
  lotes?: string | null;
  archivo?: string | null;
  creado_en: string;
}

/** Cuántos paquetes son X kilos, con los pesos reales de la bodega. */
export interface EquivalenciaPaquetes {
  sku: string;
  producto: string;
  peso_nominal?: string | null;
  disponible: {
    paquetes: number;
    kg_en_bultos: number;
    peso_promedio: number;
    peso_min: number;
    peso_max: number;
    kg_inventario: number;
  };
  peso_referencia: number;
  /** True si no hay bultos ubicados y se usó el peso nominal. */
  referencia_nominal: boolean;
  sugerencia: {
    kg_pedidos: number;
    paquetes_exactos: number;
    opciones: { paquetes: number; kg_aprox: number; diferencia: number }[];
  } | null;
}

export interface TraspasoItemInput {
  variante_id: number;
  /** Para variantes de tipo paquete: cuántos paquetes se mandan. */
  paquetes?: number;
  /** Para el resto: cantidad en la unidad de la variante. */
  cantidad?: number;
}

export interface TraspasoInput {
  almacen_origen_id: number;
  almacen_destino_id: number;
  notas?: string;
  items: TraspasoItemInput[];
}

export interface TraspasoLinea {
  /** Id de la línea: con él se declara lo recibido. */
  detalle_id?: number;
  variante_id: number;
  sku: string;
  producto: string;
  /** Cómo se identifica el hilo: no basta el color. */
  calibre?: string | null;
  material?: string | null;
  linea?: string | null;
  paquetes: number | string | null;
  cantidad: number | string;
  /** Los bultos que de verdad se movieron, con su peso real. */
  bultos?: { codigo: string; peso_kg: string; lote?: string | null }[];
  /** True cuando el peso salió del nominal por no haber bultos ubicados. */
  peso_estimado?: boolean;
  peso_nominal?: number | null;
  unidad?: string;
  tipo_presentacion?: string;
  saldo_origen?: number;
  saldo_destino?: number;
  /** Lo que de verdad llegó, cuando ya se recibió. */
  cantidad_recibida?: string | number | null;
  paquetes_recibidos?: string | number | null;
  /** Solo al enviar/recibir: cuánto se pidió y qué faltó. */
  solicitado?: number;
  enviado?: number;
  recibida?: number;
  faltante?: number;
  /**
   * True cuando al enviar cambió el peso respecto a lo solicitado: salieron los
   * bultos que de verdad había y pesan distinto.
   */
  ajustado?: boolean;
}

/** Por dónde va un traspaso. */
export type EstadoTraspaso = 'solicitado' | 'en_transito' | 'recibido' | 'cancelado';

export interface ResultadoTraspaso {
  id: number;
  folio: string;
  estado?: EstadoTraspaso;
  almacen_origen_id?: number;
  almacen_destino_id?: number;
  /** Cuántas líneas llegaron incompletas, al recibir. */
  faltantes?: number;
  lineas: TraspasoLinea[];
}

/** Lo que el responsable declara al aceptar el traspaso. */
export interface RecepcionInput {
  notas?: string;
  recibido?: { detalle_id: number; paquetes?: number; cantidad?: number }[];
}

export interface Traspaso {
  id: number;
  folio: string;
  estado: EstadoTraspaso;
  almacen_origen_id?: number;
  almacen_destino_id?: number;
  almacen_origen: string;
  almacen_destino: string;
  /** Quién lo pidió, quién lo envió y quién firmó de recibido. */
  usuario?: string | null;
  enviado_por?: string | null;
  recibido_por?: string | null;
  cancelado_por?: string | null;
  enviado_en?: string | null;
  recibido_en?: string | null;
  cancelado_en?: string | null;
  notas?: string | null;
  recepcion_notas?: string | null;
  motivo_cancelacion?: string | null;
  num_lineas: number | string;
  creado_en: string;
  lineas: TraspasoLinea[];
}

export interface Conversion {
  id: number;
  producto: string;
  paquete_sku: string;
  cono_sku: string;
  paquetes: string;
  kg_consumidos: string;
  destare_kg?: string | null;
  piezas_generadas: string;
  almacen_origen: string;
  almacen_destino: string;
  usuario?: string | null;
  motivo?: string | null;
  creado_en: string;
}

/** Servicio HTTP de inventario y almacenes. */
@Injectable({ providedIn: 'root' })
export class InventarioService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  almacenes(): Observable<Almacen[]> {
    return this.http.get<ApiResponse<Almacen[]>>(`${this.base}/almacenes`).pipe(map(data));
  }

  // ---- Remesas: carga masiva de bultos desde la lista de empaque ----

  /** Lee el .xlsx en el servidor y devuelve la vista previa sin guardar nada. */
  previaRemesa(archivo: File): Observable<PreviaRemesa> {
    return this.http
      .post<ApiResponse<PreviaRemesa>>(`${this.base}/remesas/previa`, archivo, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Nombre-Archivo': archivo.name,
        },
      })
      .pipe(map(data));
  }

  /**
   * Confirma la remesa: registra los bultos y da entrada al total en kilos.
   * Se manda `producto_id` (crea la presentación si al producto le falta) o
   * `variante_id` para cargar sobre una presentación que ya existe.
   */
  confirmarRemesa(body: {
    producto_id?: number;
    variante_id?: number;
    almacen_id: number;
    archivo?: string | null;
    notas?: string;
    bultos: BultoRemesa[];
  }): Observable<ResultadoRemesa> {
    return this.http
      .post<ApiResponse<ResultadoRemesa>>(`${this.base}/remesas`, body)
      .pipe(map(data));
  }

  remesas(limit = 20): Observable<Paginado<Remesa>> {
    const params = new HttpParams().set('limit', limit);
    return this.http
      .get<ApiResponse<Paginado<Remesa>>>(`${this.base}/remesas`, { params })
      .pipe(map(data));
  }

  /** Panorama de qué hay en cada almacén: totales + matriz producto × almacén. */
  resumen(): Observable<ResumenAlmacenes> {
    return this.http
      .get<ApiResponse<ResumenAlmacenes>>(`${this.base}/inventario/resumen`)
      .pipe(map(data));
  }

  /** Alta de almacén. Solo administradores. */
  crearAlmacen(body: AlmacenInput): Observable<Almacen> {
    return this.http.post<ApiResponse<Almacen>>(`${this.base}/almacenes`, body).pipe(map(data));
  }

  /** Edición de almacén. Solo administradores. */
  actualizarAlmacen(id: number, body: AlmacenInput): Observable<Almacen> {
    return this.http
      .put<ApiResponse<Almacen>>(`${this.base}/almacenes/${id}`, body)
      .pipe(map(data));
  }

  /** Solo se permite si el almacén no tiene nada colgando. Solo administradores. */
  eliminarAlmacen(id: number): Observable<unknown> {
    return this.http
      .delete<ApiResponse<unknown>>(`${this.base}/almacenes/${id}`)
      .pipe(map(data));
  }

  /** Búsqueda de variantes (SKU/código) para elegir en formularios. */
  buscarVariantes(q: string): Observable<Variante[]> {
    const params = new HttpParams().set('q', q).set('limit', 20);
    return this.http
      .get<ApiResponse<Paginado<Variante>>>(`${this.base}/variantes`, { params })
      .pipe(map((r) => data(r).items));
  }

  /**
   * Resuelve un código escaneado: la presentación que se vende y, si el código
   * es de un bulto concreto, ese bulto con su peso real. Con eso el mostrador
   * cobra por lo que pesa el bulto que tiene en la mano.
   */
  resolverCodigo(codigo: string): Observable<CodigoResuelto> {
    return this.http
      .get<ApiResponse<CodigoResuelto>>(
        `${this.base}/variantes/resolver/${encodeURIComponent(codigo)}`
      )
      .pipe(map(data));
  }

  /**
   * Las presentaciones de un tipo, para llenar un selector completo.
   * El filtro va al servidor: recortar en el cliente dejaría fuera las que no
   * alcanzaron a entrar en la página.
   */
  variantesPorTipo(tipo: 'simple' | 'paquete' | 'cono'): Observable<Variante[]> {
    const params = new HttpParams()
      .set('tipo_presentacion', tipo)
      .set('activo', true)
      .set('limit', 200);
    return this.http
      .get<ApiResponse<Paginado<Variante>>>(`${this.base}/variantes`, { params })
      .pipe(map((r) => data(r).items));
  }

  stock(f: FiltroStock = {}): Observable<Paginado<StockItem>> {
    let params = new HttpParams();
    if (f.almacen_id) params = params.set('almacen_id', f.almacen_id);
    if (f.variante_id) params = params.set('variante_id', f.variante_id);
    if (f.q) params = params.set('q', f.q);
    if (f.bajo_stock) params = params.set('bajo_stock', true);
    params = params.set('page', f.page ?? 1).set('limit', f.limit ?? 50);
    return this.http
      .get<ApiResponse<Paginado<StockItem>>>(`${this.base}/inventario`, { params })
      .pipe(map(data));
  }

  alertas(): Observable<StockItem[]> {
    return this.http.get<ApiResponse<StockItem[]>>(`${this.base}/inventario/alertas`).pipe(map(data));
  }

  /** Kardex. `concepto` agrupa en lenguaje de tienda: ventas, traspasos, desarmes… */
  movimientos(
    almacen_id?: number,
    variante_id?: number,
    concepto?: string
  ): Observable<Paginado<Movimiento>> {
    let params = new HttpParams().set('limit', 100);
    if (almacen_id) params = params.set('almacen_id', almacen_id);
    if (variante_id) params = params.set('variante_id', variante_id);
    if (concepto) params = params.set('concepto', concepto);
    return this.http
      .get<ApiResponse<Paginado<Movimiento>>>(`${this.base}/inventario/movimientos`, { params })
      .pipe(map(data));
  }

  registrarMovimiento(body: MovimientoInput): Observable<ResultadoMovimiento> {
    return this.http
      .post<ApiResponse<ResultadoMovimiento>>(`${this.base}/inventario/movimientos`, body)
      .pipe(map(data));
  }


  /** Desarma paquetes y los convierte en conos en el almacén destino. */
  /** Qué trae el bulto escaneado. No mueve nada: es para mostrarlo antes. */
  previaDesarme(codigo: string): Observable<PreviaDesarme> {
    return this.http
      .get<ApiResponse<PreviaDesarme>>(
        `${this.base}/inventario/desarmes/previa/${encodeURIComponent(codigo)}`
      )
      .pipe(map(data));
  }

  desarmar(body: DesarmeInput): Observable<ResultadoDesarme> {
    return this.http
      .post<ApiResponse<ResultadoDesarme>>(`${this.base}/inventario/desarmes`, body)
      .pipe(map(data));
  }

  /**
   * Traspaso de matriz a sucursal. En variantes de tipo paquete se manda
   * `paquetes`; en las demás, `cantidad` en su propia unidad.
   */
  /**
   * Traduce kilos ↔ paquetes con el peso REAL de los bultos que hay en el
   * almacén. Sirve para decir "100 kg ≈ 5 paquetes (95.4 kg, faltan 4.6)".
   */
  equivalenciaPaquetes(variante_id: number, almacen_id: number, kg?: number): Observable<EquivalenciaPaquetes> {
    let params = new HttpParams().set('variante_id', variante_id).set('almacen_id', almacen_id);
    if (kg != null) params = params.set('kg', kg);
    return this.http
      .get<ApiResponse<EquivalenciaPaquetes>>(`${this.base}/inventario/equivalencia-paquetes`, { params })
      .pipe(map(data));
  }

  /** Paso 1: la solicitud. Aparta en el origen, no mueve nada. */
  solicitarTraspaso(body: TraspasoInput): Observable<ResultadoTraspaso> {
    return this.http
      .post<ApiResponse<ResultadoTraspaso>>(`${this.base}/inventario/traspasos`, body)
      .pipe(map(data));
  }

  /** Paso 2: sale del origen y queda en camino. */
  enviarTraspaso(id: number): Observable<ResultadoTraspaso> {
    return this.http
      .post<ApiResponse<ResultadoTraspaso>>(`${this.base}/inventario/traspasos/${id}/enviar`, {})
      .pipe(map(data));
  }

  /** Paso 3: el responsable acepta y dice qué llegó. */
  recibirTraspaso(id: number, body: RecepcionInput = {}): Observable<ResultadoTraspaso> {
    return this.http
      .post<ApiResponse<ResultadoTraspaso>>(`${this.base}/inventario/traspasos/${id}/recibir`, body)
      .pipe(map(data));
  }

  cancelarTraspaso(id: number, motivo?: string): Observable<ResultadoTraspaso> {
    return this.http
      .post<ApiResponse<ResultadoTraspaso>>(`${this.base}/inventario/traspasos/${id}/cancelar`, {
        motivo,
      })
      .pipe(map(data));
  }

  crearTraspaso(body: TraspasoInput): Observable<ResultadoTraspaso> {
    return this.http
      .post<ApiResponse<ResultadoTraspaso>>(`${this.base}/inventario/traspasos`, body)
      .pipe(map(data));
  }

  traspasos(almacen_destino_id?: number, limit = 20): Observable<Paginado<Traspaso>> {
    let params = new HttpParams().set('limit', limit);
    if (almacen_destino_id) params = params.set('almacen_destino_id', almacen_destino_id);
    return this.http
      .get<ApiResponse<Paginado<Traspaso>>>(`${this.base}/inventario/traspasos`, { params })
      .pipe(map(data));
  }

  /** Un traspaso con sus líneas, para ver qué se mandó. */
  traspaso(id: number): Observable<TraspasoDetalle> {
    return this.http
      .get<ApiResponse<TraspasoDetalle>>(`${this.base}/inventario/traspasos/${id}`)
      .pipe(map(data));
  }

  conversiones(variante_id?: number, limit = 20): Observable<Paginado<Conversion>> {
    let params = new HttpParams().set('limit', limit);
    if (variante_id) params = params.set('variante_id', variante_id);
    return this.http
      .get<ApiResponse<Paginado<Conversion>>>(`${this.base}/inventario/conversiones`, { params })
      .pipe(map(data));
  }

  configurar(body: {
    variante_id: number;
    almacen_id: number;
    stock_minimo?: number;
    stock_maximo?: number | null;
    ubicacion_fisica?: string;
  }): Observable<StockItem> {
    return this.http
      .put<ApiResponse<StockItem>>(`${this.base}/inventario/configuracion`, body)
      .pipe(map(data));
  }
}
